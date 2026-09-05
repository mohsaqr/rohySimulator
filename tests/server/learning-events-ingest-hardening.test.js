// Regression lock: hardening of the two learning-event ingest endpoints.
//
// Three defects, all confirmed against the pre-fix code:
//
//   1. resolveSessionTrinity checked TENANT but not OWNERSHIP. Because the
//      server derives (user_id, case_id) from the sessions row, a same-tenant
//      user who guessed another learner's integer session id got an event
//      written under THAT learner's name — server-attributed, indistinguishable
//      from real activity, and straight into the analytics.
//   2. severity and category were never included in either INSERT, so every
//      row landed NULL in two columns that have CHECK constraints and a client
//      that faithfully sends both.
//   3. The batch endpoint had no size cap and no rate limit, while the
//      neighbouring client-log endpoint had both.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'IngestH4rden!';

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
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}
async function seedUser(db, username, role) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]);
    return r.lastID;
}
async function seedCase(db, name) {
    const r = await pRun(db,
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
         VALUES (?, '', 'p', '{}', 1)`, [name]);
    return r.lastID;
}
async function seedSession(db, userId, caseId) {
    const r = await pRun(db,
        `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`,
        [caseId, userId]);
    return r.lastID;
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    return (await res.json()).token;
}

describe('learning-event ingest hardening', () => {
    let server;
    let victimId, attackerToken, ownerToken;
    let victimSessionId, ownSessionId, deletedSessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            victimId = await seedUser(db, 'ingest-victim', 'student');
            // The attacker is an ADMIN on purpose: rank must not widen whose
            // session you may author events into. If a future change adds a
            // staff bypass to resolveSessionTrinity, this test fails.
            await seedUser(db, 'ingest-attacker', 'admin');
            const caseId = await seedCase(db, 'Ingest Case');

            victimSessionId  = await seedSession(db, victimId, caseId);
            const attackerId = (await pAll(db, `SELECT id FROM users WHERE username = 'ingest-attacker'`))[0].id;
            ownSessionId     = await seedSession(db, attackerId, caseId);
            deletedSessionId = await seedSession(db, attackerId, caseId);
            await pRun(db, `UPDATE sessions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [deletedSessionId]);

            attackerToken = await login(server.baseUrl, 'ingest-attacker');
            ownerToken    = await login(server.baseUrl, 'ingest-victim');
        } finally {
            await closeDb(db);
        }
    });
    afterAll(async () => { await server?.close(); });

    const post = (path, token, body) => fetch(`${server.baseUrl}/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });

    async function rowsFor(sessionId) {
        const db = await openDb(server.dbPath);
        try {
            return await pAll(db,
                `SELECT user_id, verb, severity, category FROM learning_events WHERE session_id = ? ORDER BY id`,
                [sessionId]);
        } finally { await closeDb(db); }
    }

    // --- 1. Session ownership -------------------------------------------

    it('rejects a single event posted against another user\'s session', async () => {
        const res = await post('/learning-events', attackerToken, {
            session_id: victimSessionId,
            verb: 'ORDERED_MEDICATION',
            object_type: 'medication',
            object_name: 'forged adrenaline',
        });
        expect(res.status).toBe(403);
        expect((await res.json()).reason).toBe('not_owner');
        expect(await rowsFor(victimSessionId)).toHaveLength(0);
    });

    it('drops batch events for a session the caller does not own, counted as not_owner', async () => {
        const res = await post('/learning-events/batch', attackerToken, {
            events: [
                { session_id: victimSessionId, verb: 'ORDERED_MEDICATION', object_type: 'medication' },
                { session_id: ownSessionId,    verb: 'VIEWED',             object_type: 'component' },
            ],
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.dropped_reasons.not_owner).toBe(1);
        // The victim's timeline is untouched — that is the whole point.
        expect(await rowsFor(victimSessionId)).toHaveLength(0);
    });

    it('rejects events against a soft-deleted session', async () => {
        // The attacker OWNS this one; it is the tombstone that disqualifies it,
        // so this cannot pass by accident through the ownership check above.
        const res = await post('/learning-events', attackerToken, {
            session_id: deletedSessionId, verb: 'VIEWED', object_type: 'component',
        });
        expect(res.status).toBe(404);
        expect(await rowsFor(deletedSessionId)).toHaveLength(0);
    });

    // --- 2. severity / category persistence ------------------------------

    it('derives severity and category from the verb registry when the client sends neither', async () => {
        await post('/learning-events', ownerToken, {
            session_id: victimSessionId, verb: 'ORDERED_MEDICATION', object_type: 'medication',
        });
        const row = (await rowsFor(victimSessionId)).at(-1);
        // ORDERED_MEDICATION is a historical alias of ORDERED_TREATMENT; the
        // registry keeps a drug order CRITICAL by object type (medication).
        // The stored verb is the canonical one — a rename never costs a row.
        expect(row.verb).toBe('ORDERED_TREATMENT');
        expect(row.severity).toBe('CRITICAL');
        expect(row.category).toBe('CLINICAL');
    });

    it('honours a caller override that is inside the enum', async () => {
        await post('/learning-events', ownerToken, {
            session_id: victimSessionId, verb: 'LAB_RESULT_READY', object_type: 'lab_result',
            severity: 'IMPORTANT', category: 'CLINICAL',
        });
        const row = (await rowsFor(victimSessionId)).at(-1);
        expect(row.severity).toBe('IMPORTANT');
    });

    it('rejects an out-of-enum severity by name instead of failing the CHECK constraint', async () => {
        const res = await post('/learning-events', ownerToken, {
            session_id: victimSessionId, verb: 'VIEWED', object_type: 'component',
            severity: 'SUPER_URGENT',
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('invalid_event_metadata');
    });

    it('persists severity and category on the batch path too', async () => {
        await post('/learning-events/batch', ownerToken, {
            events: [{ session_id: victimSessionId, verb: 'ALARM_TRIGGERED', object_type: 'alarm' }],
        });
        const row = (await rowsFor(victimSessionId)).at(-1);
        expect(row.severity).toBe('CRITICAL');
        expect(row.category).toBe('MONITORING');
    });

    it('counts an out-of-enum batch value as invalid_metadata, not db_error', async () => {
        const res = await post('/learning-events/batch', ownerToken, {
            events: [{ session_id: victimSessionId, verb: 'VIEWED', object_type: 'component', category: 'VIBES' }],
        });
        const body = await res.json();
        expect(body.inserted).toBe(0);
        expect(body.dropped_reasons.invalid_metadata).toBe(1);
        expect(body.dropped_reasons.db_error).toBe(0);
    });

    // --- 3. Batch size cap + rate limit ----------------------------------

    it('rejects a batch larger than the client could legitimately produce', async () => {
        const events = Array.from({ length: 501 }, () => ({
            session_id: victimSessionId, verb: 'VIEWED', object_type: 'component',
        }));
        const res = await post('/learning-events/batch', ownerToken, { events });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('batch_too_large');
    });

    it('holds the batch endpoint to a tighter per-user limit than the global one', async () => {
        // The endpoint was never entirely unlimited — routes.js mounts a
        // generalLimiter over all of /api. But that one is keyed by IP, and
        // rohy's deployment is a room full of students behind one campus NAT:
        // the shared budget is spent by whoever is noisiest, and telemetry is
        // the noisiest traffic there is. The route-level limiter is keyed by
        // (tenant, user), so this asserts the batch route reports a STRICTLY
        // TIGHTER budget than a plain /api route — which is only true when a
        // second, narrower limiter actually runs on it.
        const batch = await post('/learning-events/batch', ownerToken, {
            events: [{ session_id: victimSessionId, verb: 'VIEWED', object_type: 'component' }],
        });
        const plain = await fetch(`${server.baseUrl}/api/learning-events/verbs`, {
            headers: { authorization: `Bearer ${ownerToken}` },
        });
        const batchLimit = Number(batch.headers.get('ratelimit-limit'));
        const globalLimit = Number(plain.headers.get('ratelimit-limit'));
        expect(globalLimit).toBeGreaterThan(0);
        expect(batchLimit).toBeLessThan(globalLimit);
    });
});
