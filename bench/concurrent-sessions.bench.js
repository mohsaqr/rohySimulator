// Phase 7 Performance Benchmark #3 — Concurrent session ceiling.
//
// Per TESTING_PLAN.md line 209:
//   "Concurrent session ceiling (how many simultaneous learners can the
//    server handle?)"
//
// SCOPE
// -----
// Spawn the real Express server (via tests/utils/startTestServer.js, the
// same harness the route tests use) on an isolated sqlite DB, then drive
// it with N concurrent "virtual learners" — each one creates a session,
// hammers a handful of read endpoints (the server-side surface a live
// classroom actually exercises during a session), and ends the session.
//
// What we are measuring is the wall-clock cost of running N of these
// learner workflows in parallel. Vitest/tinybench's `hz` (iterations per
// second) on this bench is the *batch* rate — i.e. how many full
// "N-learner cohorts" the server can churn through per second. That gives
// us a directly-comparable signal: a regression that, say, doubles the
// sessions-create latency will halve hz at every cohort size.
//
// BENCH GROUPS
// ------------
//   1. concurrent.1   — single learner baseline (always run)
//   2. concurrent.5   — small cohort
//   3. concurrent.10  — typical class-of-ten
//   4. concurrent.25  — under env gate (RUN_LOAD_BENCH=1)
//   5. concurrent.50  — under env gate (RUN_LOAD_BENCH=1)
//
// We gate the heavy sweeps behind RUN_LOAD_BENCH because (a) N=50 will
// generate hundreds of requests per bench iteration and start banging
// into the per-IP rate limiter (600/min on the general router — see
// server/routes.js generalLimiter), and (b) load-shape numbers swing
// wildly between dev laptops and CI, so they have no business gating
// merges. Run them locally when investigating capacity, not on every
// PR.
//
// AUTH STRATEGY
// -------------
// /auth/login is rate-limited to 10/15min per IP. We cannot log in N
// times. Instead we insert one admin user directly into the spawned
// sqlite DB and mint a JWT from it once at module load — exactly the
// pattern tests/server/audio/provider-smoke.test.js and tts-route.test.js
// already use. Every virtual user reuses that same Bearer token.
//
// CASE STRATEGY
// -------------
// /api/sessions requires a real case_id. The fresh test DB has no cases,
// so we INSERT one minimal cases row directly at module load and reuse its
// id for every virtual user. We aren't benchmarking case logic here.
//
// SETUP TIMING — WHY TOP-LEVEL AWAIT
// ----------------------------------
// Vitest 4's `bench()` mode does not reliably run `beforeAll` hooks
// before the bench iterations start (verified empirically on 4.1.5 —
// the hook does not fire during `vitest bench`). The portable fix is
// to do the one-time setup at module-eval time via top-level await,
// which both `vitest run` and `vitest bench` honour. The teardown is
// registered on `process.on('beforeExit')` so the server child gets
// killed even though no afterAll runs either.
//
// CONSTRAINTS
// -----------
//   - No source modifications.
//   - No new npm dependencies. Uses node:fetch (Node 22 global) + sqlite3
//     + bcrypt + jsonwebtoken (already in package.json).
//   - One server boot per file. One DB. One JWT.
//   - bench iteration time is capped via the `time` option so a slow
//     run can't hang the suite forever; tinybench will stop adding
//     samples once the elapsed time budget is hit.
//
// NOTE — RATE LIMITER INTERACTION
// -------------------------------
// `server/routes.js` mounts a per-IP general limiter at 600 req/min.
// Each virtual user makes 8 round-trips (create + 5 reads + vitals
// write + end), so steady-state ceiling is ~75 cohorts/min at N=1
// before 429s start dominating. By design we cannot bypass this from
// a bench (no env hook, source is off-limits) — instead the bench
// PRINTS the actual session-creation count alongside the 429 count
// per group:
//
//   [concurrent.1] sessions_created=74 429=33417 other_fail=0
//
// Read those lines, not the bench's `hz`, when you want the real
// throughput. The `hz` reflects "round-trips/sec including instant
// 429 fast-paths" — useful for spotting catastrophic regressions
// (e.g. a deadlock that drops hz by 50x) but NOT for interpreting
// the absolute server capacity.
//
// This is a load test framed inside the bench harness. It is NOT a
// strict micro-benchmark — variance from sqlite contention, GC
// pauses, and OS scheduler jitter dominates anything we'd see from
// a code refactor. Treat the numbers as ceilings, not regression
// alarms.

import { bench, describe } from 'vitest';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { startTestServer } from '../tests/utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-tests-secret';

// Cap each individual bench group at ~5s wall-clock. tinybench stops
// adding samples once `time` is exceeded (it never pre-empts a running
// iteration, so the effective cap is time + one-iteration-duration).
// Heavy sweeps (N=50) can have an iteration of several hundred ms, so
// we keep `time` modest.
const BENCH_TIME_MS = 5_000;
const BENCH_WARMUP_MS = 200;

// Whether the heavy cohorts run. Off by default to avoid hammering
// rate limiters in CI; flip on locally with RUN_LOAD_BENCH=1.
const RUN_LOAD_BENCH = !!process.env.RUN_LOAD_BENCH;

// ---------- sqlite helpers (kept local; same shape as other tests) ----------

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

// ---------- top-level setup --------------------------------------------------

const server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });
const baseUrl = server.baseUrl;

// Seed an admin user + one case directly in the spawned DB. We bypass
// /auth/login (rate-limited, bcrypt-bound) and /api/cases (admin-only
// POST + JSON contract churn) by talking straight to sqlite — same
// shortcut tts-route.test.js takes.
let token;
let caseId;
{
    const db = await openDb(server.dbPath);
    try {
        const passwordHash = await bcrypt.hash('benchpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['benchadmin', 'Bench Admin', passwordHash, 'benchadmin@example.com']
        );
        const userRow = await dbGet(
            db,
            'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?',
            ['benchadmin']
        );

        // Minimal case row. is_available=1 / deleted_at=NULL is what
        // /api/sessions and /api/cases/:id filter on.
        const caseInsert = await dbRun(
            db,
            `INSERT INTO cases (
                name, description, system_prompt, config, scenario,
                patient_name, patient_gender, patient_age, chief_complaint,
                difficulty_level, estimated_duration_minutes,
                is_available, is_default, tenant_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
                'Bench Case',
                'Synthetic case for concurrent-session benchmarking.',
                'You are a patient.',
                JSON.stringify({}),
                null,
                'Jane Doe',
                'Female',
                40,
                'chest pain',
                'intermediate',
                30,
                1,
                0,
                1,
            ]
        );
        caseId = caseInsert.lastID;

        token = jwt.sign(
            {
                id: userRow.id,
                username: userRow.username,
                email: userRow.email,
                role: 'admin',
                tenant_id: userRow.tenant_id || 1,
            },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );
    } finally {
        await dbClose(db);
    }
}

// Tear down the spawned server on process exit. Vitest 4 bench mode
// does not run afterAll, so we hook the runtime instead. `beforeExit`
// fires once when the event loop drains; SIGINT/SIGTERM handle Ctrl-C.
let closed = false;
async function teardown() {
    if (closed) return;
    closed = true;
    try { await server.close(); } catch { /* noop */ }
}
function printStats() {
    console.log(
        `\n[bench stats] sessions_created=${stats.created} ` +
        `429_rate_limited=${stats.rateLimited} ` +
        `other_failures=${stats.otherFailed} ` +
        `(per-IP general limiter is 600/min — high hz at low N reflects 429s, not real session throughput)\n`
    );
}
process.once('beforeExit', () => { printStats(); teardown(); });
// Vitest may force-exit the worker before beforeExit fires — print
// the stats from the bench fn periodically too. (See per-bench logs
// at the top of each `bench(...)` block below.)
process.once('SIGINT', () => { teardown(); });
process.once('SIGTERM', () => { teardown(); });

// Outcome counters. We surface these on process exit so a developer
// reading the bench output can tell whether the per-IP rate limiter
// (server/routes.js generalLimiter, 600 req/min) clipped the run.
// The bench's `hz` is the cohort iteration rate which, once 429s
// dominate, ceases to reflect actual session throughput.
const stats = { created: 0, rateLimited: 0, otherFailed: 0 };

// ---------- the virtual user --------------------------------------------------

/**
 * One virtual learner's full server-side workflow:
 *   - POST /api/sessions               → create
 *   - GET  /api/sessions/:id           → fetch detail
 *   - GET  /api/sessions/:id/vitals    → vitals stream snapshot
 *   - GET  /api/cases/:caseId          → case detail (live read)
 *   - GET  /api/sessions/:id/events    → event log read
 *   - GET  /api/cases                  → case list
 *   - POST /api/sessions/:id/vitals    → vitals write (one tick)
 *   - PUT  /api/sessions/:id/end       → close session
 *
 * That is five reads after create + a vitals write + close = 8
 * round-trips, matching the brief's "5 reads + create + end" with a
 * small headroom for the vitals write a real session also performs.
 *
 * We swallow non-2xx responses rather than throwing inside the bench
 * hot loop — a transient 429 from the per-IP limiter at high N is a
 * legitimate observation (it shows up as faster hz because
 * rate-limited requests return immediately), not a reason to abort
 * the run.
 */
async function virtualUser() {
    const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // create
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            case_id: caseId,
            student_name: 'bench-vu',
            llm_settings: {},
            monitor_settings: {},
        }),
    });
    if (!createRes.ok) {
        // Drain so the socket can be reused.
        await createRes.text().catch(() => {});
        if (createRes.status === 429) stats.rateLimited++;
        else stats.otherFailed++;
        return { ok: false, status: createRes.status };
    }
    stats.created++;
    const session = await createRes.json();
    const sid = session.id;

    // 5 reads (parallel — same pattern a chat-open + monitor-mount would do).
    const reads = await Promise.all([
        fetch(`${baseUrl}/api/sessions/${sid}`, { headers: auth }),
        fetch(`${baseUrl}/api/sessions/${sid}/vitals`, { headers: auth }),
        fetch(`${baseUrl}/api/cases/${caseId}`, { headers: auth }),
        fetch(`${baseUrl}/api/sessions/${sid}/events`, { headers: auth }),
        fetch(`${baseUrl}/api/cases`, { headers: auth }),
    ]);
    // Drain bodies so the agent reuses the keep-alive socket.
    await Promise.all(reads.map(r => r.text().catch(() => {})));

    // one vitals write (same shape as the runtime monitor sends)
    const vitalsRes = await fetch(`${baseUrl}/api/sessions/${sid}/vitals`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ hr: 80, spo2: 98, bp_sys: 120, bp_dia: 80, rr: 16, temp: 37.0 }),
    });
    await vitalsRes.text().catch(() => {});

    // end
    const endRes = await fetch(`${baseUrl}/api/sessions/${sid}/end`, {
        method: 'PUT',
        headers: auth,
    });
    await endRes.text().catch(() => {});

    return { ok: true, sessionId: sid };
}

/**
 * Fan out N virtual users in parallel and await all of them.
 * Returns nothing — the bench harness measures the wall-clock of this
 * Promise.all, which is exactly the cohort-throughput signal we want.
 */
async function runCohort(n) {
    const tasks = new Array(n);
    for (let i = 0; i < n; i++) tasks[i] = virtualUser();
    await Promise.all(tasks);
}

// Smoke-check at module-eval time so a misconfigured server / case /
// JWT fails the bench file with a clean error rather than dribbling
// thousands of silent 4xx responses through the bench loop. Also gives
// the dev a baseline single-VU latency in the bench output, useful
// context for interpreting the cohort hz numbers below.
{
    const smokeStart = performance.now();
    const smoke = await virtualUser();
    const smokeMs = performance.now() - smokeStart;
    if (!smoke.ok) {
        await teardown();
        throw new Error(`bench smoke check failed: ${JSON.stringify(smoke)}`);
    }
    console.log(`[bench setup] smoke virtualUser (8 round-trips) ok in ${smokeMs.toFixed(1)}ms`);
    // The smoke counted toward `stats.created`. Reset so the
    // process-exit summary reflects only the bench iterations.
    stats.created = 0;
}

// ---------- bench harness ----------------------------------------------------

// Per-group counters: keep a snapshot of `stats` at the start of each
// bench so we can print a delta (success-rate / rate-limit-rate) when
// the group finishes. This is the actual "did the load test succeed"
// signal — `hz` alone is misleading once the limiter kicks in.
let groupStart = null;
function noteGroup(name) {
    if (groupStart) {
        const dCreated = stats.created - groupStart.created;
        const dLimited = stats.rateLimited - groupStart.rateLimited;
        const dOther = stats.otherFailed - groupStart.otherFailed;
        console.log(
            `[${groupStart.name}] sessions_created=${dCreated} 429=${dLimited} other_fail=${dOther}`
        );
    }
    groupStart = {
        name,
        created: stats.created,
        rateLimited: stats.rateLimited,
        otherFailed: stats.otherFailed,
    };
}

describe('concurrent sessions — capacity benchmark', () => {

    // ----- always-run benches -------------------------------------------------

    bench(
        'concurrent.1 — single learner baseline',
        async () => {
            if (!groupStart || groupStart.name !== 'concurrent.1') noteGroup('concurrent.1');
            await runCohort(1);
        },
        { time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS, warmupIterations: 2 }
    );

    bench(
        'concurrent.5 — small cohort',
        async () => {
            if (!groupStart || groupStart.name !== 'concurrent.5') noteGroup('concurrent.5');
            await runCohort(5);
        },
        { time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS, warmupIterations: 1 }
    );

    bench(
        'concurrent.10 — typical class',
        async () => {
            if (!groupStart || groupStart.name !== 'concurrent.10') noteGroup('concurrent.10');
            await runCohort(10);
        },
        { time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS, warmupIterations: 1 }
    );

    // ----- gated heavy sweeps -------------------------------------------------
    // Skipped by default. Set RUN_LOAD_BENCH=1 to run.

    bench.skipIf(!RUN_LOAD_BENCH)(
        'concurrent.25 — under env gate (RUN_LOAD_BENCH=1)',
        async () => {
            if (!groupStart || groupStart.name !== 'concurrent.25') noteGroup('concurrent.25');
            await runCohort(25);
        },
        { time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS, warmupIterations: 1 }
    );

    bench.skipIf(!RUN_LOAD_BENCH)(
        'concurrent.50 — under env gate (RUN_LOAD_BENCH=1)',
        async () => {
            if (!groupStart || groupStart.name !== 'concurrent.50') noteGroup('concurrent.50');
            await runCohort(50);
        },
        { time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS, warmupIterations: 1 }
    );
});
