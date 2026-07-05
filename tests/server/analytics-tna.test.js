// Integration tests for the LAILA-shaped /api/analytics/* endpoints.
//
// Spawns the real server, seeds an admin + a handful of learning_events
// rows that exercise actor-session grouping, P95 chunking trigger, and
// objectTypeSequences parallel arrays. The shape we're locking is the
// same contract LAILA uses (sequences[][] + objectTypeSequences[][] +
// metadata.{totalSequences,totalEvents,uniqueVerbs,uniqueObjectTypes,
// caseTitle,dateRange,groupBy}).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'AnalyticsT3sts!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function seedTenant(db, { id, slug, name }) {
    await pRun(db,
        `INSERT OR IGNORE INTO tenants (id, slug, name, is_default)
         VALUES (?, ?, ?, 0)`,
        [id, slug, name]
    );
}

async function seedAdmin(db, username, tenantId = 1) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, 'admin', ?, 'active')`,
        [username, username, `${username}@example.com`, hash, tenantId]
    );
    return r.lastID;
}

async function seedCase(db, name, tenantId = 1) {
    const r = await pRun(db,
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
         VALUES (?, ?, ?, ?, ?)`,
        [name, '', 'prompt', '{}', tenantId]
    );
    return r.lastID;
}

async function seedSession(db, userId, caseId, tenantId = 1) {
    const r = await pRun(db,
        `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', ?)`,
        [caseId, userId, tenantId]
    );
    return r.lastID;
}

async function seedEvent(db, { userId, caseId, sessionId, verb, objectType, ts, tenantId = 1, objectName = null }) {
    await pRun(db,
        `INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, object_id, object_name, severity, category, timestamp, tenant_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'INFO', 'CLINICAL', ?, ?)`,
        [sessionId, userId, caseId, verb, objectType, objectName, ts, tenantId]
    );
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    return (await res.json()).token;
}

describe('/api/analytics — LAILA-shaped endpoints', () => {
    let server, token;
    let otherTenantToken;
    let userIdA, userIdB, caseId;
    let otherTenantUserId, otherTenantCaseId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const adminId = await seedAdmin(db, 'analytics-admin');
            userIdA = await seedAdmin(db, 'analytics-userA');
            userIdB = await seedAdmin(db, 'analytics-userB');
            caseId = await seedCase(db, 'Sepsis Drill');
            await seedTenant(db, { id: 2, slug: 'analytics-other', name: 'Analytics Other Tenant' });
            otherTenantUserId = await seedAdmin(db, 'analytics-other-admin', 2);
            otherTenantCaseId = await seedCase(db, 'Other Tenant Drill', 2);

            const sessA1 = await seedSession(db, userIdA, caseId);
            const sessA2 = await seedSession(db, userIdA, caseId);
            const sessB1 = await seedSession(db, userIdB, caseId);
            const otherSess = await seedSession(db, otherTenantUserId, otherTenantCaseId, 2);

            // userA, session 1: a normal-length sequence (5 events).
            const t = (mins) => new Date(2026, 4, 1, 9, mins, 0).toISOString();
            const seq1 = [
                ['STARTED_SESSION', 'session', t(0)],
                ['ORDERED_LAB',     'lab_test', t(2)],
                ['VIEWED_LAB_RESULT','lab_result', t(5)],
                ['SENT_MESSAGE',    'chat_message', t(7)],
                ['ENDED_SESSION',   'session', t(10)],
            ];
            for (const [v, o, ts] of seq1) {
                await seedEvent(db, { userId: userIdA, caseId, sessionId: sessA1, verb: v, objectType: o, ts });
            }

            // userA, session 2: another short sequence — establishes
            // actor-session grouping (same userA, different session).
            const seq2 = [
                ['STARTED_SESSION', 'session', t(20)],
                ['PERFORMED_PHYSICAL_EXAM', 'physical_exam', t(22)],
                ['SENT_MESSAGE',    'chat_message', t(24)],
            ];
            for (const [v, o, ts] of seq2) {
                await seedEvent(db, { userId: userIdA, caseId, sessionId: sessA2, verb: v, objectType: o, ts });
            }

            // userB, session 1: long sequence (20 events) so the P95
            // chunker has something to compare against. Won't actually
            // chunk because p95 of {5,3,20} = 20, but it exercises the
            // path.
            for (let i = 0; i < 20; i++) {
                await seedEvent(db, {
                    userId: userIdB, caseId, sessionId: sessB1,
                    verb: i % 2 === 0 ? 'OPENED' : 'ADJUSTED_VITAL',
                    objectType: i % 2 === 0 ? 'panel' : 'vital_sign',
                    ts: new Date(2026, 4, 1, 10, i, 0).toISOString(),
                });
            }

            // Tenant 2 probe data. These rows should never affect tenant 1
            // analytics counts, filters, or sequences.
            await seedEvent(db, {
                userId: otherTenantUserId, caseId: otherTenantCaseId, sessionId: otherSess,
                verb: 'ORDERED_MEDICATION', objectType: 'medication',
                objectName: 'Other Tenant Drug',
                ts: new Date(2026, 4, 1, 11, 0, 0).toISOString(),
                tenantId: 2,
            });
            await seedEvent(db, {
                userId: otherTenantUserId, caseId: otherTenantCaseId, sessionId: otherSess,
                verb: 'ADMINISTERED_MEDICATION', objectType: 'medication',
                objectName: 'Other Tenant Drug',
                ts: new Date(2026, 4, 1, 11, 2, 0).toISOString(),
                tenantId: 2,
            });

            void adminId;
        } finally {
            await closeDb(db);
        }
        token = await login(server.baseUrl, 'analytics-admin');
        otherTenantToken = await login(server.baseUrl, 'analytics-other-admin');
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    function authedFetch(path) {
        return fetch(`${server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }

    function otherTenantFetch(path) {
        return fetch(`${server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${otherTenantToken}` } });
    }

    describe('GET /tna-sequences', () => {
        it('requires admin auth', async () => {
            const res = await fetch(`${server.baseUrl}/api/analytics/tna-sequences`);
            expect([401, 403]).toContain(res.status);
        });

        it('returns parallel sequences + objectTypeSequences arrays', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true');
            expect(res.status, await res.clone().text()).toBe(200);
            const body = await res.json();

            expect(Array.isArray(body.sequences)).toBe(true);
            expect(Array.isArray(body.objectTypeSequences)).toBe(true);
            expect(body.sequences.length).toBe(body.objectTypeSequences.length);
            for (let i = 0; i < body.sequences.length; i++) {
                expect(body.sequences[i].length).toBe(body.objectTypeSequences[i].length);
            }
        });

        it('actor-session grouping splits userA into two sequences', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true&group_by=actor-session');
            const body = await res.json();
            // userA contributes 2 sessions, userB contributes 1 → 3 sequences total.
            expect(body.metadata.totalSequences).toBe(3);
            expect(body.metadata.groupBy).toBe('actor-session');
        });

        it('actor grouping concatenates userA into one sequence', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true&group_by=actor');
            const body = await res.json();
            // Two users → two sequences.
            expect(body.metadata.totalSequences).toBe(2);
        });

        it('exposes case title in metadata', async () => {
            const res = await authedFetch(`/api/analytics/tna-sequences?case_id=${caseId}&skip_merges=true`);
            const body = await res.json();
            expect(body.metadata.caseTitle).toBe('Sepsis Drill');
        });

        it('respects min_sequence_length', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true&min_sequence_length=10');
            const body = await res.json();
            // Only userB's 20-event session passes a 10-event minimum.
            expect(body.metadata.totalSequences).toBe(1);
        });

        it('uniqueVerbs + uniqueObjectTypes reflect what made it through', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true');
            const body = await res.json();
            expect(body.metadata.uniqueVerbs).toContain('STARTED_SESSION');
            expect(body.metadata.uniqueObjectTypes).toContain('lab_test');
        });

        it('is tenant-scoped and does not leak other-tenant events', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true');
            const body = await res.json();
            // 28 seeded clinical events + 1 LOGGED_IN event written by the
            // auth dual-write when this test logged its admin in (Phase 3
            // of PLAN_LOGGING.md).
            expect(body.metadata.totalEvents).toBe(29);
            expect(body.metadata.uniqueVerbs).not.toContain('ORDERED_MEDICATION');

            const otherRes = await otherTenantFetch('/api/analytics/tna-sequences?skip_merges=true');
            const otherBody = await otherRes.json();
            // 2 seeded medication events + 1 LOGGED_IN row from the
            // other-tenant admin login. uniqueVerbs is built from
            // sequences[], which excludes session-less events; the
            // LOGGED_IN row counts in totalEvents but not in uniqueVerbs.
            expect(otherBody.metadata.totalEvents).toBe(3);
            expect(otherBody.metadata.uniqueVerbs).toEqual(['ADMINISTERED_MEDICATION', 'ORDERED_MEDICATION']);
        });

        it('treats date-only end_date as inclusive of the selected calendar day', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true&start_date=2026-05-01&end_date=2026-05-01');
            const body = await res.json();
            expect(body.metadata.totalEvents).toBe(28);
        });
    });

    describe('GET /summary', () => {
        it('returns total + unique users + sessions + avgPerUser', async () => {
            const res = await authedFetch('/api/analytics/summary');
            expect(res.status).toBe(200);
            const body = await res.json();
            // 28 seeded events + 1 LOGGED_IN from the auth dual-write
            // performed during beforeAll's login(); see analytics-tna
            // brittleness note in LEARNINGS.md. uniqueUsers also gains
            // the admin (3 total: userA, userB, analytics-admin).
            expect(body.totalActivities).toBe(29);
            expect(body.uniqueUsers).toBe(3);
            expect(body.uniqueSessions).toBe(3);
            expect(body.avgPerUser).toBeGreaterThan(0);
        });

        it('keeps tenant totals isolated', async () => {
            const res = await otherTenantFetch('/api/analytics/summary');
            expect(res.status).toBe(200);
            const body = await res.json();
            // 2 seeded events + 1 LOGGED_IN from the other-tenant admin
            // login.
            expect(body.totalActivities).toBe(3);
            expect(body.uniqueUsers).toBe(1);
            expect(body.uniqueSessions).toBe(1);
        });
    });

    describe('GET /daily-counts + /hourly-counts', () => {
        it('daily returns date+count pairs', async () => {
            const res = await authedFetch('/api/analytics/daily-counts');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.daily)).toBe(true);
            for (const row of body.daily) {
                expect(row).toHaveProperty('date');
                expect(row).toHaveProperty('count');
            }
        });

        it('hourly returns dense 7×24 day-of-week × hour grid', async () => {
            const res = await authedFetch('/api/analytics/hourly-counts');
            const body = await res.json();
            // LAILA's ActivityHeatmap expects {dow, hour, count} — 7 days × 24 hours = 168 cells.
            expect(body.hourly).toHaveLength(7 * 24);
            // Spot-check the corners.
            expect(body.hourly[0]).toEqual({ dow: 0, hour: 0, count: expect.any(Number) });
            expect(body.hourly[167]).toEqual({ dow: 6, hour: 23, count: expect.any(Number) });
            // Every cell has the expected shape.
            for (const cell of body.hourly) {
                expect(cell).toEqual({ dow: expect.any(Number), hour: expect.any(Number), count: expect.any(Number) });
                expect(cell.dow).toBeGreaterThanOrEqual(0);
                expect(cell.dow).toBeLessThanOrEqual(6);
                expect(cell.hour).toBeGreaterThanOrEqual(0);
                expect(cell.hour).toBeLessThanOrEqual(23);
            }
        });

        it('timeline-series returns days + verbs + per-verb count series', async () => {
            const res = await authedFetch('/api/analytics/timeline-series');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.days)).toBe(true);
            expect(Array.isArray(body.verbs)).toBe(true);
            expect(typeof body.series).toBe('object');
            // Each verb's series must have one count per day.
            for (const verb of body.verbs) {
                expect(body.series[verb]).toHaveLength(body.days.length);
            }
        });
    });

    describe('GET /stats + /top-resources + /filter-options', () => {
        it('stats returns verb + objectType frequencies sorted desc', async () => {
            const res = await authedFetch('/api/analytics/stats');
            const body = await res.json();
            expect(Array.isArray(body.verbs)).toBe(true);
            expect(Array.isArray(body.objectTypes)).toBe(true);
            for (let i = 1; i < body.verbs.length; i++) {
                expect(body.verbs[i - 1].count).toBeGreaterThanOrEqual(body.verbs[i].count);
            }
        });

        it('stats honors the selected student filter', async () => {
            const res = await authedFetch(`/api/analytics/stats?user_id=${userIdA}`);
            const body = await res.json();
            const verbs = new Map(body.verbs.map((row) => [row.label, row.count]));
            expect(verbs.get('SENT_MESSAGE')).toBe(2);
            expect(verbs.has('OPENED')).toBe(false);
            expect(verbs.has('ORDERED_MEDICATION')).toBe(false);
        });

        it('filter-options surfaces the seeded case', async () => {
            const res = await authedFetch('/api/analytics/filter-options');
            const body = await res.json();
            expect(body.cases.some((c) => c.title === 'Sepsis Drill')).toBe(true);
            expect(body.cases.some((c) => c.title === 'Other Tenant Drill')).toBe(false);
            expect(body.users.length).toBeGreaterThanOrEqual(2);
            expect(body.users.some((u) => u.username === 'analytics-other-admin')).toBe(false);
        });

        it('filter-options are tenant-scoped', async () => {
            const res = await otherTenantFetch('/api/analytics/filter-options');
            const body = await res.json();
            expect(body.cases.map((c) => c.title)).toContain('Other Tenant Drill');
            expect(body.cases.map((c) => c.title)).not.toContain('Sepsis Drill');
            expect(body.users.map((u) => u.username)).toEqual(['analytics-other-admin']);
        });
    });
});
