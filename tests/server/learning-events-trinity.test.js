// Server-enforced trinity invariant on /learning-events and
// /learning-events/batch (Phase 1 of PLAN_LOGGING.md).
//
// Locks: the server derives (user_id, case_id) from session_id via the
// sessions table. A client-supplied case_id that disagrees with the
// session record is overridden, not persisted. A session_id from another
// tenant is dropped (not silently mislabeled).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'TrinityT3sts!';

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

async function seedTenant(db, id, slug) {
    await pRun(db, `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (?, ?, ?, 0)`, [id, slug, slug]);
}
async function seedUser(db, username, role, tenantId = 1) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenantId]);
    return r.lastID;
}
async function seedCase(db, name, tenantId = 1) {
    const r = await pRun(db,
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
         VALUES (?, ?, 'p', '{}', ?)`, [name, '', tenantId]);
    return r.lastID;
}
async function seedSession(db, userId, caseId, tenantId = 1) {
    const r = await pRun(db,
        `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', ?)`,
        [caseId, userId, tenantId]);
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

describe('learning-events trinity invariant (server-enforced)', () => {
    let server;
    let token, userId, caseIdReal, caseIdWrong, sessionId;
    let crossTenantSessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            userId = await seedUser(db, 'trinity-student', 'admin');
            caseIdReal  = await seedCase(db, 'Real Case');
            caseIdWrong = await seedCase(db, 'Decoy Case');
            sessionId   = await seedSession(db, userId, caseIdReal);

            // Cross-tenant: session belongs to tenant 2, so principal in
            // tenant 1 cannot resolve it.
            await seedTenant(db, 2, 'tenant-2');
            const otherUser = await seedUser(db, 'other-tenant-user', 'admin', 2);
            const otherCase = await seedCase(db, 'Other Tenant Case', 2);
            crossTenantSessionId = await seedSession(db, otherUser, otherCase, 2);

            token = await login(server.baseUrl, 'trinity-student');
        } finally {
            await closeDb(db);
        }
    });
    afterAll(async () => { await server?.close(); });

    async function readback(sessId) {
        const db = await openDb(server.dbPath);
        try {
            return await pAll(db, `SELECT user_id, case_id, session_id, verb FROM learning_events WHERE session_id = ? OR (session_id IS NULL AND verb = 'PRE_SESSION_PROBE') ORDER BY id`, [sessId]);
        } finally { await closeDb(db); }
    }

    it('overrides client-supplied case_id with the value from the sessions row', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                events: [{
                    session_id: sessionId,
                    case_id: caseIdWrong, // server must ignore
                    verb: 'VIEWED',
                    object_type: 'COMPONENT',
                }],
            }),
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.dropped).toBe(0);

        const rows = await readback(sessionId);
        expect(rows.length).toBe(1);
        expect(rows[0].case_id).toBe(caseIdReal); // not caseIdWrong
        expect(rows[0].user_id).toBe(userId);
    });

    it('drops events whose session_id is in another tenant', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                events: [
                    { session_id: sessionId, verb: 'VIEWED', object_type: 'COMPONENT' },
                    { session_id: crossTenantSessionId, verb: 'VIEWED', object_type: 'COMPONENT' },
                ],
            }),
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.dropped).toBe(1);
        expect(body.dropped_reasons.cross_tenant).toBe(1);

        const rows = await readback(crossTenantSessionId);
        expect(rows.length).toBe(0); // cross-tenant event never persisted
    });

    it('forces case_id NULL for events without session_id and uses JWT user_id', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                events: [{
                    session_id: null,
                    case_id: caseIdWrong, // ignored
                    verb: 'PRE_SESSION_PROBE', // not in allowlist; treated as missing field? Use a valid one.
                    object_type: 'COMPONENT',
                }],
            }),
        });
        // PRE_SESSION_PROBE isn't in the verb allowlist for /learning-events
        // (single endpoint validates), but the batch endpoint accepts any
        // verb the row schema accepts. So this should succeed.
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.inserted).toBe(1);

        const db = await openDb(server.dbPath);
        try {
            const row = await pAll(db,
                `SELECT user_id, case_id, session_id FROM learning_events WHERE verb = 'PRE_SESSION_PROBE' ORDER BY id DESC LIMIT 1`);
            expect(row.length).toBe(1);
            expect(row[0].session_id).toBeNull();
            expect(row[0].case_id).toBeNull();
            expect(row[0].user_id).toBe(userId);
        } finally { await closeDb(db); }
    });

    it('returns deterministic dropped_reasons accounting for missing required fields', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                events: [
                    { session_id: sessionId, verb: 'VIEWED', object_type: 'COMPONENT' },     // ok
                    { session_id: sessionId, verb: 'VIEWED' },                                 // missing object_type
                    { session_id: sessionId, object_type: 'COMPONENT' },                       // missing verb
                ],
            }),
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.dropped).toBe(2);
        expect(body.dropped_reasons.missing_required_field).toBe(2);
        expect(body.total).toBe(3);
    });
});
