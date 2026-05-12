// RBAC role-hierarchy spec — Phase 5.
//
// Locks the contract documented in TESTING_PLAN.md Phase 5 + the E3 stage:
//   "Student denied admin endpoints. Reviewer read-only. Educator non-admin
//    authoring. Self-escalation rejected."
//
// Source-of-truth for the rank table is server/middleware/auth.js:
//   ROLE_RANKS = { guest:0, student:1, user:1, reviewer:2, educator:3, admin:4 }
//   normalizeRole('user') === 'student'   (legacy alias)
//   VALID_ROLES = ['guest','student','reviewer','educator','admin']
//
// We seed two extra users (reviewer + educator) via the admin API at the
// top of the run, log them in to mint real JWTs, then use Playwright's
// `request` API (not the SPA) to hit the same routes the audit scripts hit.
// All seeded users are deleted in afterAll so this spec leaves the shared
// e2e DB clean for the other Phase-5 specs.
//
// Why API-only?
//   RBAC is a wire-level contract. Driving the SPA would test "does the UI
//   hide the button" — useful, but a different test. Here we lock the
//   server-side guard, which is the actual security boundary.
//
// Why unique usernames per run?
//   The shared e2e DB persists across specs in a single run. Suffixing with
//   Date.now() avoids collisions with sibling specs that may also seed
//   reviewer/educator accounts in parallel test files.

import { test, expect, apiAsAdmin } from './fixtures/index.js';
import { loginAs } from './fixtures/auth.js';
import { request as pwRequest } from '@playwright/test';

// Run this file's tests serially. The shared e2e webServer + single sqlite
// DB means concurrent writes to `users` from multiple workers can collide
// on UNIQUE(username). Playwright config already pins workers=1 globally,
// but `describe.serial` is explicit insurance and keeps create→use→delete
// ordering deterministic.
test.describe.configure({ mode: 'serial' });

// Single salt so reviewer/educator/legacy usernames inside this file don't
// collide with each other or with sibling specs creating *their* reviewer.
const STAMP = `rbac-${Date.now()}`;

// Password that satisfies validatePassword() in server/routes.js:167:
// >=8 chars, lower+upper+digit. Reused so we keep the spec readable.
const TEST_PASSWORD = 'RbacTest123';

// Track every user id we created so afterAll can soft-clean. We push to
// this list immediately after each successful POST /users/create so a
// mid-spec failure still cleans up.
const createdUserIds = [];

// Cached request contexts (one per role) so we don't pay a login round
// trip per test. Each context auto-attaches the role's bearer token.
let adminCtx;
let studentCtx;
let reviewerCtx;
let educatorCtx;
let legacyUserCtx;
// Identity of the seeded users (id, username) — needed for cross-user
// path tests like /users/preferences and /users/:id.
let reviewerUser;
let educatorUser;
let legacyUser;
let studentUserId;

/**
 * Helper: build an APIRequestContext with a given bearer token.
 */
async function authedCtx(baseURL, token) {
    return pwRequest.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
}

/**
 * Helper: create a user via admin API and return the user record. Adds
 * the new user id to `createdUserIds` for afterAll cleanup. Caller must
 * pass a username unique within the run.
 */
async function seedUser(adminApi, { username, role }) {
    const res = await adminApi.post('/api/users/create', {
        data: {
            username,
            email: `${username}@rbac.test`,
            password: TEST_PASSWORD,
            role,
            name: `RBAC ${role}`,
        },
    });
    expect(res.status(), `seed ${role} user`).toBe(201);
    const body = await res.json();
    expect(body.user, `seed response carries user`).toBeTruthy();
    createdUserIds.push(body.user.id);
    return body.user;
}

/**
 * Helper: login as a freshly-seeded user (not in DEFAULT_CREDS) and return
 * an authenticated APIRequestContext. We bypass `loginAs` because that
 * helper only knows about the seeded admin/student fixtures.
 */
async function loginCustomUser(baseURL, username, password) {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const res = await ctx.post('/api/auth/login', { data: { username, password } });
        expect(res.status(), `login ${username}`).toBe(200);
        const body = await res.json();
        expect(body.token, `login token for ${username}`).toBeTruthy();
        return { token: body.token, user: body.user };
    } finally {
        await ctx.dispose();
    }
}

test.beforeAll(async ({ baseURL }) => {
    // 1. Admin context (used to seed everyone else + as the "admin baseline" assertions).
    adminCtx = await apiAsAdmin(baseURL);

    // Capture admin + student ids so we can target their resources without
    // hardcoding (1, 2) — the seeder *currently* assigns those, but the
    // test should not break if seed order changes.
    const adminLoginRes = await loginAs(baseURL, 'admin');
    adminUserId = adminLoginRes.user.id;
    const studentLoginRes = await loginAs(baseURL, 'student');
    studentUserId = studentLoginRes.user.id;
    studentCtx = await authedCtx(baseURL, studentLoginRes.token);

    // 2. Seed reviewer + educator + a legacy 'user' role account.
    reviewerUser = await seedUser(adminCtx, {
        username: `reviewer_${STAMP}`,
        role: 'reviewer',
    });
    educatorUser = await seedUser(adminCtx, {
        username: `educator_${STAMP}`,
        role: 'educator',
    });
    // Legacy alias: server normalizes 'user' -> 'student' on input, so
    // storage role becomes 'student'. We assert that normalization in the
    // dedicated test below; here we just seed the row.
    legacyUser = await seedUser(adminCtx, {
        username: `legacyuser_${STAMP}`,
        role: 'user',
    });

    // 3. Log them in so we have real JWTs for each rank.
    const reviewerLogin = await loginCustomUser(baseURL, reviewerUser.username, TEST_PASSWORD);
    reviewerCtx = await authedCtx(baseURL, reviewerLogin.token);

    const educatorLogin = await loginCustomUser(baseURL, educatorUser.username, TEST_PASSWORD);
    educatorCtx = await authedCtx(baseURL, educatorLogin.token);

    const legacyLogin = await loginCustomUser(baseURL, legacyUser.username, TEST_PASSWORD);
    legacyUserCtx = await authedCtx(baseURL, legacyLogin.token);
});

test.afterAll(async () => {
    // Clean up created users via admin API. We swallow per-row errors so
    // one stuck row (e.g. a 409 from case_versions FK) doesn't mask the
    // others. Order doesn't matter — DELETE /users/:id handles cascades.
    if (adminCtx) {
        for (const id of createdUserIds) {
            try {
                await adminCtx.delete(`/api/users/${id}`);
            } catch {
                /* best-effort cleanup */
            }
        }
        await adminCtx.dispose();
    }
    if (studentCtx) await studentCtx.dispose();
    if (reviewerCtx) await reviewerCtx.dispose();
    if (educatorCtx) await educatorCtx.dispose();
    if (legacyUserCtx) await legacyUserCtx.dispose();
});

// ----------------------------------------------------------------------
// 1. Student blocked from admin endpoints
// ----------------------------------------------------------------------
test('student is denied GET /api/admin/audit-log (403)', async () => {
    const res = await studentCtx.get('/api/admin/audit-log');
    expect(res.status()).toBe(403);
    const body = await res.json();
    // Insufficient role is the requireRole() rejection message.
    expect(body.error).toMatch(/insufficient role|access/i);
});

// ----------------------------------------------------------------------
// 2. Student blocked from cross-user reads
//
// The closest cross-user read the student can attempt is GET /api/users/:id
// for a different user. That route is admin-only; the student should be
// rejected with 403 before any data is exposed. This locks the
// "no horizontal escalation" property — students can't enumerate other
// users via the admin user-detail endpoint.
// ----------------------------------------------------------------------
test('student cannot read another user via GET /api/users/:id (403)', async () => {
    // Target the reviewer we seeded — guaranteed to exist and is not the student.
    const res = await studentCtx.get(`/api/users/${reviewerUser.id}`);
    expect(res.status()).toBe(403);
});

// ----------------------------------------------------------------------
// 3. Student own-data accessible
// ----------------------------------------------------------------------
test('student can read own /api/users/preferences (200)', async () => {
    const res = await studentCtx.get('/api/users/preferences');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Preferences either return the row or the synthetic defaults — both
    // are valid; what we're locking is "no 401/403 on own data".
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
});

// ----------------------------------------------------------------------
// 4. Reviewer can read analytics
//
// Reviewer rank (2) >= the cross-user read gate inside
// /api/learning-events/analytics/summary (canReadAcrossUsers). They should
// be able to query analytics without owning the underlying session.
// ----------------------------------------------------------------------
test('reviewer can GET /api/learning-events/analytics/summary (200)', async () => {
    const res = await reviewerCtx.get('/api/learning-events/analytics/summary');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Don't pin the shape — just lock "reviewer sees data, not 403".
    expect(body).toBeTruthy();
});

// ----------------------------------------------------------------------
// 5. Reviewer cannot write
//
// POST /api/cases is gated by requireEducator (rank 3). Reviewer is rank 2,
// so the call must 403. This is the load-bearing read-only property.
// ----------------------------------------------------------------------
test('reviewer cannot POST /api/cases (403)', async () => {
    const res = await reviewerCtx.post('/api/cases', {
        data: {
            name: `should-not-create-${STAMP}`,
            description: 'reviewer write attempt',
            system_prompt: '',
            config: {},
        },
    });
    expect(res.status()).toBe(403);
});

// ----------------------------------------------------------------------
// 6. Educator can author cases
//
// POST /api/cases requires educator-rank. Server replies res.json(...) which
// is HTTP 200 (not 201) — we assert ok() + an `id` so the test mirrors the
// real wire contract instead of an aspirational status code.
//
// We also clean up the case afterwards via admin so the shared e2e DB
// stays tidy; failure to clean up is non-fatal (handled by global teardown).
// ----------------------------------------------------------------------
test('educator can POST /api/cases and the case is created', async () => {
    const res = await educatorCtx.post('/api/cases', {
        data: {
            name: `educator-case-${STAMP}`,
            description: 'rbac authoring test',
            system_prompt: 'You are a test patient.',
            // patient_gender column has CHECK constraint IN ('Male','Female','Other')
            // so we use the canonical capitalized form here.
            config: { demographics: { name: 'Test', age: 40, gender: 'Male' } },
        },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id, 'created case id').toBeTruthy();

    // Best-effort cleanup of the case via admin context (not load-bearing).
    try {
        await adminCtx.delete(`/api/cases/${body.id}`);
    } catch {
        /* leave for end-of-run DB teardown */
    }
});

// ----------------------------------------------------------------------
// 7. Educator blocked from platform settings
//
// PUT /api/platform-settings/voice is requireAdmin. Educator (rank 3) must
// not be able to mutate it.
// ----------------------------------------------------------------------
test('educator cannot PUT /api/platform-settings/voice (403)', async () => {
    const res = await educatorCtx.put('/api/platform-settings/voice', {
        data: { tts_pitch: 0 },
    });
    expect(res.status()).toBe(403);
});

// ----------------------------------------------------------------------
// 8. Admin retains full access across all gates above.
//
// We hit each guarded endpoint with the admin context and assert it
// succeeds. This is the "positive-path" mirror of tests 1, 5, 7 — without
// it, a misconfigured server that 403s everyone would still pass the
// negative tests.
// ----------------------------------------------------------------------
test('admin retains access to admin/audit-log + platform-settings/voice + cases', async () => {
    const auditRes = await adminCtx.get('/api/admin/audit-log');
    expect(auditRes.status(), 'admin audit-log').toBe(200);

    const voiceRes = await adminCtx.get('/api/platform-settings/voice');
    expect(voiceRes.status(), 'admin platform-settings/voice GET').toBe(200);

    const caseRes = await adminCtx.post('/api/cases', {
        data: {
            name: `admin-case-${STAMP}`,
            description: 'rbac admin baseline',
            system_prompt: '',
            config: {},
        },
    });
    expect(caseRes.ok(), 'admin can author cases').toBe(true);
    const caseBody = await caseRes.json();
    if (caseBody.id) {
        try { await adminCtx.delete(`/api/cases/${caseBody.id}`); } catch { /* cleanup */ }
    }
});

// ----------------------------------------------------------------------
// 9. Self-escalation rejected
//
// There is no PUT /api/users/me — the self-update path students would try
// is PUT /api/users/:id (their own id). That route is requireAdmin, so it
// returns 403 regardless of the body. We assert:
//   (a) the call returns 403 (no escalation)
//   (b) the student's role on disk is unchanged afterwards (read back via
//       admin so we don't go through the same blocked endpoint).
// This locks the property the brief describes — "self-escalation rejected,
// role does not change" — at the wire level.
// ----------------------------------------------------------------------
test('student PUT /api/users/:self with role:admin is rejected and role does not change', async () => {
    const res = await studentCtx.put(`/api/users/${studentUserId}`, {
        data: { role: 'admin', username: 'student', email: 'student@local' },
    });
    expect(res.status()).toBe(403);

    // Read back via admin to confirm the role did not flip.
    const readRes = await adminCtx.get(`/api/users/${studentUserId}`);
    expect(readRes.status()).toBe(200);
    const readBody = await readRes.json();
    expect(readBody.user.role).toBe('student');
});

// ----------------------------------------------------------------------
// 10. Invalid role rejected on creation
//
// roleForStorage('sysop') returns 'sysop' (only the legacy 'user' alias
// is normalized). isValidRole('sysop') is false → server replies 400.
// ----------------------------------------------------------------------
test('admin creating a user with role "sysop" is rejected (400)', async () => {
    const res = await adminCtx.post('/api/users/create', {
        data: {
            username: `bogus_${STAMP}`,
            email: `bogus_${STAMP}@rbac.test`,
            password: TEST_PASSWORD,
            role: 'sysop',
        },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid role/i);
});

// ----------------------------------------------------------------------
// 11. Legacy 'user' role accepted (normalized to student)
//
// We seeded `legacyUser` with role:'user' in beforeAll. The server's
// roleForStorage() normalizes that to 'student' on insert, and the
// resulting account has student-rank semantics. We lock both halves:
//   (a) admin sees the stored role as 'student' (normalization happened)
//   (b) the legacy user, logged in, can read their own preferences
//       (200) but is denied the admin audit-log (403) — i.e. behaves
//       exactly like a student.
// ----------------------------------------------------------------------
test('legacy "user" role is normalized to student-rank', async () => {
    // (a) Storage normalization: admin reads the row and confirms role.
    const readRes = await adminCtx.get(`/api/users/${legacyUser.id}`);
    expect(readRes.status()).toBe(200);
    const readBody = await readRes.json();
    expect(readBody.user.role).toBe('student');

    // (b) Runtime rank: legacy user can read own data but not admin endpoints.
    const ownPrefs = await legacyUserCtx.get('/api/users/preferences');
    expect(ownPrefs.status(), 'legacy user reads own prefs').toBe(200);

    const auditDenied = await legacyUserCtx.get('/api/admin/audit-log');
    expect(auditDenied.status(), 'legacy user denied audit-log').toBe(403);
});
