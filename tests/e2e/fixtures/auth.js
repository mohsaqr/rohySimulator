// Auth fixtures for Playwright e2e tests.
//
// Strategy: hit `POST /api/auth/login` over the API to mint a JWT, then
// inject it into the browser context via `addInitScript` so `localStorage`
// has `token` set BEFORE the SPA mounts. On mount, `AuthProvider` calls
// `verifyToken()` (see src/contexts/AuthContext.jsx + src/services/authService.js)
// which re-validates against the server, populates the React `user` state,
// and renders the authenticated app. No clicking through the login form
// per spec — that's slow and the login flow has its own dedicated spec.
//
// The seeders (server/seeders/users.js) ship two accounts:
//   - admin / admin123      (role: admin)
//   - student / student123  (role: student)
//
// We expose two named Playwright fixtures: `adminPage` and `studentPage`.
// Both extend the standard `page` fixture and yield a logged-in page.

import { test as base, request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_FILE = path.join(__dirname, '..', '.auth', 'tokens.json');

const DEFAULT_CREDS = {
    admin:   { username: 'admin',   password: 'admin123' },
    student: { username: 'student', password: 'student123' },
};

// Cached tokens from globalSetup (tests/e2e/global-setup.js). Avoids the
// server's 10/15min auth rate limit when running the combined suite.
function readCachedTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch { /* fall through */ }
    return null;
}

/**
 * Mint a JWT for the given role via the real /api/auth/login endpoint.
 * Returns { token, user }.
 *
 * We use a fresh APIRequestContext (not the test's `request` fixture)
 * because we want to call this from the worker-scoped fixture setup
 * before any page exists.
 */
export async function loginAs(baseURL, role) {
    const creds = DEFAULT_CREDS[role];
    if (!creds) {
        throw new Error(`Unknown role "${role}" — expected one of: ${Object.keys(DEFAULT_CREDS).join(', ')}`);
    }
    // Prefer the token from globalSetup if it exists — bypasses the auth
    // rate limit during combined-suite runs.
    const cached = readCachedTokens();
    if (cached?.[role]?.token) {
        return cached[role];
    }
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const res = await ctx.post('/api/auth/login', { data: creds });
        if (!res.ok()) {
            const body = await res.text();
            throw new Error(`Login as ${role} failed (${res.status()}): ${body}`);
        }
        const json = await res.json();
        if (!json.token) {
            throw new Error(`Login as ${role} returned no token: ${JSON.stringify(json)}`);
        }
        return { token: json.token, user: json.user };
    } finally {
        await ctx.dispose();
    }
}

/**
 * Build a Playwright page that already has `token` in localStorage.
 *
 * Important: we install the token via `addInitScript` so it's present
 * BEFORE any application JS runs on every navigation in this context.
 * Setting it after `page.goto()` would cause a flicker (the SPA mounts
 * unauthenticated, redirects to /login, then we'd race to inject).
 */
async function authenticatedPage({ browser, baseURL }, role) {
    const { token, user } = await loginAs(baseURL, role);
    const context = await browser.newContext({ baseURL });
    await context.addInitScript((t) => {
        try { window.localStorage.setItem('token', t); } catch { /* ignore */ }
    }, token);
    const page = await context.newPage();
    // Attach metadata for downstream specs that want to assert on user
    // identity without re-fetching it.
    page.__authUser = user;
    page.__authToken = token;
    return { page, context };
}

export const test = base.extend({
    // Test-scoped: a fresh context+page logged in as admin for each test.
    adminPage: async ({ browser, baseURL }, use) => {
        const { page, context } = await authenticatedPage({ browser, baseURL }, 'admin');
        await use(page);
        await context.close();
    },

    // Test-scoped: a fresh context+page logged in as student for each test.
    studentPage: async ({ browser, baseURL }, use) => {
        const { page, context } = await authenticatedPage({ browser, baseURL }, 'student');
        await use(page);
        await context.close();
    },
});

export { expect } from '@playwright/test';
