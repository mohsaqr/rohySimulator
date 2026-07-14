// Target-rank guards on the admin user-management routes.
//
// Regression guard: PUT /users/:id and DELETE /users/:id checked the REQUESTED
// role against the actor but never the TARGET's rank — unlike PATCH
// /users/:id/status and POST /users/bulk-action, which both refuse a target at
// or above the actor. So any admin could open a peer admin and set a new
// password (the body.password branch hashes and writes it): lateral account
// takeover, leaving only an audit row. The client hid Delete for peers but
// rendered Edit unconditionally — and a hidden button is not a security
// boundary, since the API is reachable directly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'RankGuard1!';
const NEW_PASSWORD = 'Attacker9!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function seedUser(db, username, role) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
    return r.lastID;
}

async function login(baseUrl, username, password = PASSWORD) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

function authed(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

describe('user-management target-rank guards', () => {
    let server;
    let adminA;
    let ids = {};

    beforeAll(async () => {
        server = await startTestServer({ seed: false, env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        const db = await openDb(server.dbPath);
        try {
            ids.adminA = await seedUser(db, 'rg-admin-a', 'admin');
            ids.adminB = await seedUser(db, 'rg-admin-b', 'admin');
            ids.educator = await seedUser(db, 'rg-educator', 'educator');
            ids.student = await seedUser(db, 'rg-student', 'student');
        } finally {
            await closeDb(db);
        }
        adminA = authed(server.baseUrl, (await login(server.baseUrl, 'rg-admin-a')).body.token);
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('refuses to let an admin edit a PEER admin', async () => {
        const res = await adminA(`/api/users/${ids.adminB}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'Renamed by a peer' }),
        });
        expect(res.status).toBe(403);
    });

    // The whole point: the peer's password must be untouched afterwards.
    it('does not let an admin reset a PEER admin password', async () => {
        const attack = await adminA(`/api/users/${ids.adminB}`, {
            method: 'PUT',
            body: JSON.stringify({ password: NEW_PASSWORD }),
        });
        expect(attack.status).toBe(403);

        // The attacker's password does not work...
        expect((await login(server.baseUrl, 'rg-admin-b', NEW_PASSWORD)).status).toBe(401);
        // ...and the real one still does.
        const real = await login(server.baseUrl, 'rg-admin-b');
        expect(real.status).toBe(200);
        expect(real.body.user.role).toBe('admin');
    });

    it('refuses to let an admin delete a PEER admin', async () => {
        const res = await adminA(`/api/users/${ids.adminB}`, { method: 'DELETE' });
        expect(res.status).toBe(403);
        expect((await login(server.baseUrl, 'rg-admin-b')).status).toBe(200);
    });

    it('still lets an admin edit THEMSELVES', async () => {
        const res = await adminA(`/api/users/${ids.adminA}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'Admin A (self-renamed)' }),
        });
        expect(res.status).toBe(200);
    });

    it('still lets an admin edit and delete users below their rank', async () => {
        const edit = await adminA(`/api/users/${ids.educator}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'Educator, renamed' }),
        });
        expect(edit.status).toBe(200);

        const del = await adminA(`/api/users/${ids.student}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
    });

    it('keeps the pre-existing guards intact (status + bulk-action on a peer)', async () => {
        const status = await adminA(`/api/users/${ids.adminB}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'suspended' }),
        });
        expect(status.status).toBe(403);

        const bulk = await adminA('/api/users/bulk-action', {
            method: 'POST',
            body: JSON.stringify({ action: 'suspend', ids: [ids.adminB] }),
        });
        expect(bulk.status).toBe(200);
        const body = await bulk.json();
        expect(body.results.success).toHaveLength(0);
        expect(body.results.failed[0].error).toMatch(/at or above your role/);
    });
});
