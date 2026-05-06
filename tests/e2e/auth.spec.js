// auth.spec.js — Phase 5 auth coverage.
//
// What this spec locks (per TESTING_PLAN.md):
//   1. Registration role contract:
//        - With users already seeded, POST /api/auth/register asking for
//          role=admin MUST return 403 ("Only admins can create elevated
//          accounts"). Requesting role=student (or omitting role) MUST
//          return 201 + role=student. (First-user-becomes-admin only
//          fires on a zero-user DB; the e2e DB always has the seeded
//          admin+student, so we test the negative half of the contract
//          here. The positive half — first user becomes admin — would
//          require dropping the users table mid-run, which collides with
//          every other Phase-5 spec sharing this DB.)
//   2. Admin login via UI: type credentials, land in the workspace, see
//      the admin-only "Admin" badge + "TNA Analytics" menu entry.
//   3. Student login via UI: same flow; no admin-only chrome.
//   4. Force-logout: the brief calls for `POST /api/auth/force-logout`,
//      but that route does not exist in server/routes.js yet. We lock
//      that as an unimplemented contract (assert 404) and separately
//      verify the user-facing OUTCOME the brief cares about: an invalid
//      token in localStorage on next navigation evicts the session and
//      surfaces the login screen.
//   5. Token expiry: mint a JWT with the e2e JWT_SECRET that has `exp`
//      in the past, plant it in localStorage, reload — AuthProvider's
//      verifyToken() must wipe it and render <LoginPage>.
//   6. Wrong password → 401 + visible error toast inline on LoginPage.
//      We use a throwaway username to avoid bumping the real seeded
//      accounts' failed_login_attempts counter (5-strike lockout).
//   7. Logout button clears localStorage and returns to <LoginPage>.
//   8. Bonus: the `Authorization` header is required for /auth/verify —
//      bare GET returns 401, ensuring the SPA's verifyToken() path
//      can't be smoke-passed by a permissive backend.

import jwt from 'jsonwebtoken';
import { test, expect, apiAsAdmin } from './fixtures/index.js';

// Must match playwright.config.js → webServer.env.JWT_SECRET. Hard-coding
// it here is intentional: if someone rotates the e2e secret without
// updating this spec, the expiry test fails loudly rather than silently
// asserting "any garbage token = logout".
const E2E_JWT_SECRET = 'rohy-e2e-secret';

// Unique tag per run so writes from this spec don't collide with parallel
// Phase-5 specs sharing the same DB.
const RUN_TAG = `e2e-auth-${Date.now()}`;

test.describe('auth', () => {

    test('registration with users present cannot self-elevate to admin (403)', async ({ baseURL, request }) => {
        // The e2e DB is pre-seeded with admin + student, so the
        // first-user-becomes-admin branch is NOT eligible. The server
        // rejects role=admin in that case with 403 (see /auth/register
        // handler: "Only admins can create elevated accounts").
        const username = `${RUN_TAG}-reg-elev`;
        const res = await request.post(`${baseURL}/api/auth/register`, {
            data: {
                username,
                email: `${username}@example.test`,
                password: 'P@ssw0rd!Long',
                role: 'admin',
            },
        });
        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.error).toMatch(/admin/i);

        // And the user row must NOT have been created.
        const ctx = await apiAsAdmin(baseURL);
        try {
            const list = await ctx.get('/api/users');
            const users = (await list.json()).users || [];
            expect(users.find((u) => u.username === username)).toBeUndefined();
        } finally {
            await ctx.dispose();
        }
    });

    test('registration without role defaults to student and returns a usable JWT', async ({ baseURL, request }) => {
        const username = `${RUN_TAG}-reg-default`;
        const res = await request.post(`${baseURL}/api/auth/register`, {
            data: {
                username,
                email: `${username}@example.test`,
                password: 'P@ssw0rd!Long',
            },
        });
        expect(res.status()).toBe(201);
        const body = await res.json();
        expect(body.user.role).toBe('student');

        // Token round-trips through /auth/verify.
        const verify = await request.get(`${baseURL}/api/auth/verify`, {
            headers: { Authorization: `Bearer ${body.token}` },
        });
        expect(verify.status()).toBe(200);
        const verified = await verify.json();
        expect(verified.user.username).toBe(username);
        expect(verified.user.role).toBe('student');
    });

    test('admin login via UI lands in workspace with admin-only chrome', async ({ page }) => {
        // Enlarge viewport so the case banner (left) and user menu
        // (right) on the 35%-width left column don't overlap and
        // intercept pointer events on each other at default 1280px.
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto('/');
        // LoginPage renders an h2 "Sign In".
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

        await page.getByPlaceholder('Enter your username').fill('admin');
        await page.getByPlaceholder('Enter your password').fill('admin123');
        await page.getByRole('button', { name: /sign in/i }).click();

        // Workspace markers: username appears in the header dropdown
        // button, and the "Admin" role badge is rendered next to it.
        await expect(page.getByText('admin', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Admin', { exact: true }).first()).toBeVisible();

        // Open the user menu and confirm "TNA Analytics" (admin-only).
        // Use force:true because the absolute-positioned case banner can
        // overlap the user-menu trigger at narrow widths.
        await page.getByRole('button', { name: /admin/i }).first().click({ force: true });
        await expect(page.getByText('TNA Analytics')).toBeVisible();

        // localStorage holds the JWT.
        const token = await page.evaluate(() => window.localStorage.getItem('token'));
        expect(token).toBeTruthy();
    });

    test('student login via UI lands in workspace WITHOUT admin chrome', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

        await page.getByPlaceholder('Enter your username').fill('student');
        await page.getByPlaceholder('Enter your password').fill('student123');
        await page.getByRole('button', { name: /sign in/i }).click();

        // Past the login gate.
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeHidden({ timeout: 15_000 });
        // The header dropdown shows "student" username.
        await expect(page.getByText('student', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        // The "Admin" role badge must NOT be present anywhere.
        await expect(page.getByText('Admin', { exact: true })).toHaveCount(0);

        // Open the user menu (the trigger contains the username, not "Admin").
        await page.getByRole('button', { name: /student/i }).first().click({ force: true });
        // Admin-only menu entry must be absent.
        await expect(page.getByText('TNA Analytics')).toHaveCount(0);
    });

    test('wrong password returns 401 and surfaces an inline error', async ({ page, baseURL, request }) => {
        // Use a non-existent username so we don't bump the real admin/student
        // failed_login_attempts counter (5 strikes = 15-minute lockout,
        // which would poison every downstream auth-touching spec).
        const ghostUser = `${RUN_TAG}-ghost`;

        // Contract: API returns 401.
        const apiRes = await request.post(`${baseURL}/api/auth/login`, {
            data: { username: ghostUser, password: 'definitely-not-it' },
        });
        expect(apiRes.status()).toBe(401);

        // UI: same credentials produce a visible error block.
        await page.goto('/');
        await page.getByPlaceholder('Enter your username').fill(ghostUser);
        await page.getByPlaceholder('Enter your password').fill('definitely-not-it');
        await page.getByRole('button', { name: /sign in/i }).click();

        // LoginPage error block uses the literal server message.
        await expect(page.getByText(/invalid username or password/i)).toBeVisible({ timeout: 10_000 });
        // Still on the login screen.
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    });

    test('expired token is wiped on reload and the SPA returns to the login screen', async ({ browser, baseURL }) => {
        // Forge a JWT signed with the same secret the e2e server uses,
        // but with `exp` an hour in the past. AuthProvider.verifyToken()
        // → /api/auth/verify → jwt.verify() must reject it, which
        // authService catches and removes from localStorage.
        const expiredToken = jwt.sign(
            {
                id: 1,
                username: 'admin',
                email: 'admin@example.com',
                role: 'admin',
                tenant_id: 1,
                iat: Math.floor(Date.now() / 1000) - 7200,
                exp: Math.floor(Date.now() / 1000) - 3600,
            },
            E2E_JWT_SECRET,
        );

        const ctx = await browser.newContext({ baseURL });
        try {
            await ctx.addInitScript((t) => {
                try { window.localStorage.setItem('token', t); } catch { /* ignore */ }
            }, expiredToken);
            const page = await ctx.newPage();
            await page.goto('/');

            // Should land on login because verifyToken stripped the token.
            await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
            const tokenAfter = await page.evaluate(() => window.localStorage.getItem('token'));
            expect(tokenAfter).toBeNull();
        } finally {
            await ctx.close();
        }
    });

    test('logout button clears localStorage and returns to the login screen', async ({ adminPage }) => {
        await adminPage.setViewportSize({ width: 1600, height: 900 });
        await adminPage.goto('/');
        // Past the gate.
        await expect(adminPage.getByText('admin', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
        // Token is present.
        const before = await adminPage.evaluate(() => window.localStorage.getItem('token'));
        expect(before).toBeTruthy();

        // Open user dropdown via the user-menu trigger then click Logout.
        // force:true because the case banner overlay sits in the same
        // absolutely-positioned region.
        await adminPage.getByRole('button', { name: /admin/i }).first().click({ force: true });
        await adminPage.getByRole('button', { name: /^logout$/i }).click();

        // Login screen returns.
        await expect(adminPage.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
        const after = await adminPage.evaluate(() => window.localStorage.getItem('token'));
        expect(after).toBeNull();
    });

    test('force-logout endpoint contract: not implemented, but tampered token still ejects on navigate', async ({ browser, baseURL }) => {
        // Lock the contract: /api/auth/force-logout has no route handler,
        // so the API replies 404. This test will start failing the day
        // someone wires it up — at which point this spec gets updated to
        // exercise the real endpoint.
        const ctx = await apiAsAdmin(baseURL);
        let forceRes;
        try {
            forceRes = await ctx.post('/api/auth/force-logout', {
                data: { username: 'admin' },
            });
        } finally {
            await ctx.dispose();
        }
        expect(forceRes.status()).toBe(404);

        // The user-facing outcome of "force-logout" is: the next page
        // navigation in the affected tab redirects to the login screen
        // because the token no longer verifies. Simulate that condition
        // (token revoked / corrupted) and confirm the SPA recovers.
        const corrupted = await browser.newContext({ baseURL });
        try {
            await corrupted.addInitScript(() => {
                try { window.localStorage.setItem('token', 'tampered.invalid.jwt'); } catch { /* ignore */ }
            });
            const page = await corrupted.newPage();
            await page.goto('/');
            await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
            const cleared = await page.evaluate(() => window.localStorage.getItem('token'));
            expect(cleared).toBeNull();
        } finally {
            await corrupted.close();
        }
    });

    test('/auth/verify rejects unauthenticated requests with 401', async ({ baseURL, request }) => {
        // Belt-and-braces: AuthProvider.verifyToken() depends on this
        // returning non-200 for a missing token. If the route ever drops
        // the authenticateToken middleware, the SPA would happily
        // hydrate `null` user with no token → broken auth.
        const res = await request.get(`${baseURL}/api/auth/verify`);
        expect(res.status()).toBe(401);
    });
});
