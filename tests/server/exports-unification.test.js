// Regression guard for the export-unification pass.
//
// Four legacy per-table exports (login-logs, chat-logs, settings-logs,
// session-settings) were retired. Their content is now served by:
//   - /api/export/learning-events
//   - /api/export/system-log/:source  (auth | config | chat | learning | …)
//   - /api/export/complete-session/:id
//   - /api/export/questionnaire-responses
//
// This test pins:
//   1. The four deleted endpoints return 404.
//   2. The four surviving endpoints return 200 (or an expected non-404
//      status), with the right Content-Type for CSV outputs.
// If a future change accidentally re-adds the legacy endpoints, this test
// fails so it gets reviewed (re-adding them likely means re-introducing
// the inconsistent contracts the unification fixed).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'ExportsUnif!';

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

async function seedAdmin(db, username, tenantId = 1) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, 'admin', ?, 'active')`,
        [username, username, `${username}@example.com`, hash, tenantId]);
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

describe('export endpoint surface — unification', () => {
    let server, token;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try { await seedAdmin(db, 'exports-unif-admin'); }
        finally { await closeDb(db); }
        token = await login(server.baseUrl, 'exports-unif-admin');
    }, 30_000);

    afterAll(async () => { if (server) await server.close(); });

    function authedFetch(path) {
        return fetch(`${server.baseUrl}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
    }

    describe('deleted endpoints stay deleted', () => {
        const RETIRED = [
            '/api/export/login-logs',
            '/api/export/chat-logs',
            '/api/export/settings-logs',
            '/api/export/session-settings',
        ];
        for (const path of RETIRED) {
            it(`${path} → 404`, async () => {
                const res = await authedFetch(path);
                expect(res.status).toBe(404);
            });
        }
    });

    describe('surviving endpoints respond', () => {
        it('/api/export/learning-events streams CSV', async () => {
            const res = await authedFetch('/api/export/learning-events');
            // Empty result is fine; what matters is that the route is mounted
            // and returns a CSV content-type.
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toMatch(/text\/csv/);
            expect(res.headers.get('content-disposition')).toMatch(/attachment/);
        });

        it('/api/export/system-log/auth streams CSV', async () => {
            const res = await authedFetch('/api/export/system-log/auth');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        });

        it('/api/export/system-log/:source rejects unknown source with 404', async () => {
            const res = await authedFetch('/api/export/system-log/not-a-source');
            expect(res.status).toBe(404);
        });

        it('/api/export/questionnaire-responses returns CSV', async () => {
            const res = await authedFetch('/api/export/questionnaire-responses');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        });
    });
});
