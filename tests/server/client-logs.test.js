import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'ClientLogs1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}

function closeDb(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); });
    });
}

function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

async function seedUser(db, { username, role, tenantId = 1 }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenantId]
    );
    return r.lastID;
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

function authed(baseUrl, token) {
    return (path, init = {}) => fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(init.headers || {}),
        },
    });
}

function validEntry(overrides = {}) {
    return {
        level: 'info',
        component: 'DiagnosticBar',
        msg: 'client log message',
        fields: { ok: true },
        ts: '2026-05-07T12:00:00.000Z',
        ...overrides,
    };
}

describe('/api/client-logs', () => {
    let server;
    let db;
    let adminFetch;
    let educatorFetch;
    let studentFetch;
    let otherTenantAdminFetch;
    let studentId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        db = await openDb(server.dbPath);
        await seedUser(db, { username: 'cl-admin', role: 'admin' });
        await seedUser(db, { username: 'cl-educator', role: 'educator' });
        studentId = await seedUser(db, { username: 'cl-student', role: 'student' });
        await seedUser(db, { username: 'cl-other-admin', role: 'admin', tenantId: 2 });

        adminFetch = authed(server.baseUrl, await login(server.baseUrl, 'cl-admin'));
        educatorFetch = authed(server.baseUrl, await login(server.baseUrl, 'cl-educator'));
        studentFetch = authed(server.baseUrl, await login(server.baseUrl, 'cl-student'));
        otherTenantAdminFetch = authed(server.baseUrl, await login(server.baseUrl, 'cl-other-admin'));
    }, 30_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    it('accepts a valid batch and persists request/user/session correlation', async () => {
        const res = await studentFetch('/api/client-logs/batch', {
            method: 'POST',
            headers: {
                'X-Request-Id': '123e4567-e89b-42d3-a456-426614174000',
                'X-Rohy-Session-Id': '44',
            },
            body: JSON.stringify({ entries: [validEntry()] }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ accepted: 1, rejected: 0 });

        const rows = await pAll(db, 'SELECT * FROM client_logs WHERE request_id = ?', ['123e4567-e89b-42d3-a456-426614174000']);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            tenant_id: 1,
            user_id: studentId,
            session_id: 44,
            level: 'info',
            component: 'DiagnosticBar',
            msg: 'client log message',
        });
        expect(JSON.parse(rows[0].fields_json)).toEqual({ ok: true });
    });

    it('rejects malformed batches', async () => {
        const cases = [
            { body: { entries: validEntry() }, error: /entries array/i },
            { body: { entries: [validEntry({ level: 'fatal' })] }, error: /level/i },
            { body: { entries: [validEntry({ component: '' })] }, error: /component/i },
            { body: { entries: [validEntry({ msg: 42 })] }, error: /msg/i },
            { body: { entries: [validEntry({ fields: [] })] }, error: /fields/i },
            { body: { entries: [validEntry({ ts: 'not-a-date' })] }, error: /timestamp/i },
        ];

        for (const c of cases) {
            const res = await studentFetch('/api/client-logs/batch', {
                method: 'POST',
                body: JSON.stringify(c.body),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(c.error);
        }
    });

    it('rate-limits client log batches per user', async () => {
        let limited = null;
        for (let i = 0; i < 61; i += 1) {
            const res = await studentFetch('/api/client-logs/batch', {
                method: 'POST',
                body: JSON.stringify({ entries: [validEntry({ msg: `rate ${i}` })] }),
            });
            if (res.status === 429) {
                limited = res;
                break;
            }
        }
        expect(limited?.status).toBe(429);
    });

    it('returns tenant-scoped logs newest-first for educator/admin users', async () => {
        await pRun(
            db,
            `INSERT INTO client_logs (tenant_id, user_id, session_id, request_id, level, component, msg, fields_json, ts, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [1, studentId, 77, 'req-old', 'debug', 'OldComp', 'old row', null, '2026-05-07T10:00:00.000Z', '2026-05-07 10:00:00']
        );
        await pRun(
            db,
            `INSERT INTO client_logs (tenant_id, user_id, session_id, request_id, level, component, msg, fields_json, ts, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [1, studentId, 77, 'req-new', 'error', 'NewComp', 'new row', null, '2026-05-07T10:01:00.000Z', '2026-05-07 10:01:00']
        );
        await pRun(
            db,
            `INSERT INTO client_logs (tenant_id, user_id, session_id, request_id, level, component, msg, fields_json, ts, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [2, null, 77, 'req-other-tenant', 'info', 'Other', 'other tenant', null, '2026-05-07T10:02:00.000Z', '2026-05-07 10:02:00']
        );

        const res = await educatorFetch('/api/client-logs?session_id=77&limit=10');
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids = body.logs.map((row) => row.request_id);
        expect(ids.indexOf('req-new')).toBeLessThan(ids.indexOf('req-old'));
        expect(ids).not.toContain('req-other-tenant');

        const other = await otherTenantAdminFetch('/api/client-logs?session_id=77&limit=10');
        expect((await other.json()).logs.map((row) => row.request_id)).toEqual(['req-other-tenant']);
    });

    it('forbids non-educator users from reading client logs', async () => {
        const res = await studentFetch('/api/client-logs');
        expect(res.status).toBe(403);
    });

    it('allows admins to read client logs', async () => {
        const res = await adminFetch('/api/client-logs?limit=1');
        expect(res.status).toBe(200);
        expect(Array.isArray((await res.json()).logs)).toBe(true);
    });
});
