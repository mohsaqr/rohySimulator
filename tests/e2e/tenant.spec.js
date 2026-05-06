// tenant.spec.js — Phase 5 / Stage E6 multi-tenant isolation lock-down.
//
// What it covers:
//   1. Default tenant (id=1, slug=default) exists.
//   2. Admins can create new tenants via POST /api/tenants.
//   3. Cases written in tenant A are invisible to an admin scoped to tenant B.
//   4. Mass-assignment resistance: a `tenant_id` field in the POST body is
//      ignored — the row uses the *authenticated user's* tenant_id.
//   5. Sessions in tenant A are unreachable (read + end) from tenant B.
//   6. /api/admin/active-sessions is tenant-scoped.
//   7. Tenant creation + user reassignment write audit rows that record the
//      tenant_id transition under oldValue/newValue.
//
// Setup model:
//   The seeded `admin` account starts in tenant 1. We DO NOT move it; instead
//   we mint a brand-new admin user, reassign it to tenant 2, and log in as
//   that user to drive the tenant-2 side of every assertion. That keeps the
//   sibling specs (auth, rbac, case-lifecycle, etc.) running against a
//   stable tenant-1 admin while we exercise isolation in parallel.
//
// All created tenant rows + users are best-effort cleaned up in `afterAll`.
// SQLite has no `DELETE FROM tenants` route exposed (intentionally — see
// migrations/0004_tenants.sql), so the tenant rows linger until the temp
// DB is reaped at the end of the run. That is fine for an isolated e2e DB
// and is the same pattern other Phase-5 specs use for write-only tables.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';

// Per-spec unique suffix so re-runs against a reused server don't collide
// on UNIQUE(slug) / UNIQUE(username). The webServer config uses a fresh
// temp DB per `npm run test:e2e`, but `reuseExistingServer: !CI` means a
// dev re-run from the same shell will reuse the prior DB.
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const T2_SLUG = `tenant-2-e2e-${RUN_ID}`;
const T2_NAME = `Tenant 2 E2E ${RUN_ID}`;
const T2_ADMIN_USERNAME = `t2admin-${RUN_ID}`;
const T2_ADMIN_EMAIL = `t2admin-${RUN_ID}@example.test`;
// Pass the password validator (>=8, upper, lower, digit).
const T2_ADMIN_PASSWORD = 'Tenant2Pass1';

// Shared state populated in beforeAll so each test can be independent.
let baseURL;
let adminCtx;        // tenant-1 admin (seeded `admin` account)
let t2AdminCtx;      // tenant-2 admin (created + reassigned in beforeAll)
let t2TenantId;      // numeric id of the second tenant
let t2AdminUserId;
let t1CaseId;        // case created by tenant-1 admin, used for negative tests
let t1SessionId;     // session created by tenant-1 admin, used for isolation tests

/**
 * Build an APIRequestContext that auto-attaches a Bearer token for an
 * arbitrary login (not just the seeded admin). Mirrors fixtures/seed.js's
 * `apiAsAdmin` but for ad-hoc credentials.
 */
async function apiAs(baseURL, username, password) {
    const loginCtx = await pwRequest.newContext({ baseURL });
    let token;
    try {
        const res = await loginCtx.post('/api/auth/login', { data: { username, password } });
        if (!res.ok()) {
            const body = await res.text();
            throw new Error(`Login as ${username} failed (${res.status()}): ${body}`);
        }
        const json = await res.json();
        if (!json.token) {
            throw new Error(`Login as ${username} returned no token`);
        }
        token = json.token;
    } finally {
        try { await loginCtx.dispose(); } catch { /* ignore */ }
    }
    return pwRequest.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
}

test.describe.configure({ mode: 'serial' });

test.describe('multi-tenant isolation', () => {
    test.beforeAll(async ({ baseURL: bu }) => {
        baseURL = bu;
        adminCtx = await apiAsAdmin(baseURL);

        // 1) Create tenant 2.
        const tRes = await adminCtx.post('/api/tenants', {
            data: { slug: T2_SLUG, name: T2_NAME },
        });
        expect(tRes.status(), `POST /api/tenants -> ${tRes.status()} ${await tRes.text()}`).toBe(201);
        const tBody = await tRes.json();
        t2TenantId = tBody.tenant.id;
        expect(t2TenantId).toBeGreaterThan(1);

        // 2) Create a brand-new admin user (in tenant 1, the seeded admin's
        //    home tenant — the create endpoint always plants new users in
        //    the actor's tenant, see POST /api/users/create).
        const uRes = await adminCtx.post('/api/users/create', {
            data: {
                username: T2_ADMIN_USERNAME,
                email: T2_ADMIN_EMAIL,
                password: T2_ADMIN_PASSWORD,
                role: 'admin',
                name: 'Tenant 2 Admin',
            },
        });
        expect(uRes.status(), `POST /api/users/create -> ${uRes.status()} ${await uRes.text()}`).toBe(201);
        const uBody = await uRes.json();
        t2AdminUserId = uBody.user.id;

        // 3) Re-assign that admin to tenant 2.
        const aRes = await adminCtx.post(`/api/users/${t2AdminUserId}/tenant`, {
            data: { tenant_id: t2TenantId },
        });
        expect(aRes.status(), `POST /api/users/:id/tenant -> ${aRes.status()} ${await aRes.text()}`).toBe(200);
        const aBody = await aRes.json();
        expect(aBody.user.tenant_id).toBe(t2TenantId);

        // 4) Mint a tenant-2 admin api context. Login re-reads tenant_id
        //    from the DB row, so the JWT we get back is scoped to tenant 2.
        t2AdminCtx = await apiAs(baseURL, T2_ADMIN_USERNAME, T2_ADMIN_PASSWORD);

        // 5) Create a case in tenant 1 (admin's home tenant) for the
        //    cross-tenant read tests below.
        const caseRes = await adminCtx.post('/api/cases', {
            data: {
                name: `t1-case-${RUN_ID}`,
                description: 'tenant 1 isolation probe',
                system_prompt: 'You are a patient.',
                config: { demographics: { age: 30, gender: 'Male' } },
            },
        });
        expect(caseRes.ok(), `POST /api/cases (t1) -> ${caseRes.status()} ${await caseRes.text()}`).toBeTruthy();
        const caseBody = await caseRes.json();
        t1CaseId = caseBody.id;
        expect(t1CaseId).toBeGreaterThan(0);

        // 6) Start a session for that case (still as tenant-1 admin) so the
        //    session-isolation tests have something to probe.
        const sRes = await adminCtx.post('/api/sessions', {
            data: { case_id: t1CaseId, student_name: 'tenant1-probe' },
        });
        expect(sRes.ok(), `POST /api/sessions (t1) -> ${sRes.status()} ${await sRes.text()}`).toBeTruthy();
        const sBody = await sRes.json();
        t1SessionId = sBody.id;
        expect(t1SessionId).toBeGreaterThan(0);
    });

    test.afterAll(async () => {
        // Best-effort cleanup. Soft-delete the t2 admin user (only path
        // available — DELETE /users/:id requires same-tenant actor, and
        // DELETE has been gated by `tenant_id = tenantId(req)` since E6).
        // We move the user back to tenant 1 first so the seeded admin can
        // delete it; if anything fails we swallow because the temp DB is
        // about to be reaped anyway.
        try {
            if (t2AdminUserId && adminCtx) {
                await adminCtx.post(`/api/users/${t2AdminUserId}/tenant`, {
                    data: { tenant_id: 1 },
                });
                await adminCtx.delete(`/api/users/${t2AdminUserId}`);
            }
        } catch { /* ignore */ }
        try { if (t2AdminCtx) await t2AdminCtx.dispose(); } catch { /* ignore */ }
        try { if (adminCtx) await adminCtx.dispose(); } catch { /* ignore */ }
    });

    test('default tenant (id=1, slug=default) is present', async () => {
        // The brief asks: GET /api/tenants returns at least the default
        // tenant. The codebase exposes POST /api/tenants but no GET listing
        // (see server/routes.js — admins are tenant-local in E6). We probe
        // the GET first so this assertion auto-strengthens the moment a
        // sibling agent or downstream feature ships a list endpoint.
        const listRes = await adminCtx.get('/api/tenants');

        if (listRes.status() === 200) {
            const json = await listRes.json();
            const tenants = json.tenants || json.rows || json;
            expect(Array.isArray(tenants)).toBeTruthy();
            const def = tenants.find(
                (t) => t && (t.slug === 'default' || t.id === 1),
            );
            expect(def, `expected default tenant in ${JSON.stringify(tenants)}`).toBeTruthy();
            expect(def.id).toBe(1);
            expect(def.slug).toBe('default');
        } else {
            // No list endpoint shipped yet. Verify the row exists by
            // attempting to create another tenant with slug='default' and
            // observing the UNIQUE-constraint conflict (POST /api/tenants
            // converts that to a 409).
            const conflictRes = await adminCtx.post('/api/tenants', {
                data: { slug: 'default', name: 'Default Tenant' },
            });
            expect(
                conflictRes.status(),
                `expected 409 on duplicate-default slug, got ${conflictRes.status()} ${await conflictRes.text()}`,
            ).toBe(409);
        }
    });

    test('admin can create a second tenant via POST /api/tenants', async () => {
        const slug = `extra-${RUN_ID}`;
        const res = await adminCtx.post('/api/tenants', {
            data: { slug, name: `Extra ${RUN_ID}` },
        });
        expect(res.status(), `POST /api/tenants -> ${res.status()} ${await res.text()}`).toBe(201);
        const body = await res.json();
        expect(body.tenant).toBeTruthy();
        expect(body.tenant.slug).toBe(slug);
        expect(body.tenant.id).toBeGreaterThan(0);
        expect(Number(body.tenant.is_default)).toBe(0);

        // Non-admin must be rejected. We use the seeded student account via
        // a fresh login.
        const studentCtx = await apiAs(baseURL, 'student', 'student123');
        try {
            const denied = await studentCtx.post('/api/tenants', {
                data: { slug: `denied-${RUN_ID}`, name: 'denied' },
            });
            expect([401, 403]).toContain(denied.status());
        } finally {
            // dispose() can race against trace artifact copy on some
            // platforms; swallow that — the assertion above is what
            // matters.
            try { await studentCtx.dispose(); } catch { /* ignore */ }
        }
    });

    test('cross-tenant case isolation: tenant-2 admin cannot see tenant-1 cases', async () => {
        // Tenant-2 admin lists cases; the t1-only case must not appear.
        const t2List = await t2AdminCtx.get('/api/cases');
        expect(t2List.ok()).toBeTruthy();
        const t2Json = await t2List.json();
        const t2Names = (t2Json.cases || []).map((c) => c.name);
        expect(t2Names).not.toContain(`t1-case-${RUN_ID}`);

        // Direct read of the t1 case id from t2 must 404 (the route filters
        // by tenant_id before the row check).
        const direct = await t2AdminCtx.get(`/api/cases/${t1CaseId}`);
        expect(direct.status()).toBe(404);

        // Sanity: the seeded admin (tenant 1) DOES see it.
        const t1List = await adminCtx.get('/api/cases');
        const t1Json = await t1List.json();
        const t1Names = (t1Json.cases || []).map((c) => c.name);
        expect(t1Names).toContain(`t1-case-${RUN_ID}`);
    });

    test('mass-assignment resistance: tenant_id in body is ignored on case create', async () => {
        // Tenant-2 admin creates a case while smuggling tenant_id=999 in the
        // body. The route ignores it and stamps the row with the
        // authenticated user's tenant (tenant 2).
        const name = `t2-massassign-${RUN_ID}`;
        const res = await t2AdminCtx.post('/api/cases', {
            data: {
                name,
                description: 'mass-assign probe',
                system_prompt: 'You are a patient.',
                config: { demographics: { age: 40, gender: 'Female' } },
                // The mass-assignment attempt:
                tenant_id: 999,
            },
        });
        expect(res.ok(), `POST /api/cases -> ${res.status()} ${await res.text()}`).toBeTruthy();
        const body = await res.json();
        const caseId = body.id;
        expect(caseId).toBeGreaterThan(0);

        // The newly-created case must be visible to tenant-2 admin (proves
        // the row was stamped with tenant 2, NOT tenant 999 — a row in
        // tenant 999 would be unreachable from anywhere).
        const t2Read = await t2AdminCtx.get(`/api/cases/${caseId}`);
        expect(t2Read.ok(), `t2 should see its own case, got ${t2Read.status()}`).toBeTruthy();
        const t2Body = await t2Read.json();
        // The case row exposes tenant_id directly via SELECT *; if the
        // shape ever changes, fall back to "tenant-1 admin must NOT see it".
        if (t2Body.tenant_id != null) {
            expect(Number(t2Body.tenant_id)).toBe(t2TenantId);
            expect(Number(t2Body.tenant_id)).not.toBe(999);
        }

        // Tenant-1 admin must NOT see this case.
        const t1Read = await adminCtx.get(`/api/cases/${caseId}`);
        expect(t1Read.status()).toBe(404);
    });

    test('cross-tenant session isolation: tenant-2 admin cannot read or end tenant-1 sessions', async () => {
        // Read attempt — sessions route filters by tenant_id, so this 404s.
        const readRes = await t2AdminCtx.get(`/api/sessions/${t1SessionId}`);
        expect(readRes.status(), `t2 read of t1 session should 404, got ${readRes.status()}`).toBe(404);

        // End attempt — must NOT succeed (route filters PUT/end by
        // tenant_id; tenant-2 actor sees no row to update).
        const endRes = await t2AdminCtx.put(`/api/sessions/${t1SessionId}/end`, { data: {} });
        expect(endRes.ok(), `t2 should not be able to end t1 session, got ${endRes.status()}`).toBeFalsy();
        expect([403, 404]).toContain(endRes.status());

        // Sanity: tenant-1 admin CAN still read the session.
        const t1Read = await adminCtx.get(`/api/sessions/${t1SessionId}`);
        expect(t1Read.ok(), `t1 should still see its own session, got ${t1Read.status()}`).toBeTruthy();
    });

    test('cross-tenant active-sessions read isolation', async () => {
        // active_sessions rows are written on /auth/login keyed to the
        // logged-in user's tenant_id. The seeded admin login (in beforeAll
        // via apiAsAdmin) wrote a row in tenant 1; the t2 admin's login
        // wrote a row in tenant 2.
        const t1Sessions = await adminCtx.get('/api/admin/active-sessions');
        expect(t1Sessions.ok()).toBeTruthy();
        const t1Body = await t1Sessions.json();
        const t1Usernames = (t1Body.sessions || []).map((s) => s.username);
        // The seeded admin must appear in tenant-1's view; the t2 admin
        // must NOT appear in tenant-1's view.
        expect(t1Usernames).toContain('admin');
        expect(t1Usernames).not.toContain(T2_ADMIN_USERNAME);

        const t2Sessions = await t2AdminCtx.get('/api/admin/active-sessions');
        expect(t2Sessions.ok()).toBeTruthy();
        const t2Body = await t2Sessions.json();
        const t2Usernames = (t2Body.sessions || []).map((s) => s.username);
        // Tenant-2 view must NOT include the seeded tenant-1 admin.
        expect(t2Usernames).not.toContain('admin');
    });

    test('tenant audit log records oldValue/newValue tenant_id transitions', async () => {
        // Both audit rows we want to inspect were written with the seeded
        // tenant-1 admin as the actor (tenant_id=1 on the row), so we must
        // query as tenant-1 admin.
        // We fetch a generous window because sibling specs may have added
        // rows in parallel.
        const res = await adminCtx.get('/api/admin/audit-log?limit=200');
        expect(res.ok(), `audit-log -> ${res.status()} ${await res.text()}`).toBeTruthy();
        const body = await res.json();
        const logs = body.logs || [];
        expect(Array.isArray(logs)).toBeTruthy();
        expect(logs.length).toBeGreaterThan(0);

        // 1) create_tenant for our T2_SLUG must appear with newValue.tenant_id
        //    set to t2TenantId. Audit rows store new_value as JSON text.
        const createRow = logs.find(
            (r) => r.action === 'create_tenant' && r.resource_name === T2_SLUG,
        );
        expect(createRow, `expected create_tenant audit row for ${T2_SLUG}`).toBeTruthy();
        const createNew = typeof createRow.new_value === 'string'
            ? JSON.parse(createRow.new_value)
            : createRow.new_value;
        expect(createNew).toBeTruthy();
        expect(Number(createNew.tenant_id)).toBe(t2TenantId);
        expect(createNew.slug).toBe(T2_SLUG);

        // 2) assign_user_tenant for our newly-minted admin must show the
        //    transition from tenant 1 -> tenant 2.
        const assignRow = logs.find(
            (r) => r.action === 'assign_user_tenant'
                && String(r.resource_id) === String(t2AdminUserId),
        );
        expect(assignRow, `expected assign_user_tenant audit row for user ${t2AdminUserId}`).toBeTruthy();
        const assignOld = typeof assignRow.old_value === 'string'
            ? JSON.parse(assignRow.old_value)
            : assignRow.old_value;
        const assignNew = typeof assignRow.new_value === 'string'
            ? JSON.parse(assignRow.new_value)
            : assignRow.new_value;
        expect(Number(assignOld.tenant_id)).toBe(1);
        expect(Number(assignNew.tenant_id)).toBe(t2TenantId);
    });
});
