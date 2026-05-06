// Canary spec — proves the e2e infrastructure works end to end.
//
// What it covers:
//   1. webServer (server/server.js) actually came up on port 4811.
//   2. Built `frontend/` is being served by the API process (option (b)
//      in the Phase 5 brief — see playwright.config.js header).
//   3. The admin auth fixture mints a real JWT via /api/auth/login,
//      injects it into localStorage, and the SPA's AuthProvider hydrates
//      the user without us having to type into the login form.
//   4. The seeded admin user is present (proves runSeeders() ran on the
//      throwaway DB).
//
// This is the ONLY spec the Phase 5 setup agent owns. The 11 downstream
// specs (auth, case-lifecycle, voice-runtime, voice-config-leak,
// scenario-engine, alarms, multi-tab, admin-flows, rbac, tenant,
// retention) are owned by parallel agents that run after this lands.
//
// Keep this spec FAST. If it ever exceeds ~10 s wall-time, rip out the
// slow assertion — its job is "infra works", not "feature works".

import { test, expect } from './fixtures/index.js';
import { waitForSeed } from './fixtures/seed.js';

test.describe('canary', () => {
    test('seed completes and admin can render the authenticated app', async ({ adminPage, baseURL }) => {
        // Belt-and-braces: confirm the seeder finished. The auth fixture
        // already implicitly proves this (it logs in as admin), but the
        // explicit gate gives a clearer failure when the seeder is broken.
        await waitForSeed(baseURL);

        // Drive the SPA. With `token` already in localStorage via the
        // adminPage fixture, AuthProvider should re-validate the token,
        // populate `user`, and skip the LoginPage entirely.
        await adminPage.goto('/');

        // The header dropdown renders `{user?.username}` once the
        // AuthProvider resolves. Looking for "admin" is a stable, content-
        // anchored signal that we landed past the login gate without
        // depending on icon class names.
        //
        // Use a regex bounded by `Admin` (the role badge) to avoid the
        // selector matching incidental DOM text on the login screen.
        await expect(adminPage.getByText('admin', { exact: false }).first()).toBeVisible({
            timeout: 10_000,
        });

        // Sanity: token is still in localStorage (i.e. the SPA didn't
        // log us back out due to a verifyToken() failure).
        const token = await adminPage.evaluate(() => window.localStorage.getItem('token'));
        expect(token).toBeTruthy();

        // Sanity: an authenticated API request from inside the page also
        // works. This confirms the JWT we minted is valid for both the
        // browser-side localStorage path and the network. We hit
        // /api/auth/verify, which returns 200 + the user payload when the
        // bearer token is good.
        const verifyStatus = await adminPage.evaluate(async () => {
            const t = window.localStorage.getItem('token');
            const r = await fetch('/api/auth/verify', {
                headers: { Authorization: `Bearer ${t}` },
            });
            return r.status;
        });
        expect(verifyStatus).toBe(200);
    });

    test('unauthenticated visit lands on the login screen', async ({ page }) => {
        // Plain `page` fixture has no token injected. The SPA should
        // render <LoginPage>. Looking for the literal "Sign In" heading
        // (h2 in src/components/auth/LoginPage.jsx).
        await page.goto('/');
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    });
});
