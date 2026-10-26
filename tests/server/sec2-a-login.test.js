// Regression locks for the login findings of the security audit of 2026-10-26:
//   F-10  a locked account answered the RIGHT password 423 and a wrong one 401
//         — the lock was a password oracle;
//   F-11  a wrong password during an active lock renewed it (permanent lockout
//         with one request every 14 minutes), and there was no unlock path;
//   L1-11 the failure paths of known and unknown usernames differed by one
//         awaited write;
//   F-14  the JWT was returned in the body of login/register/refresh to every
//         caller, browsers included, so any injected script could mint a
//         portable bearer token via /auth/refresh.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { TEST_PASSWORD, asUser, closeDb, get, openDb, register, run, seedUser } from '../utils/authHttp.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BROWSER = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };

function login(baseUrl, username, password, headers = {}) {
    return fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ username, password }),
    });
}

const lockSql = `UPDATE users SET failed_login_attempts = 5, locked_until = datetime('now', '+10 minutes') WHERE username = ?`;

describe('login lockout, unlock, timing and the body token', () => {
    let server;
    let db;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { registration_mode: 'open' },
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        await seedUser(db, { username: 'login_root', role: 'admin' });
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock (F-10).
    it('a locked account gives the right and the wrong password the same 401 body', async () => {
        await seedUser(db, { username: 'oracle_target' });
        await run(db, lockSql, ['oracle_target']);
        const right = await login(server.baseUrl, 'oracle_target', TEST_PASSWORD);
        const wrong = await login(server.baseUrl, 'oracle_target', 'WrongPassw0rd');
        const unknown = await login(server.baseUrl, 'oracle_nobody', 'WrongPassw0rd');
        const bodies = await Promise.all([right, wrong, unknown].map((r) => r.json()));
        expect([right.status, wrong.status, unknown.status]).toEqual([401, 401, 401]);
        bodies.forEach((b) => expect(b).toEqual({ error: 'Invalid username or password' }));
    });

    // Regression lock (F-11): repeated misses during a lock never extend it.
    it('misses during an active lock leave locked_until and the counter untouched', async () => {
        await seedUser(db, { username: 'renew_target' });
        await run(db, lockSql, ['renew_target']);
        const before = await get(db, 'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?', ['renew_target']);
        for (let i = 0; i < 3; i++) {
             
            expect((await login(server.baseUrl, 'renew_target', 'WrongPassw0rd')).status).toBe(401);
        }
        const after = await get(db, 'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?', ['renew_target']);
        expect(after).toEqual(before);
    });

    // Regression lock (F-11): an admin can lift a lock with the existing status control.
    it('PATCH /users/:id/status {active} clears the lock, and the owner gets in', async () => {
        const id = await seedUser(db, { username: 'unlock_status' });
        await run(db, lockSql, ['unlock_status']);
        const admin = await asUser(server.baseUrl, 'login_root');
        const r = await admin(`/api/users/${id}/status`, { method: 'PATCH', json: { status: 'active' } });
        expect(r.status).toBe(200);
        const row = await get(db, 'SELECT failed_login_attempts, locked_until FROM users WHERE id = ?', [id]);
        expect(row).toEqual({ failed_login_attempts: 0, locked_until: null });
        expect((await login(server.baseUrl, 'unlock_status', TEST_PASSWORD)).status).toBe(200);
    });

    it('an admin password reset (PUT /users/:id) clears the lock too', async () => {
        const id = await seedUser(db, { username: 'unlock_reset' });
        await run(db, lockSql, ['unlock_reset']);
        const admin = await asUser(server.baseUrl, 'login_root');
        const r = await admin(`/api/users/${id}`, { method: 'PUT', json: { password: 'NewPassw0rd9' } });
        expect(r.status).toBe(200);
        expect((await login(server.baseUrl, 'unlock_reset', 'NewPassw0rd9')).status).toBe(200);
    });

    // Regression lock (F-11): a sole admin locked out has a CLI way back.
    it('scripts/unlock-user.js clears the lock of a named user', async () => {
        await seedUser(db, { username: 'unlock_cli', role: 'admin' });
        await run(db, lockSql, ['unlock_cli']);
        const code = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'unlock-user.js'), 'unlock_cli'], {
                cwd: repoRoot,
                env: { ...process.env, ROHY_DB: server.dbPath, ROHY_NO_AUTO_SEED: '1', NODE_ENV: 'test' },
                stdio: 'ignore',
            });
            child.once('error', reject);
            child.once('exit', resolve);
        });
        expect(code).toBe(0);
        const row = await get(db, 'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?', ['unlock_cli']);
        expect(row).toEqual({ failed_login_attempts: 0, locked_until: null });
        expect((await login(server.baseUrl, 'unlock_cli', TEST_PASSWORD)).status).toBe(200);
    }, 60_000);

    // Regression lock (L1-11): every failure answers no sooner than the floor.
    it('unknown-user and wrong-password failures both take at least the 250 ms floor', async () => {
        await seedUser(db, { username: 'timing_known' });
        const time = async (u) => {
            const t0 = performance.now();
            const r = await login(server.baseUrl, u, 'WrongPassw0rd');
            expect(r.status).toBe(401);
            return performance.now() - t0;
        };
        expect(await time('timing_nobody')).toBeGreaterThanOrEqual(245);
        expect(await time('timing_known')).toBeGreaterThanOrEqual(245);
    });

    describe('body token (F-14)', () => {
        beforeAll(async () => { await seedUser(db, { username: 'body_token' }); });

        // Regression lock: a browser login got the JWT in the body.
        it('a browser login (Sec-Fetch-Site) gets cookies but no body token', async () => {
            const r = await login(server.baseUrl, 'body_token', TEST_PASSWORD, BROWSER);
            expect(r.status).toBe(200);
            const body = await r.json();
            expect(body.token).toBeUndefined();
            expect(body.user.username).toBe('body_token');
            expect(r.headers.getSetCookie().some((c) => c.startsWith('rohy_auth='))).toBe(true);
        });

        it('a browser that opts in with X-Rohy-Auth: bearer, and a non-browser caller, still get it', async () => {
            const optIn = await login(server.baseUrl, 'body_token', TEST_PASSWORD, { ...BROWSER, 'x-rohy-auth': 'bearer' });
            expect(typeof (await optIn.json()).token).toBe('string');
            const tooling = await login(server.baseUrl, 'body_token', TEST_PASSWORD);
            expect(typeof (await tooling.json()).token).toBe('string');
        });

        // Regression lock: a cookie session in a browser could refresh itself into a bearer token.
        it('a cookie refresh from a browser gets no body token, even when it asks for one', async () => {
            const r = await login(server.baseUrl, 'body_token', TEST_PASSWORD, BROWSER);
            const jar = Object.fromEntries(r.headers.getSetCookie().map((c) => c.split(';')[0].split('=')));
            const refresh = await fetch(`${server.baseUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                    ...BROWSER, 'x-rohy-auth': 'bearer',
                    cookie: `rohy_auth=${jar.rohy_auth}; rohy_csrf=${jar.rohy_csrf}`, 'x-csrf-token': jar.rohy_csrf,
                },
            });
            expect(refresh.status).toBe(200);
            expect((await refresh.json()).token).toBeUndefined();
        });

        it('a bearer-authenticated refresh from a browser still learns its rotated token', async () => {
            const token = (await (await login(server.baseUrl, 'body_token', TEST_PASSWORD)).json()).token;
            const refresh = await fetch(`${server.baseUrl}/api/auth/refresh`, {
                method: 'POST', headers: { ...BROWSER, authorization: `Bearer ${token}` },
            });
            expect(refresh.status).toBe(200);
            const fresh = (await refresh.json()).token;
            expect(typeof fresh).toBe('string');
            expect(fresh).not.toBe(token);
        });

        it('a browser registration gets no body token', async () => {
            const res = await fetch(`${server.baseUrl}/api/auth/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...BROWSER },
                body: JSON.stringify({ username: 'body_reg', email: 'body_reg@example.com', password: 'GoodPassw0rd' }),
            });
            expect(res.status).toBe(201);
            expect((await res.json()).token).toBeUndefined();
            // …while the tooling path (no Fetch Metadata) keeps it.
            const tool = await register(server.baseUrl, { username: 'body_reg2', email: 'body_reg2@example.com', password: 'GoodPassw0rd' });
            expect(typeof tool.body.token).toBe('string');
        });
    });
});
