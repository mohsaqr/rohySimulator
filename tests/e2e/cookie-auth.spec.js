// cookie-auth.spec.js — end-to-end Playwright coverage of the cookie-mode
// auth lane introduced this session (HttpOnly rohy_auth + double-submit
// rohy_csrf + /auth/refresh rotation).
//
// What we lock here:
//   1. POST /api/auth/login sets BOTH cookies (rohy_auth HttpOnly,
//      rohy_csrf NOT HttpOnly) on the response.
//   2. A subsequent authenticated request that omits the
//      Authorization header but rides credentials:'include' authenticates
//      via the cookie path.
//   3. A state-changing request without X-CSRF-Token returns 403
//      "CSRF token missing"; with it, the request succeeds.
//   4. POST /api/auth/refresh rotates the rohy_auth cookie value.
//   5. POST /api/auth/logout clears both cookies (Set-Cookie with empty
//      value + past Max-Age).

import { test, expect } from '@playwright/test';

const RUN_TAG = `e2e-cookie-${Date.now()}`;

test.describe('cookie-mode auth lane (post-flag-day)', () => {

    test('login sets rohy_auth (HttpOnly) + rohy_csrf (script-readable) cookies', async ({ baseURL, request }) => {
        const res = await request.post(`${baseURL}/api/auth/login`, {
            data: { username: 'admin', password: 'admin123' },
            // Don't store cookies in the request context's jar — we want
            // to inspect Set-Cookie directly.
        });
        expect(res.status()).toBe(200);

        const setCookies = res.headersArray()
            .filter(h => h.name.toLowerCase() === 'set-cookie')
            .map(h => h.value);
        expect(setCookies.length).toBeGreaterThanOrEqual(2);

        const auth = setCookies.find(c => c.startsWith('rohy_auth='));
        const csrf = setCookies.find(c => c.startsWith('rohy_csrf='));
        expect(auth).toBeTruthy();
        expect(csrf).toBeTruthy();

        // rohy_auth must be HttpOnly; rohy_csrf must NOT be (audit lock —
        // the double-submit scheme depends on JS reading it).
        expect(auth.toLowerCase()).toContain('httponly');
        expect(csrf.toLowerCase()).not.toContain('httponly');

        // SameSite=Lax for both.
        expect(auth.toLowerCase()).toContain('samesite=lax');
        expect(csrf.toLowerCase()).toContain('samesite=lax');
    });

    test('cookie-only authenticated request: GET /api/auth/verify works without Authorization header', async ({ baseURL, request }) => {
        // request fixture has its own cookie jar — login populates it,
        // then a follow-up GET sends the cookie automatically.
        const login = await request.post(`${baseURL}/api/auth/login`, {
            data: { username: 'admin', password: 'admin123' },
        });
        expect(login.status()).toBe(200);

        // Now fetch /auth/verify WITHOUT setting Authorization explicitly.
        // The cookie from the previous response is still in the jar.
        const verify = await request.get(`${baseURL}/api/auth/verify`);
        expect(verify.status()).toBe(200);
        const body = await verify.json();
        expect(body.valid).toBe(true);
        expect(body.user.username).toBe('admin');
    });

    test('cookie-auth POST without X-CSRF-Token → 403 "CSRF token missing"', async ({ baseURL, request }) => {
        await request.post(`${baseURL}/api/auth/login`, {
            data: { username: 'admin', password: 'admin123' },
        });

        // Fire a state-changing request via the cookie jar but DON'T
        // include the X-CSRF-Token header. authenticateToken's CSRF gate
        // should reject.
        const refresh = await request.post(`${baseURL}/api/auth/refresh`, {});
        expect(refresh.status()).toBe(403);
        const body = await refresh.json();
        expect(body.error).toMatch(/CSRF/i);
    });

    test('cookie-auth POST with matching X-CSRF-Token succeeds and rotates rohy_auth', async ({ baseURL, request, context }) => {
        await request.post(`${baseURL}/api/auth/login`, {
            data: { username: 'admin', password: 'admin123' },
        });

        // Read the rohy_csrf cookie from the request context's jar (which
        // mirrors the browser's cookie jar in headless Playwright).
        const cookies = await context.cookies();
        const csrf = cookies.find(c => c.name === 'rohy_csrf');
        expect(csrf).toBeTruthy();
        const csrfBefore = csrf.value;

        const authBefore = cookies.find(c => c.name === 'rohy_auth')?.value;
        expect(authBefore).toBeTruthy();

        // Refresh with the matching CSRF header.
        const refresh = await request.post(`${baseURL}/api/auth/refresh`, {
            headers: { 'X-CSRF-Token': csrfBefore },
        });
        expect(refresh.status()).toBe(200);
        const body = await refresh.json();
        expect(body.user.username).toBe('admin');
        expect(typeof body.token).toBe('string');

        // The rohy_auth cookie must have rotated.
        const cookiesAfter = await context.cookies();
        const authAfter = cookiesAfter.find(c => c.name === 'rohy_auth')?.value;
        expect(authAfter).toBeTruthy();
        expect(authAfter).not.toBe(authBefore);
    });

    test('logout clears both cookies', async ({ baseURL, request, context }) => {
        await request.post(`${baseURL}/api/auth/login`, {
            data: { username: 'admin', password: 'admin123' },
        });
        const csrf = (await context.cookies()).find(c => c.name === 'rohy_csrf')?.value;
        const logout = await request.post(`${baseURL}/api/auth/logout`, {
            headers: { 'X-CSRF-Token': csrf },
        });
        expect(logout.status()).toBe(200);

        // Both cookies should be gone (or set to empty / past expiry).
        const after = await context.cookies();
        const auth = after.find(c => c.name === 'rohy_auth');
        const csrfAfter = after.find(c => c.name === 'rohy_csrf');
        // Either absent or expired/empty.
        if (auth) expect(auth.value).toBe('');
        if (csrfAfter) expect(csrfAfter.value).toBe('');
    });
});
