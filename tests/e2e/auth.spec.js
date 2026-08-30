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
//      the admin-only analytics menu entry (see STALENESS FIX below).
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
import { request as pwRequest } from '@playwright/test';
import { test, expect, apiAsAdmin } from './fixtures/index.js';

// Must match playwright.config.js → webServer.env.JWT_SECRET. Hard-coding
// it here is intentional: if someone rotates the e2e secret without
// updating this spec, the expiry test fails loudly rather than silently
// asserting "any garbage token = logout".
const E2E_JWT_SECRET = 'rohy-e2e-secret';

// Unique tag per run so writes from this spec don't collide with parallel
// Phase-5 specs sharing the same DB.
const RUN_TAG = `e2e-auth-${Date.now()}`;

// STALENESS FIX 2026-08-30 — the shell these tests were written against is gone.
//
// Two independent redesigns invalidated every UI locator below, and both were
// masked until now: the previous e2e run drove a blank page (`npm run build`
// pins --base=/rohy/ while the e2e server serves at /), so these assertions
// had not actually been evaluated against a rendered app in a long time.
//
//   1. LoginPage was redesigned. Its <h2> is now t('welcome_back') ("Welcome
//      back") with "Sign in to continue to Rohy." underneath — there is no
//      heading whose accessible name is "Sign In" (only the submit BUTTON
//      carries that text). canary.spec.js was already updated for this; auth
//      .spec.js was not.
//   2. The header chrome was merged into ONE TopBarControls gear menu
//      (src/components/common/TopBarControls.jsx). The username label and the
//      "Admin" role badge are no longer rendered anywhere, and the admin-only
//      analytics entry is now "Case Analytics", not "TNA Analytics".
//
// Markers below track the CURRENT shell, and deliberately keep the same
// contract: signed-out ⇒ login card visible; signed-in ⇒ app shell visible;
// admin sees an admin-only menu item, student does not.
const LOGIN_HEADING = /welcome back/i;
// aria-label from app.json → 'settings_menu_aria'. Rendered by MainApp for
// every authenticated role, so it is the role-agnostic "we're in" marker.
const APP_MENU_TRIGGER = /settings and profile menu/i;
// app.json → 'case_analytics'; rendered only when isAdminUser.
const ADMIN_ONLY_MENU_ITEM = /^Case Analytics$/;

/**
 * Dismiss OnboardingTour.
 *
 * It is a `fixed inset-0` role=dialog that renders once per role per
 * TOUR_VERSION from localStorage — so every fresh Playwright context gets it,
 * and it swallows clicks aimed at the top bar underneath. Same helper shape as
 * tablet-layout.spec.js's enterRoom().
 */
async function dismissOnboardingTour(page) {
    const skip = page.getByRole('button', { name: /^Skip$/ });
    if (await skip.count()) {
        await skip.first().click();
        await expect(skip.first()).toBeHidden();
    }
}

/** Open the merged top-bar menu and return its panel locator. */
async function openAppMenu(page) {
    await dismissOnboardingTour(page);
    await page.getByRole('button', { name: APP_MENU_TRIGGER }).first().click();
    return page.getByRole('menu');
}

test.describe('auth', () => {

    // Regression lock (was #29 in the 2026-08-30 UI review): these tests
    // asserted 201 registration on a fresh install, but a fresh install seeds
    // registration_mode = 'closed' by design (server/seeders/
    // registrationPolicy.js) — so the 201 was a deterministic 403, and the
    // self-elevation test "passed" only because the closed-registration
    // message happens to contain the word "administrator". The tests are now
    // policy-aware: closed-by-default is asserted first, and the actual
    // registration contract is exercised inside an explicitly opened window.

    test('registration is closed by default on a fresh install', async ({ baseURL, request }) => {
        const res = await request.post(`${baseURL}/api/auth/register`, {
            data: {
                username: `${RUN_TAG}-closed`,
                email: `${RUN_TAG}-closed@example.test`,
                password: 'P@ssw0rd!Long',
            },
        });
        expect(res.status()).toBe(403);
    });

    /** Set the platform registration mode as admin; returns a restore fn. */
    async function setRegistrationMode(baseURL, mode) {
        const ctx = await apiAsAdmin(baseURL);
        try {
            const res = await ctx.put('/api/platform-settings/registration', {
                data: { mode },
            });
            expect(res.status(), `PUT registration mode=${mode}`).toBe(200);
        } finally {
            await ctx.dispose();
        }
    }

    test('open registration cannot self-elevate to admin (403)', async ({ baseURL, request }) => {
        await setRegistrationMode(baseURL, 'open');
        try {
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
        } finally {
            await setRegistrationMode(baseURL, 'closed');
        }
    });

    test('open registration without role defaults to student and returns a usable JWT', async ({ baseURL, request }) => {
        await setRegistrationMode(baseURL, 'open');
        try {
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
        } finally {
            await setRegistrationMode(baseURL, 'closed');
        }
    });

    test('admin login via UI lands in workspace with admin-only chrome', async ({ page }) => {
        // Enlarge viewport so the case banner (left) and user menu
        // (right) on the 35%-width left column don't overlap and
        // intercept pointer events on each other at default 1280px.
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto('/');
        // LoginPage renders an h2 t('welcome_back'). See STALENESS FIX note.
        await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible();

        await page.getByPlaceholder('Enter your username').fill('admin');
        await page.getByPlaceholder('Enter your password').fill('admin123');
        await page.getByRole('button', { name: /sign in/i }).click();

        // Workspace marker: the merged top-bar menu trigger only mounts
        // inside MainApp, i.e. past the auth gate.
        await expect(page.getByRole('button', { name: APP_MENU_TRIGGER }).first())
            .toBeVisible({ timeout: 15_000 });

        // Admin-only chrome: "Case Analytics" is gated behind isAdminUser.
        const menu = await openAppMenu(page);
        await expect(menu.getByRole('menuitem', { name: ADMIN_ONLY_MENU_ITEM })).toBeVisible();

        // STALENESS FIX 2026-08-30: this used to assert
        // `localStorage.getItem('token')` is truthy. That predates the
        // cookie flag-day (src/services/authService.js header): login() only
        // writes the JWT to localStorage when called with
        // `{ rememberToken: true }`, and the SPA never does. Auth now rides
        // the HttpOnly rohy_auth cookie plus the rohy_csrf double-submit half,
        // so the current contract is "cookies set, localStorage clean".
        const cookies = await page.context().cookies();
        const authCookie = cookies.find((c) => c.name === 'rohy_auth');
        expect(authCookie, 'login must set the HttpOnly rohy_auth cookie').toBeTruthy();
        expect(authCookie.httpOnly).toBe(true);
        expect(cookies.find((c) => c.name === 'rohy_csrf')?.value).toBeTruthy();
        const token = await page.evaluate(() => window.localStorage.getItem('token'));
        expect(token, 'cookie-mode login must NOT leave a bearer token in localStorage').toBeNull();
    });

    test('student login via UI lands in workspace WITHOUT admin chrome', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible();

        await page.getByPlaceholder('Enter your username').fill('student');
        await page.getByPlaceholder('Enter your password').fill('student123');
        await page.getByRole('button', { name: /sign in/i }).click();

        // Past the login gate.
        await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeHidden({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: APP_MENU_TRIGGER }).first())
            .toBeVisible({ timeout: 15_000 });

        // Admin-only menu entry must be absent for a student.
        const menu = await openAppMenu(page);
        await expect(menu.getByRole('menuitem', { name: ADMIN_ONLY_MENU_ITEM })).toHaveCount(0);
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

        // LoginPage no longer renders the raw server string: translateLoginError()
        // maps "Invalid username or password" onto the catalogue key
        // `error_invalid_credentials` = "Incorrect username or password." so the
        // message is shown in the user's own language. Assert the rendered copy,
        // and assert it inside the role=alert block the component actually uses.
        await expect(page.getByRole('alert').filter({ hasText: /incorrect username or password/i }))
            .toBeVisible({ timeout: 10_000 });
        // Still on the login screen.
        await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible();
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
            await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible({ timeout: 10_000 });
            const tokenAfter = await page.evaluate(() => window.localStorage.getItem('token'));
            expect(tokenAfter).toBeNull();
        } finally {
            await ctx.close();
        }
    });

    // CONTAMINATION FIX 2026-08-30 — this test must NOT use the `adminPage`
    // fixture.
    //
    // POST /api/auth/logout revokes the presented JWT server-side by hash
    // (auth-routes.js:733 → revokeActiveSessionByHash), and every spec in the
    // run shares ONE admin token minted by global-setup.js into
    // tests/e2e/.auth/tokens.json. Clicking Logout on that shared token
    // therefore kills the admin session for every spec that runs afterwards —
    // they hydrate, get a 401 from /auth/verify, authService wipes
    // localStorage, and they land on the login page with a failure that looks
    // nothing like its cause. (This is exactly what took canary.spec.js down
    // when the test was first repaired.) So: mint a DEDICATED session here,
    // the same way cookie-auth.spec.js's logout test does, and revoke only it.
    test('logout button clears localStorage and returns to the login screen', async ({ browser, baseURL }) => {
        const throwaway = await pwRequest.newContext({ baseURL });
        let ownToken;
        try {
            const res = await throwaway.post('/api/auth/login', {
                data: { username: 'admin', password: 'admin123' },
            });
            expect(res.status(), 'dedicated admin login for the logout test').toBe(200);
            ownToken = (await res.json()).token;
            expect(ownToken).toBeTruthy();
        } finally {
            await throwaway.dispose();
        }

        const context = await browser.newContext({
            baseURL,
            viewport: { width: 1600, height: 900 },
        });
        try {
            await context.addInitScript((t) => {
                try { window.localStorage.setItem('token', t); } catch { /* ignore */ }
            }, ownToken);
            const page = await context.newPage();
            await page.goto('/');
            // Past the gate.
            await expect(page.getByRole('button', { name: APP_MENU_TRIGGER }).first())
                .toBeVisible({ timeout: 15_000 });
            // Token is present.
            const before = await page.evaluate(() => window.localStorage.getItem('token'));
            expect(before).toBeTruthy();

            // ISSUE-0018: Logout is now a direct top-bar button beside the gear
            // trigger (it used to be only the last dropdown item and pilot
            // testers could not find it), so no menu opening is needed. The
            // tour modal still has to go first — `fixed inset-0` eats clicks.
            await dismissOnboardingTour(page);
            await page.getByRole('button', { name: /^Logout$/ }).first().click();

            // Login screen returns.
            await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible({ timeout: 10_000 });
            const after = await page.evaluate(() => window.localStorage.getItem('token'));
            expect(after).toBeNull();
        } finally {
            await context.close();
        }
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
            await expect(page.getByRole('heading', { name: LOGIN_HEADING })).toBeVisible({ timeout: 10_000 });
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
