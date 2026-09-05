// The learning-event quarantine (migration 0056): nothing the ingest core
// refuses vanishes. Every reason writes a `learning_events_rejected` row; a
// forgery keeps only the payload's shape and produces an audit entry; the
// admin can read and export the table; readiness counts it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'Quarant1neT3sts!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}
async function seedUser(db, username, role = 'student', tenantId = 1) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenantId]);
    return r.lastID;
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}

describe('learning-event quarantine', () => {
    let server, studentToken, adminToken, studentId, sessionId, otherSessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            studentId = await seedUser(db, 'q-student');
            const other = await seedUser(db, 'q-other');
            await seedUser(db, 'q-admin', 'admin');
            const c = await pRun(db, `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('Q', '', 'p', '{}', 1)`);
            sessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`, [c.lastID, studentId])).lastID;
            otherSessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`, [c.lastID, other])).lastID;
        } finally { await closeDb(db); }
        studentToken = await login(server.baseUrl, 'q-student');
        adminToken = await login(server.baseUrl, 'q-admin');
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const post = (token, path, body) => fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    const rejected = async (where = '1=1', params = []) => {
        const db = await openDb(server.dbPath);
        try { return await pAll(db, `SELECT * FROM learning_events_rejected WHERE ${where} ORDER BY id ASC`, params); }
        finally { await closeDb(db); }
    };

    it('every drop reason writes exactly one quarantine row, with the payload', async () => {
        const before = (await rejected()).length;
        const res = await post(studentToken, '/api/learning-events/batch', {
            events: [
                { session_id: sessionId, verb: 'NOT_A_VERB', object_type: 'thing', context: { hello: 'world' } },
                { session_id: sessionId, verb: 'VIEWED' },
                { session_id: sessionId, verb: 'VIEWED', object_type: 'component', severity: 'BONKERS' },
                { session_id: sessionId, verb: 'LOGGED_IN', object_type: 'auth' },
            ],
        });
        const body = await res.json();
        expect(body.inserted).toBe(0);
        expect(body.dropped).toBe(4);
        expect(body.quarantined).toBe(4);
        const rows = (await rejected()).slice(before);
        expect(rows.map((r) => r.reason).sort()).toEqual(['invalid_metadata', 'missing_required_field', 'server_only_verb', 'unknown_verb']);
        const unknown = rows.find((r) => r.reason === 'unknown_verb');
        expect(unknown.verb).toBe('NOT_A_VERB');
        expect(unknown.user_id).toBe(studentId);
        expect(unknown.session_id).toBe(sessionId);
        expect(unknown.source).toBe('batch');
        expect(JSON.parse(unknown.payload_json).context).toEqual({ hello: 'world' });
        expect(unknown.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('a forgery keeps only the payload shape and is audited', async () => {
        const res = await post(studentToken, '/api/learning-events/batch', {
            events: [{ session_id: otherSessionId, verb: 'SENT_MESSAGE', object_type: 'chat_message', message_content: 'secret prose' }],
        });
        expect((await res.json()).dropped_reasons.not_owner).toBe(1);
        const [row] = await rejected('reason = ?', ['not_owner']);
        expect(row).toBeTruthy();
        expect(row.payload_json).not.toContain('secret prose');
        expect(JSON.parse(row.payload_json)._shape.message_content).toBe('string(12)');
        const db = await openDb(server.dbPath);
        try {
            const audit = await pAll(db, "SELECT action, status, error_message FROM system_audit_log WHERE action = 'learning_event_rejected' ORDER BY id DESC LIMIT 1");
            expect(audit.length).toBe(1);
            expect(audit[0].status).toBe('failure');
            expect(audit[0].error_message).toBe('not_owner');
        } finally { await closeDb(db); }
    });

    it('an oversized payload is truncated, not lost', async () => {
        const big = 'x'.repeat(10_000);
        await post(studentToken, '/api/learning-events', { session_id: sessionId, verb: 'NOT_A_VERB', object_type: 'thing', context: { big } });
        const rows = await rejected('reason = ?', ['unknown_verb']);
        const last = rows.at(-1);
        const payload = JSON.parse(last.payload_json);
        expect(payload._truncated).toBe(true);
        expect(payload._bytes).toBeGreaterThan(10_000);
        expect(Buffer.byteLength(last.payload_json, 'utf8')).toBeLessThan(4096);
    });

    it('the admin can read the quarantine, filtered, and export it', async () => {
        const res = await fetch(`${server.baseUrl}/api/analytics/rejected-events?reason=unknown_verb`, {
            headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.total).toBeGreaterThanOrEqual(2);
        expect(body.rejected.every((r) => r.reason === 'unknown_verb')).toBe(true);
        expect(body.by_reason.unknown_verb).toBe(body.total);

        const denied = await fetch(`${server.baseUrl}/api/analytics/rejected-events`, {
            headers: { authorization: `Bearer ${studentToken}` },
        });
        expect(denied.status).toBe(403);

        const csv = await fetch(`${server.baseUrl}/api/export/system-log/rejected`, {
            headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(csv.status).toBe(200);
        expect(await csv.text()).toContain('unknown_verb');
    });

    it('readiness reports the 24h rejected count', async () => {
        const res = await fetch(`${server.baseUrl}/api/ready`);
        const body = await res.json();
        expect(body.checks.ingest).toMatch(/^\d+ rejected\/24h$/);
        expect(Number(body.checks.ingest.split(' ')[0])).toBeGreaterThanOrEqual(6);
        expect(res.status).toBe(200);
    });
});
