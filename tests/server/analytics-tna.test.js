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

async function seedAdmin(db, username) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
        [username, username, `${username}@example.com`, hash]
    );
    return r.lastID;
}

async function seedCase(db, name) {
    const r = await pRun(db,
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
         VALUES (?, ?, ?, ?, 1)`,
        [name, '', 'prompt', '{}']
    );
    return r.lastID;
}

async function seedSession(db, userId, caseId) {
    const r = await pRun(db,
        `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`,
        [caseId, userId]
    );
    return r.lastID;
}

async function seedEvent(db, { userId, caseId, sessionId, verb, objectType, ts }) {
    await pRun(db,
        `INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, object_id, object_name, severity, category, timestamp)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 'INFO', 'CLINICAL', ?)`,
        [sessionId, userId, caseId, verb, objectType, ts]
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
    let userIdA, userIdB, caseId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const adminId = await seedAdmin(db, 'analytics-admin');
            userIdA = await seedAdmin(db, 'analytics-userA');
            userIdB = await seedAdmin(db, 'analytics-userB');
            caseId = await seedCase(db, 'Sepsis Drill');

            const sessA1 = await seedSession(db, userIdA, caseId);
            const sessA2 = await seedSession(db, userIdA, caseId);
            const sessB1 = await seedSession(db, userIdB, caseId);

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

            void adminId;
        } finally {
            await closeDb(db);
        }
        token = await login(server.baseUrl, 'analytics-admin');
    }, 30_000);

    afterAll(async () => { if (server) await server.close(); });

    function authedFetch(path) {
        return fetch(`${server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }

    describe('GET /tna-sequences', () => {
        it('requires admin auth', async () => {
            const res = await fetch(`${server.baseUrl}/api/analytics/tna-sequences`);
            expect([401, 403]).toContain(res.status);
        });

        it('returns parallel sequences + objectTypeSequences arrays', async () => {
            const res = await authedFetch('/api/analytics/tna-sequences?skip_merges=true');
            expect(res.status).toBe(200);
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
    });

    describe('GET /summary', () => {
        it('returns total + unique users + sessions + avgPerUser', async () => {
            const res = await authedFetch('/api/analytics/summary');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.totalActivities).toBeGreaterThanOrEqual(28);
            expect(body.uniqueUsers).toBe(2);
            expect(body.uniqueSessions).toBe(3);
            expect(body.avgPerUser).toBeGreaterThan(0);
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

        it('hourly is always 24 buckets, padded with zeros', async () => {
            const res = await authedFetch('/api/analytics/hourly-counts');
            const body = await res.json();
            expect(body.hourly).toHaveLength(24);
            for (let h = 0; h < 24; h++) {
                expect(body.hourly[h]).toEqual({ hour: h, count: expect.any(Number) });
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

        it('filter-options surfaces the seeded case', async () => {
            const res = await authedFetch('/api/analytics/filter-options');
            const body = await res.json();
            expect(body.cases.some((c) => c.title === 'Sepsis Drill')).toBe(true);
            expect(body.users.length).toBeGreaterThanOrEqual(2);
        });
    });
});
