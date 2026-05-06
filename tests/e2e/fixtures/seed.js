// Seed helpers for e2e tests.
//
// Phase 5 MVP: we lean on the server's own first-boot seeder (see
// server/seeders/index.js — `runSeeders()` is invoked from server.js when
// `needsSeeding()` returns true). The Playwright webServer in
// playwright.config.js spawns the server with a fresh ROHY_DB temp file,
// so the seeder runs once at startup and the default cases + admin/student
// accounts are present from the very first spec.
//
// What this file is for:
//   - small helpers each spec can call to fetch a known seed row by name
//   - a soft "reset" hook that lets a spec wipe state it created, without
//     restarting the server (which would be ~2 s of overhead per spec).
//
// What this file is NOT:
//   - a per-test DB rebuild. The 11 follow-on specs share one server +
//     one DB. If two specs collide on a writable resource, fix it by
//     scoping created rows (e.g. unique case names) rather than wiping
//     the DB. When that ceases to scale, the right move is per-worker
//     DB isolation, not per-test resets.
//
// Auth note: most management endpoints require a Bearer token. Specs
// should call `apiAsAdmin(request, baseURL)` (below) to get an
// APIRequestContext that already has the admin token set on every
// outgoing request.

import { request as pwRequest } from '@playwright/test';
import { loginAs } from './auth.js';

/**
 * Build an APIRequestContext that auto-attaches an admin Bearer token to
 * every request. Useful for setup steps that need to seed/reset rows
 * without going through the UI.
 *
 * Caller MUST `await ctx.dispose()` when done.
 */
export async function apiAsAdmin(baseURL) {
    const { token } = await loginAs(baseURL, 'admin');
    return pwRequest.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
}

/**
 * List all cases visible to admin. Useful for "is the seeder data here?"
 * sanity checks at the start of a spec.
 */
export async function listCases(baseURL) {
    const ctx = await apiAsAdmin(baseURL);
    try {
        const res = await ctx.get('/api/cases');
        if (!res.ok()) {
            const body = await res.text();
            throw new Error(`GET /api/cases failed (${res.status()}): ${body}`);
        }
        const json = await res.json();
        return json.cases || [];
    } finally {
        await ctx.dispose();
    }
}

/**
 * Find the first case matching a predicate or name. Returns null if not
 * found — caller decides whether that's fatal.
 */
export async function findCase(baseURL, predicate) {
    const cases = await listCases(baseURL);
    if (typeof predicate === 'string') {
        return cases.find((c) => c.name === predicate) || null;
    }
    return cases.find(predicate) || null;
}

/**
 * Wait until the seeded admin user can log in. Useful as a smoke gate at
 * the top of a spec that expects the seeders to have completed.
 */
export async function waitForSeed(baseURL, { timeoutMs = 10_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
        try {
            await loginAs(baseURL, 'admin');
            return;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error(`Seed did not complete within ${timeoutMs}ms: ${lastErr?.message || lastErr}`);
}
