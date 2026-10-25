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
 * Offer a case a spec created to every student the way an educator would:
 * make it available, and put it in the tenant's default course — where
 * students who are in no other course get their cases. Course access is on,
 * so a case outside every course (or unpublished) is refused to students.
 */
export async function offerCaseToStudents(baseURL, caseId) {
    const ctx = await apiAsAdmin(baseURL);
    try {
        const available = await ctx.put(`/api/cases/${caseId}/availability`, { data: { is_available: true } });
        if (!available.ok()) throw new Error(`PUT availability failed (${available.status()}): ${await available.text()}`);
        const listed = await ctx.get('/api/cohorts');
        if (!listed.ok()) throw new Error(`GET /api/cohorts failed (${listed.status()}): ${await listed.text()}`);
        const body = await listed.json();
        const course = (body.cohorts || body.data || []).find((c) => c.is_default);
        if (!course) throw new Error('no default course to put the case in');
        const put = await ctx.put(`/api/cases/${caseId}/course`, { data: { cohortId: course.id } });
        if (!put.ok()) throw new Error(`PUT /api/cases/${caseId}/course failed (${put.status()}): ${await put.text()}`);
    } finally {
        await ctx.dispose();
    }
}

/**
 * Make Oyon capture possible for the named learners, the way a deployment
 * would after rc.85 / the per-course rule (server/lib/oyonSensingGate.js):
 *
 *  1. an admin turns tenant capture on — a fresh install starts with it OFF.
 *     PUT /addons/oyon/settings REPLACES its booleans (an absent field becomes
 *     0), so this is GET → spread → PUT, with any extra `flags` on top;
 *  2. the DEFAULT course gets `settings.oyon_sensing_enabled: true` (merged —
 *     PATCH replaces settings wholesale), and each learner is enrolled in it
 *     explicitly. A learner is sensed only while an active member of a course
 *     that enables it. The default course is used rather than a new one
 *     because joining any other course would cost the learner the default
 *     course's cases (studentCaseVisibility / ensureAutoEnrollMemberships).
 *
 * Returns the tenant Oyon settings as they were, for restoreOyonSettings().
 * The default course keeps sensing on: without tenant capture it does nothing.
 *
 * @param {string} baseURL
 * @param {string[]} usernames  learners to enrol (e.g. ['student'])
 * @param {object} [flags]      extra Oyon setting overrides (e.g. { voice_enabled: true })
 */
export async function enableOyonForLearners(baseURL, usernames, flags = {}) {
    const ctx = await apiAsAdmin(baseURL);
    try {
        const got = await ctx.get('/api/addons/oyon/settings');
        if (!got.ok()) throw new Error(`GET /api/addons/oyon/settings failed (${got.status()}): ${await got.text()}`);
        const original = (await got.json()).settings;
        const put = await ctx.put('/api/addons/oyon/settings', {
            data: { ...original, emotion_capture_enabled: true, ...flags },
        });
        if (!put.ok()) throw new Error(`PUT /api/addons/oyon/settings failed (${put.status()}): ${await put.text()}`);

        await enrollInOyonCourse(baseURL, usernames);
        return original;
    } finally {
        await ctx.dispose();
    }
}

/**
 * Turn on `oyon_sensing_enabled` in the DEFAULT course (merged into its
 * settings) and enrol each learner in it explicitly. See enableOyonForLearners.
 */
export async function enrollInOyonCourse(baseURL, usernames) {
    const ctx = await apiAsAdmin(baseURL);
    try {
        const listed = await ctx.get('/api/cohorts');
        if (!listed.ok()) throw new Error(`GET /api/cohorts failed (${listed.status()}): ${await listed.text()}`);
        const course = ((await listed.json()).cohorts || []).find((c) => c.is_default);
        if (!course) throw new Error('no default course to enable Oyon in');
        let settings = {};
        try { settings = course.settings ? JSON.parse(course.settings) : {}; } catch { settings = {}; }
        if (settings.oyon_sensing_enabled !== true) {
            const res = await ctx.patch(`/api/cohorts/${course.id}`, {
                data: { name: course.name, settings: { ...settings, oyon_sensing_enabled: true } },
            });
            if (!res.ok()) throw new Error(`PATCH /api/cohorts/${course.id} failed (${res.status()}): ${await res.text()}`);
        }
        for (const identifier of usernames) {
            // Idempotent: an existing live membership is reported, not duplicated.
            const res = await ctx.post(`/api/cohorts/${course.id}/members`, { data: { identifier } });
            if (!res.ok()) throw new Error(`enrolling ${identifier} failed (${res.status()}): ${await res.text()}`);
        }
    } finally {
        await ctx.dispose();
    }
}

/** Put the tenant Oyon settings back as enableOyonForLearners() found them. */
export async function restoreOyonSettings(baseURL, original) {
    if (!original) return;
    const ctx = await apiAsAdmin(baseURL);
    try {
        const res = await ctx.put('/api/addons/oyon/settings', { data: original });
        if (!res.ok()) throw new Error(`PUT /api/addons/oyon/settings failed (${res.status()}): ${await res.text()}`);
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
