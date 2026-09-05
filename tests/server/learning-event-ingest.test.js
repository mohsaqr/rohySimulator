// The one write path into learning_events (server/lib/learningEventIngest.js).
//
// Every writer — the single and batch routes, the auth and orders writers,
// the settings dual-write, the plugin server slot — now goes through
// ingestEvents(). These tests pin what that buys: derived severity/category
// on every row, the server's clock on every row, alias-normalised verbs,
// vitals and client_time on the single path too, and the historical
// status-code contract of the single route.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { ISO_Z_RE } from '../../server/shared/time.js';

const PASSWORD = 'IngestC0reT3sts!';

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
async function seedCase(db, name, tenantId = 1) {
    const r = await pRun(db,
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES (?, '', 'p', '{}', ?)`,
        [name, tenantId]);
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
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}

describe('learning-event ingest core', () => {
    let server, token, userId, caseId, sessionId, otherSessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            userId = await seedUser(db, 'ingest-owner');
            const other = await seedUser(db, 'ingest-other');
            caseId = await seedCase(db, 'Ingest Case');
            sessionId = await seedSession(db, userId, caseId);
            otherSessionId = await seedSession(db, other, caseId);
        } finally {
            await closeDb(db);
        }
        token = await login(server.baseUrl, 'ingest-owner');
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const post = (path, body) => fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    const rowsFor = async (sid) => {
        const db = await openDb(server.dbPath);
        try {
            return await pAll(db, 'SELECT * FROM learning_events WHERE session_id = ? ORDER BY id ASC', [sid]);
        } finally { await closeDb(db); }
    };

    it('the single path now carries vitals, client_time and the server clock', async () => {
        const res = await post('/api/learning-events', {
            session_id: sessionId, verb: 'ORDERED_TREATMENT', object_type: 'medication',
            object_id: 'asa', object_name: 'Aspirin',
            vital_hr: 88, vital_spo2: 97, client_time: '2026-05-01T09:00:00.000Z', offset_ms: 250,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBeGreaterThan(0);
        const row = (await rowsFor(sessionId)).at(-1);
        expect(row.verb).toBe('ORDERED_TREATMENT');
        expect(row.vital_hr).toBe(88);
        expect(row.vital_spo2).toBe(97);
        expect(row.client_time).toBe('2026-05-01T09:00:00.000Z');
        expect(row.timestamp).toMatch(ISO_Z_RE);
        // A drug order is CRITICAL by object type; category is derived.
        expect(row.severity).toBe('CRITICAL');
        expect(row.category).toBe('CLINICAL');
        expect(row.user_id).toBe(userId);
        expect(row.case_id).toBe(caseId);
    });

    it('reads a historical verb name as its canonical one on both paths', async () => {
        await post('/api/learning-events', { session_id: sessionId, verb: 'VIEWED_HISTORY', object_type: 'patient_record' });
        await post('/api/learning-events/batch', { events: [{ session_id: sessionId, verb: 'ALARM_TRIGGERED', object_type: 'alarm' }] });
        const rows = await rowsFor(sessionId);
        expect(rows.at(-2).verb).toBe('VIEWED_RECORD');
        expect(rows.at(-1).verb).toBe('TRIGGERED_ALARM');
        expect(rows.at(-1).severity).toBe('CRITICAL');
        expect(rows.at(-1).category).toBe('MONITORING');
    });

    it('keeps the single route status contract: 400 unknown verb, 403 not_owner, 404 cross_tenant', async () => {
        const unknown = await post('/api/learning-events', { session_id: sessionId, verb: 'NOT_A_VERB', object_type: 'x' });
        expect(unknown.status).toBe(400);
        expect((await unknown.json()).code).toBe('unknown_verb');

        const forged = await post('/api/learning-events', { session_id: otherSessionId, verb: 'VIEWED', object_type: 'component' });
        expect(forged.status).toBe(403);
        expect((await forged.json()).reason).toBe('not_owner');

        const missing = await post('/api/learning-events', { session_id: 999999, verb: 'VIEWED', object_type: 'component' });
        expect(missing.status).toBe(404);

        const noType = await post('/api/learning-events', { session_id: sessionId, verb: 'VIEWED' });
        expect(noType.status).toBe(400);
        expect((await noType.json()).error).toMatch(/object_type/);
    });

    it('a client may not write a server-only verb', async () => {
        const res = await post('/api/learning-events', { session_id: sessionId, verb: 'LOGGED_IN', object_type: 'auth' });
        expect(res.status).toBe(400);
        expect((await res.json()).reason).toBe('server_only_verb');
        const batch = await post('/api/learning-events/batch', { events: [{ session_id: sessionId, verb: 'ORDERED_LAB', object_type: 'lab_test' }] });
        const body = await batch.json();
        expect(body.inserted).toBe(0);
        expect(body.dropped_reasons.server_only_verb).toBe(1);
    });

    it('the batch response keeps the six legacy keys and appends the new ones', async () => {
        const res = await post('/api/learning-events/batch', { events: [{ session_id: sessionId, verb: 'VIEWED', object_type: 'component' }] });
        const body = await res.json();
        for (const k of ['cross_tenant', 'not_owner', 'missing_required_field', 'unknown_verb', 'invalid_metadata', 'db_error']) {
            expect(body.dropped_reasons).toHaveProperty(k);
        }
        expect(body.dropped_reasons).toHaveProperty('server_only_verb');
        expect(body).toHaveProperty('quarantined');
        expect(body).toHaveProperty('stripped_reasons');
        expect(body.inserted).toBe(1);
    });

    it('the server writers land severity and category (the orders regression)', async () => {
        // The LOGGED_IN row written at login went through recordServerEvent.
        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db, "SELECT verb, severity, category, timestamp, room FROM learning_events WHERE verb = 'LOGGED_IN' AND user_id = ?", [userId]);
            expect(rows.length).toBeGreaterThanOrEqual(1);
            expect(rows[0].severity).toBe('INFO');
            expect(rows[0].category).toBe('SESSION');
            expect(rows[0].timestamp).toMatch(ISO_Z_RE);
            expect(rows[0].room).toBeNull();
        } finally { await closeDb(db); }
    });
});
