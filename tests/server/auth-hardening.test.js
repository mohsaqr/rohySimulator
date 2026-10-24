// Regression locks for the authentication findings of the security audit of
// 2026-10-24 (the fail-closed session row is locked in middleware/auth.test.js,
// the env rules in validateEnv.test.js, the registration hash in
// registration-pathways.test.js):
//
//   - an EXPIRED lockout restarts the failure count (it used to re-lock on
//     every single wrong password after the first lock);
//   - login does not reveal whether an account exists, is disabled or is
//     locked to someone who does not know its password;
//   - registration normalises and bounds username/email; login trims; the
//     username copied into login_logs on failure is capped;
//   - the terms-of-use gate is enforced by the server (451), not only the UI;
//   - /ready and /health/plugins are rate-limited, /health is not;
//   - the auth cookies are Secure whenever the public URL is https.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import {
    TEST_PASSWORD, all, asUser, closeDb, get, openDb, register, run, seedUser,
} from '../utils/authHttp.js';
import { cookieSecure } from '../../server/middleware/authTtl.js';
import { csrfCookieOptions } from '../../server/middleware/csrf.js';
import { termsGateExempt } from '../../server/middleware/termsGate.js';

const REG_PASSWORD = 'Hardening1!';

/** Re-run `read` until `ok(result)` holds, for rows the server writes after it has answered. */
async function eventually(read, ok, { timeoutMs = 3000, stepMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, stepMs));
        last = await read();
    }
    return last;
}

function loginRaw(baseUrl, username, password) {
    return fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
}

describe('login, lockout and registration hardening', () => {
    let server;
    let db;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { registration_mode: 'open' },
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        // An existing admin, so a signup below is not a bootstrap claim.
        await seedUser(db, { username: 'hard_root', role: 'admin' });
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    describe('lockout counter', () => {
        // Regression lock: an expired lockout restarts the failure count. The
        // counter used to survive the lock, so after the first lockout every
        // wrong password re-locked the account for another 15 minutes.
        it('a wrong password after the lock EXPIRED counts as attempt 1, not 6', async () => {
            await seedUser(db, { username: 'lock_expired' });
            await run(db, `UPDATE users SET failed_login_attempts = 5,
                locked_until = datetime('now', '-1 minute') WHERE username = ?`, ['lock_expired']);

            const r = await loginRaw(server.baseUrl, 'lock_expired', 'WrongPassw0rd');
            expect(r.status).toBe(401);
            const row = await get(db,
                'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?', ['lock_expired']);
            expect(row.failed_login_attempts).toBe(1);
            expect(row.locked_until).toBeNull();

            // …and the right password still gets in straight away.
            expect((await loginRaw(server.baseUrl, 'lock_expired', TEST_PASSWORD)).status).toBe(200);
        });

        it('a wrong password during an ACTIVE lock keeps counting (and keeps it locked)', async () => {
            await seedUser(db, { username: 'lock_active' });
            await run(db, `UPDATE users SET failed_login_attempts = 5,
                locked_until = datetime('now', '+10 minutes') WHERE username = ?`, ['lock_active']);

            expect((await loginRaw(server.baseUrl, 'lock_active', 'WrongPassw0rd')).status).toBe(401);
            const row = await get(db,
                'SELECT failed_login_attempts, locked_until FROM users WHERE username = ?', ['lock_active']);
            expect(row.failed_login_attempts).toBe(6);
            expect(row.locked_until).toBeTruthy();
        });
    });

    describe('account enumeration', () => {
        // Regression lock: unknown/disabled/locked used to answer differently
        // (instant 401 / 403 / 423) BEFORE the password was checked.
        it('unknown username, disabled and locked accounts all answer a wrong password with the same 401', async () => {
            await seedUser(db, { username: 'enum_active' });
            await seedUser(db, { username: 'enum_disabled', status: 'inactive' });
            await seedUser(db, { username: 'enum_locked' });
            await run(db, `UPDATE users SET failed_login_attempts = 5,
                locked_until = datetime('now', '+10 minutes') WHERE username = ?`, ['enum_locked']);

            const answers = await Promise.all(
                ['enum_active', 'enum_disabled', 'enum_locked', 'enum_nobody_here'].map(async (u) => {
                    const r = await loginRaw(server.baseUrl, u, 'WrongPassw0rd');
                    return { status: r.status, body: await r.json() };
                }),
            );
            answers.forEach((a) => {
                expect(a).toEqual({ status: 401, body: { error: 'Invalid username or password' } });
            });
        });

        it('an unknown username still pays for a bcrypt compare (no instant answer)', async () => {
            const started = performance.now();
            const r = await loginRaw(server.baseUrl, 'enum_timing_nobody', 'WrongPassw0rd');
            const elapsed = performance.now() - started;
            expect(r.status).toBe(401);
            // A cost-10 compare is tens of ms on any machine; the old early
            // return answered in about one. Loose bound — load only adds time.
            expect(elapsed).toBeGreaterThan(15);
        });

        it('disabled (403) and locked (423) are told only to someone with the right password', async () => {
            await seedUser(db, { username: 'enum_disabled_ok', status: 'inactive' });
            await seedUser(db, { username: 'enum_locked_ok' });
            await run(db, `UPDATE users SET failed_login_attempts = 5,
                locked_until = datetime('now', '+10 minutes') WHERE username = ?`, ['enum_locked_ok']);

            const disabled = await loginRaw(server.baseUrl, 'enum_disabled_ok', TEST_PASSWORD);
            expect(disabled.status).toBe(403);
            expect((await disabled.json()).code).toBe('account_disabled');
            expect((await loginRaw(server.baseUrl, 'enum_locked_ok', TEST_PASSWORD)).status).toBe(423);
        });

        it('a wrong password on a disabled account still counts toward lockout and is logged', async () => {
            const id = await seedUser(db, { username: 'enum_disabled_count', status: 'inactive' });
            await loginRaw(server.baseUrl, 'enum_disabled_count', 'WrongPassw0rd');
            const row = await get(db, 'SELECT failed_login_attempts FROM users WHERE id = ?', [id]);
            expect(row.failed_login_attempts).toBe(1);
            // The login_logs row is written fire-and-forget after the 401 is
            // sent (the response must not wait on the log), so give it a moment.
            const logs = await eventually(() => all(db,
                `SELECT action FROM login_logs WHERE user_id = ? AND action = 'failed_login'`, [id]), (r) => r.length > 0);
            expect(logs.length).toBe(1);
        });
    });

    describe('input normalisation', () => {
        // Regression lock: register stored username/email exactly as sent, so
        // `Alice@Example.com` and `alice@example.com` were two accounts and a
        // username could carry spaces, control characters or kilobytes.
        it('trims the username and trims + lower-cases the email on register', async () => {
            const r = await register(server.baseUrl, {
                username: '  Norm_User.1 ', email: '  Norm.User@Example.COM ', password: REG_PASSWORD,
            });
            expect(r.status).toBe(201);
            const row = await get(db, 'SELECT username, email FROM users WHERE username = ?', ['Norm_User.1']);
            expect(row).toEqual({ username: 'Norm_User.1', email: 'norm.user@example.com' });
        });

        it.each([
            ['a username with a space', { username: 'two words', email: 'tw@example.com' }],
            ['a username shorter than 3', { username: 'ab', email: 'ab@example.com' }],
            ['a username longer than 64', { username: 'u'.repeat(65), email: 'long@example.com' }],
            ['an email with two @', { username: 'two_at', email: 'a@b@example.com' }],
            ['an email with no @', { username: 'no_at', email: 'example.com' }],
            ['an email over 254 chars', { username: 'long_mail', email: `${'m'.repeat(250)}@example.com` }],
        ])('refuses %s with 400 invalid_identity', async (_label, ident) => {
            const r = await register(server.baseUrl, { ...ident, password: REG_PASSWORD });
            expect(r.status).toBe(400);
            expect(r.body.code).toBe('invalid_identity');
        });

        it('login trims the submitted username', async () => {
            await seedUser(db, { username: 'trim_login' });
            expect((await loginRaw(server.baseUrl, '  trim_login  ', TEST_PASSWORD)).status).toBe(200);
        });

        // Regression lock: login_logs kept whatever username a failed attempt sent.
        it('caps the username written to login_logs for a failed attempt at 128 chars', async () => {
            const huge = `cap_${'x'.repeat(2000)}`;
            expect((await loginRaw(server.baseUrl, huge, 'WrongPassw0rd')).status).toBe(401);
            // Written fire-and-forget after the response; poll briefly.
            const row = await eventually(() => get(db,
                `SELECT username FROM login_logs WHERE username LIKE 'cap_x%' ORDER BY id DESC LIMIT 1`), (r) => Boolean(r));
            expect(row.username.length).toBe(128);
        });
    });
});

describe('terms of use — enforced by the server', () => {
    let server;
    let db;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { terms_required: '1' },
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        await seedUser(db, { username: 'terms_student' });
        await seedUser(db, { username: 'terms_admin', role: 'admin' });
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock: the gate was client-only — every API route answered an
    // account that had never accepted the required terms.
    it('refuses API calls with 451 terms_required until the current version is accepted', async () => {
        const student = await asUser(server.baseUrl, 'terms_student'); // /auth/login is exempt

        const blocked = await student('/api/users/preferences');
        expect(blocked.status).toBe(451);
        expect(await blocked.json()).toMatchObject({ error: 'Terms acceptance required', code: 'terms_required' });

        // The way out stays open: verify, status, accept.
        expect((await student('/api/auth/verify')).status).toBe(200);
        const status = await student('/api/terms/status');
        expect(status.status).toBe(200);
        const { terms } = await status.json();
        expect(terms.pending).toBe(true);

        const accepted = await student('/api/terms/accept', { method: 'POST', json: { version: terms.version } });
        expect(accepted.status).toBe(200);

        expect((await student('/api/users/preferences')).status).toBe(200);
    });

    it('lets an admin reach the terms settings without accepting first', async () => {
        const admin = await asUser(server.baseUrl, 'terms_admin');
        expect((await admin('/api/platform-settings/terms')).status).toBe(200);
        expect((await admin('/api/users')).status).toBe(451);
    });

    it('leaves an unauthenticated request to its route (401, not 451)', async () => {
        const r = await fetch(`${server.baseUrl}/api/users/preferences`);
        expect(r.status).toBe(401);
    });

    it('exempts exactly the auth, terms, probe and pre-token language paths', () => {
        const exempt = (url) => termsGateExempt({ originalUrl: url });
        ['/api/auth/login', '/api/auth/verify', '/api/terms', '/api/terms/accept?x=1', '/api/health',
            '/api/health/plugins', '/api/ready', '/api/platform-settings/language',
            '/api/platform-settings/terms'].forEach((u) => expect(exempt(u)).toBe(true));
        ['/api/users', '/api/cases', '/api/sessions/1', '/api/platform-settings/llm',
            '/api/authx'].forEach((u) => expect(exempt(u)).toBe(false));
    });
});

describe('probe rate limit', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_GENERAL_RATE_LIMIT: '' } });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    // Regression lock: /ready (four DB probes) and /health/plugins (an outbound
    // fetch per plugin origin) were unauthenticated AND unlimited.
    it('429s /ready after 30 a minute, while /health stays unlimited', async () => {
        const statuses = [];
        // Sequential on purpose: the limiter counts per request.
        for (let i = 0; i < 31; i++) {
            statuses.push((await fetch(`${server.baseUrl}/api/ready`)).status);
        }
        expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
        expect(statuses[30]).toBe(429);
        const health = await Promise.all(
            Array.from({ length: 40 }, () => fetch(`${server.baseUrl}/api/health`).then((r) => r.status)),
        );
        expect(health.every((s) => s === 200)).toBe(true);
    }, 60_000);
});

describe('cookieSecure()', () => {
    afterAll(() => vi.unstubAllEnvs());

    // Regression lock: Secure was NODE_ENV === 'production' alone, so an
    // https instance with NODE_ENV unset sent the session cookie over http too.
    it('is true in production, or whenever FRONTEND_URL is https, and false otherwise', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('FRONTEND_URL', 'https://rohy.example.org/rohy');
        expect(cookieSecure()).toBe(true);
        expect(csrfCookieOptions().secure).toBe(true);

        vi.stubEnv('FRONTEND_URL', 'http://localhost:5173');
        expect(cookieSecure()).toBe(false);
        expect(csrfCookieOptions().secure).toBe(false);

        vi.stubEnv('FRONTEND_URL', '');
        expect(cookieSecure()).toBe(false);

        vi.stubEnv('NODE_ENV', 'production');
        expect(cookieSecure()).toBe(true);
    });
});
