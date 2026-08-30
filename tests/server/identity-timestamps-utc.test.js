// Regression lock: `users.created_at` and `oyon_settings.updated_at` are
// stamped in the one UTC ISO time shape (UI swarm finding #37, v2.9.108).
//
// Migration 0050 normalised the log tables and 0051 the domain tables, but
// these two writers were left naive and re-armed the trap behind them:
//
//   * every `INSERT INTO users` omitted `created_at`, so the column default
//     `CURRENT_TIMESTAMP` wrote sqlite's legacy "YYYY-MM-DD HH:MM:SS" — UTC,
//     but with nothing saying so. `new Date()` on that shape parses as LOCAL
//     time, which is exactly how `users.last_login` came to read three hours
//     stale in the field before 0051 fixed it. Five INSERT sites (auth-routes
//     register, users-routes create/batch/import, registration-routes approve)
//     plus the first-boot seeder.
//   * `PUT /addons/oyon/settings` wrote `updated_at = CURRENT_TIMESTAMP` and
//     returned the value straight to the admin UI.
//
// A column holding BOTH shapes is worse than one uniformly legacy: `ORDER BY`
// on a TEXT column is a string sort and ' ' (0x20) sorts before 'T' (0x54), so
// every legacy row sorts ahead of every ISO row whatever the instants are.
// These tests pin every write path that reaches those columns.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { ISO_Z_RE } from '../../server/shared/time.js';

const PASSWORD = 'StampTest1!';
const NEW_USER_PASSWORD = 'MadeByAdmin1!';

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
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
    );
}
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
}

let server;
let db;
let adminToken;

const post = (path, body) =>
    fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
    });

async function createdAtOf(username) {
    const row = await pGet(db, 'SELECT created_at FROM users WHERE username = ?', [username]);
    expect(row, `user ${username} was not created`).toBeTruthy();
    return row.created_at;
}

beforeAll(async () => {
    // OYON_ENABLED=1 so /addons/oyon/settings is the real router rather than
    // the disabled stub; registration_mode=open so the self-service register
    // path (auth-routes' INSERT) is reachable.
    server = await startTestServer({
        env: { OYON_ENABLED: '1' },
        platformSettings: { registration_mode: 'open' },
    });
    db = await openDb(server.dbPath);

    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status, created_at)
         VALUES ('stamp-admin', 'stamp', 'stamp@example.com', ?, 'admin', 1, 'active',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        [hash]
    );

    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'stamp-admin', password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    adminToken = (await res.json()).token;
}, 90_000);

afterAll(async () => {
    if (db) await closeDb(db);
    if (server) await server.close();
});

describe('users.created_at', () => {
    it('is UTC ISO for the users the first-boot seeder writes', async () => {
        const rows = await pAll(
            db,
            `SELECT username, created_at FROM users WHERE username != 'stamp-admin'`
        );
        // The boot seeder runs when the users table is empty, so a fresh test
        // DB always has these.
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.created_at, `seeded user ${row.username}`).toMatch(ISO_Z_RE);
        }
    });

    it('is UTC ISO for POST /api/users/create (admin create)', async () => {
        const res = await post('/api/users/create', {
            username: 'stamp-created',
            name: 'Created',
            email: 'stamp-created@example.com',
            password: NEW_USER_PASSWORD,
            role: 'student',
        });
        expect(res.status).toBe(201);
        expect(await createdAtOf('stamp-created')).toMatch(ISO_Z_RE);
    });

    it('is UTC ISO for POST /api/users/batch', async () => {
        const res = await post('/api/users/batch', {
            users: [{
                username: 'stamp-batch',
                name: 'Batch',
                email: 'stamp-batch@example.com',
                password: NEW_USER_PASSWORD,
                role: 'student',
            }],
        });
        expect(res.status).toBeLessThan(300);
        expect(await createdAtOf('stamp-batch')).toMatch(ISO_Z_RE);
    });

    it('is UTC ISO for POST /api/auth/register (self-service)', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: 'stamp-registered',
                name: 'Registered',
                email: 'stamp-registered@example.com',
                password: NEW_USER_PASSWORD,
            }),
        });
        expect(res.status).toBe(201);
        expect(await createdAtOf('stamp-registered')).toMatch(ISO_Z_RE);
    });

    it('leaves no row in the legacy naive shape', async () => {
        // The mixed-shape column is the state migration 0052 exists to remove;
        // a single naive row means a writer was missed.
        const naive = await pAll(
            db,
            `SELECT username, created_at FROM users
              WHERE created_at IS NOT NULL
                AND created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`
        );
        expect(naive).toEqual([]);
    });

    it('reads back as the same instant the server clock says', async () => {
        const stamped = Date.parse(await createdAtOf('stamp-created'));
        expect(Math.abs(stamped - Date.now())).toBeLessThan(120_000);
    });
});

describe('oyon_settings timestamps', () => {
    it('are UTC ISO after the lazy row materialises and after a save', async () => {
        const before = await fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
            headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(before.status).toBe(200);
        const current = await before.json();

        const row = await pGet(db, 'SELECT created_at, updated_at FROM oyon_settings LIMIT 1');
        expect(row).toBeTruthy();
        expect(row.created_at).toMatch(ISO_Z_RE);

        // PUT is a full replace for the boolean flags, so echo the current
        // settings back with one field changed rather than sending a partial.
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ ...(current.settings || current), retention_days: 42 }),
        });
        expect(res.status).toBeLessThan(300);

        const after = await pGet(db, 'SELECT updated_at FROM oyon_settings LIMIT 1');
        // Un-fixed: '2026-08-30 14:07:08' — UTC, but read as local time by
        // every browser that renders it.
        expect(after.updated_at).toMatch(ISO_Z_RE);
    });
});
