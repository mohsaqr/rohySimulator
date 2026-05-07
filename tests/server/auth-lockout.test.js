// Regression lock: failed-login threshold must lock the account, not crash.
//
// During the routes.js → routes/*-routes.js split (commit 3a7a330), the
// MAX_FAILED_LOGINS and LOCKOUT_MINUTES module-locals were dropped from
// auth-routes.js. The threshold branch ReferenceError'd in production —
// any 5th wrong-password attempt crashed the request. Restored constants
// at auth-routes.js top; this test fires 5 wrong passwords in a row and
// asserts the 5th lands as a 401 (not a 500), and the account is locked.
//
// If you remove the constants again, the 5th attempt comes back 500 and
// this test fails — that is the regression lock.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

describe('POST /api/auth/login — failed-login lockout', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'student', 'active', 1)`,
            ['lockout_user', 'Lockout User', hash, 'lockout@example.com'],
        );
        await dbClose(db);
    });

    afterAll(async () => { await server?.close(); });

    it('locks the account after 5 wrong passwords without throwing', async () => {
        const wrongLogin = () => fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'lockout_user', password: 'wrongpass' }),
        });

        for (let i = 0; i < 4; i++) {
            const r = await wrongLogin();
            expect(r.status).toBe(401);
        }

        // The 5th attempt crosses MAX_FAILED_LOGINS (5). Pre-fix this raised
        // ReferenceError → 500. Post-fix: 401 + locked_until populated.
        const r = await wrongLogin();
        expect(r.status).toBe(401);

        const db = await openDb(server.dbPath);
        const row = await dbGet(
            db,
            'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?',
            ['lockout_user'],
        );
        await dbClose(db);
        expect(row.failed_login_attempts).toBeGreaterThanOrEqual(5);
        expect(row.locked_until).toBeTruthy();
    });
});
