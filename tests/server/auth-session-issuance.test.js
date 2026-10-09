import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'SessionIssue1!';
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});

describe('new auth sessions must be persisted before credentials are issued', () => {
    let server;
    let db;
    const post = (path, body) => fetch(`${server.baseUrl}/api/auth/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const rejectSessions = () => run(db,
        `CREATE TRIGGER reject_test_session BEFORE INSERT ON active_sessions
         BEGIN SELECT RAISE(ABORT, 'synthetic session persistence failure'); END`
    );

    beforeAll(async () => {
        server = await startTestServer({
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
            platformSettings: { registration_mode: 'open' },
        });
        db = await new Promise((resolve, reject) => {
            const connection = new sqlite3.Database(server.dbPath, err => err ? reject(err) : resolve(connection));
        });
        await run(db,
            `INSERT INTO users (username, email, password_hash, role, status, tenant_id)
             VALUES ('session-login-user', 'session-login@example.com', ?, 'student', 'active', 1)`,
            [await bcrypt.hash(PASSWORD, 4)]
        );
    });
    afterAll(async () => {
        if (db) await new Promise(resolve => db.close(resolve));
        await server?.close();
    });

    it('returns no token or cookies when login session storage fails, then recovers', async () => {
        await rejectSessions();
        try {
            const response = await post('login', { username: 'session-login-user', password: PASSWORD });
            expect(response.status).toBe(503);
            expect(response.headers.get('set-cookie')).toBeNull();
            const body = await response.json();
            expect(body.code).toBe('session_unavailable');
            expect(body.token).toBeUndefined();
        } finally {
            await run(db, 'DROP TRIGGER IF EXISTS reject_test_session');
        }
        const recovered = await post('login', { username: 'session-login-user', password: PASSWORD });
        expect(recovered.status).toBe(200);
        expect((await recovered.json()).token).toBeTruthy();
        expect(recovered.headers.get('set-cookie')).toContain('rohy_auth=');
    });

    it('keeps a registered account usable but issues no credentials if session storage fails', async () => {
        await rejectSessions();
        try {
            const response = await post('register', {
                username: 'session-register-user', email: 'session-register@example.com', password: PASSWORD,
            });
            expect(response.status).toBe(503);
            expect(response.headers.get('set-cookie')).toBeNull();
            const body = await response.json();
            expect(body.code).toBe('session_unavailable');
            expect(body.token).toBeUndefined();
        } finally {
            await run(db, 'DROP TRIGGER IF EXISTS reject_test_session');
        }
        const recovered = await post('login', { username: 'session-register-user', password: PASSWORD });
        expect(recovered.status).toBe(200);
        expect((await recovered.json()).token).toBeTruthy();
    });
});
