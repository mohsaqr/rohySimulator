// Regression locks for F-13 (security audit 2026-10-26): the CSRF
// double-submit token was not tied to the session — any value worked as long as
// the rohy_csrf cookie equalled the header (or the body `_csrf`), so a cookie
// planted from a sibling sub-domain plus a form post carrying the same value
// passed. And the body `_csrf` fallback was honoured for urlencoded forms too.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { TEST_PASSWORD, closeDb, openDb, seedUser } from '../utils/authHttp.js';
import { csrfTokenForSession, verifyCsrf, verifyCsrfBinding } from '../../server/middleware/csrf.js';

const SECRET = 'sec2-a-csrf-secret-0123456789abcdef';
const HASH = 'a'.repeat(64);

describe('csrfTokenForSession / verifyCsrfBinding (unit)', () => {
    afterAll(() => vi.unstubAllEnvs());

    it('is deterministic per session, differs across sessions and secrets, 43 chars', () => {
        vi.stubEnv('JWT_SECRET', SECRET);
        const a = csrfTokenForSession(HASH);
        expect(a).toBe(csrfTokenForSession(HASH));
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(csrfTokenForSession('b'.repeat(64))).not.toBe(a);
        vi.stubEnv('JWT_SECRET', `${SECRET}-other`);
        expect(csrfTokenForSession(HASH)).not.toBe(a);
    });

    // Regression lock: a matching but attacker-chosen pair used to pass.
    it('refuses a matching pair that is not the session-bound value, and hands back the bound one', () => {
        vi.stubEnv('JWT_SECRET', SECRET);
        const chosen = 'K'.repeat(43);
        const req = { tokenHash: HASH, headers: { cookie: `rohy_csrf=${chosen}`, 'x-csrf-token': chosen } };
        expect(verifyCsrf(req)).toBeNull(); // the double-submit half alone still agrees
        const verdict = verifyCsrfBinding(req);
        expect(verdict).toMatchObject({ status: 403, body: { code: 'csrf_stale' } });
        expect(verdict.heal).toBe(csrfTokenForSession(HASH));

        const bound = csrfTokenForSession(HASH);
        expect(verifyCsrfBinding({ tokenHash: HASH, headers: { 'x-csrf-token': bound } })).toBeNull();
    });

    it('fails closed without a session hash', () => {
        vi.stubEnv('JWT_SECRET', SECRET);
        expect(verifyCsrfBinding({ headers: { 'x-csrf-token': 'x' } })?.status).toBe(403);
    });

    // Regression lock: `_csrf` in an urlencoded / multipart / text body counted.
    it.each(['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain;charset=UTF-8'])(
        'ignores a body _csrf sent as %s',
        (type) => {
            const t = 'T'.repeat(43);
            const req = { headers: { cookie: `rohy_csrf=${t}`, 'content-type': type }, body: { _csrf: t } };
            expect(verifyCsrf(req)).toEqual({ status: 403, body: { error: 'CSRF token missing' } });
        }
    );

    it('still accepts a body _csrf in a JSON body (the sendBeacon flush)', () => {
        const t = 'T'.repeat(43);
        const req = { headers: { cookie: `rohy_csrf=${t}`, 'content-type': 'application/json' }, body: { _csrf: t } };
        expect(verifyCsrf(req)).toBeNull();
    });
});

describe('CSRF binding over HTTP', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        const db = await openDb(server.dbPath);
        await seedUser(db, { username: 'csrf_user' });
        await closeDb(db);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    async function cookieLogin() {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'csrf_user', password: TEST_PASSWORD }),
        });
        expect(res.status).toBe(200);
        const jar = Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0].split('=')));
        return { auth: jar.rohy_auth, csrf: jar.rohy_csrf };
    }

    const putPrefs = (auth, csrfCookie, headers = {}, body = JSON.stringify({ theme: 'light' })) =>
        fetch(`${server.baseUrl}/api/users/preferences`, {
            method: 'PUT',
            headers: { cookie: `rohy_auth=${auth}; rohy_csrf=${csrfCookie}`, 'content-type': 'application/json', ...headers },
            body,
        });

    it('the token login sets is accepted', async () => {
        const { auth, csrf } = await cookieLogin();
        expect((await putPrefs(auth, csrf, { 'x-csrf-token': csrf })).status).toBe(200);
    });

    // Regression lock: an attacker-chosen cookie + header pair used to pass.
    it('refuses a planted pair with 403 csrf_stale, re-sets the bound cookie, and the retry passes', async () => {
        const { auth, csrf } = await cookieLogin();
        const planted = 'P'.repeat(43);
        const refused = await putPrefs(auth, planted, { 'x-csrf-token': planted });
        expect(refused.status).toBe(403);
        expect((await refused.json()).code).toBe('csrf_stale');
        const healed = refused.headers.getSetCookie().find((c) => c.startsWith('rohy_csrf='))?.split(';')[0].slice('rohy_csrf='.length);
        expect(healed).toBe(csrf);
        expect((await putPrefs(auth, healed, { 'x-csrf-token': healed })).status).toBe(200);
    });

    // Regression lock: a form-encoded `_csrf` used to satisfy the check.
    it('refuses a form post carrying the right token as _csrf', async () => {
        const { auth, csrf } = await cookieLogin();
        const res = await putPrefs(auth, csrf, { 'content-type': 'application/x-www-form-urlencoded' }, `theme=light&_csrf=${csrf}`);
        expect(res.status).toBe(403);
    });

    it('accepts the bound token as _csrf in a JSON body (beacon path)', async () => {
        const { auth, csrf } = await cookieLogin();
        expect((await putPrefs(auth, csrf, {}, JSON.stringify({ theme: 'dark', _csrf: csrf }))).status).toBe(200);
    });

    it('GET /auth/verify re-mints the bound token for a cookie session', async () => {
        const { auth, csrf } = await cookieLogin();
        const res = await fetch(`${server.baseUrl}/api/auth/verify`, { headers: { cookie: `rohy_auth=${auth}; rohy_csrf=stale` } });
        expect(res.status).toBe(200);
        const minted = res.headers.getSetCookie().find((c) => c.startsWith('rohy_csrf='))?.split(';')[0].slice('rohy_csrf='.length);
        expect(minted).toBe(csrf);
    });
});
