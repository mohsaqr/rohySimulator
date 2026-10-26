// Regression lock: a tenant admin could rewrite or delete install-wide data — the master catalogues, platform-scope catalogue rows and treatment effects, the lab JSON — because the rc.78 guard was requireAdmin, not requirePlatformAdmin; DELETE /master/medications/all was unreachable behind /:id (security audit 2026-10-26, F-02, L2-09, L2-11, L7-18)
//
// Fixture: tenant 1 is the platform tenant (admin1 = platform admin); admin2
// administers tenant 2 only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { asUser, closeDb, get, openDb, run, seedUser } from '../utils/authHttp.js';

describe('sec2 lane B — platform-scope writes need a platform admin', () => {
    let server;
    let db;
    const ids = {};
    const as = {};

    beforeAll(async () => {
        server = await startTestServer();
        db = await openDb(server.dbPath);
        await run(db, "INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'sec2b-t2', 'Tenant 2')");
        await seedUser(db, { username: 'pw_admin1', role: 'admin', tenantId: 1 });
        await seedUser(db, { username: 'pw_admin2', role: 'admin', tenantId: 2 });
        await seedUser(db, { username: 'pw_edu2', role: 'educator', tenantId: 2 });
        ids.platformMed = (await run(db, "INSERT INTO medications (generic_name, scope, tenant_id, is_active) VALUES ('pw_platform_med', 'platform', 1, 1)")).lastID;
        ids.tenant2Med = (await run(db, "INSERT INTO medications (generic_name, scope, tenant_id, is_active, created_by) VALUES ('pw_t2_private_med', 'tenant', 2, 1, NULL)")).lastID;
        ids.t2OwnMed = (await run(db, "INSERT INTO medications (generic_name, scope, tenant_id, is_active) VALUES ('pw_t2_promotable', 'tenant', 2, 1)")).lastID;
        ids.platformLab = (await run(db, "INSERT INTO lab_tests (test_name, test_group, unit, scope, tenant_id, is_active) VALUES ('pw_platform_lab', 'G', 'u', 'platform', 1, 1)")).lastID;
        ids.platformEffect = (await run(db, "INSERT INTO treatment_effects (treatment_type, treatment_name, scope, tenant_id, is_active) VALUES ('medication', 'pw_platform_effect', 'platform', 1, 1)")).lastID;
        as.admin1 = await asUser(server.baseUrl, 'pw_admin1');
        as.admin2 = await asUser(server.baseUrl, 'pw_admin2');
        as.edu2 = await asUser(server.baseUrl, 'pw_edu2');
    }, 120_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('master catalogue writes refuse a tenant admin, accept a platform admin (Regression lock: tenant admin wrote /master/*)', async () => {
        const writes = [
            ['POST', '/api/master/medications', { generic_name: 'pw_new_med' }],
            ['POST', '/api/master/medications/bulk', { medications: [{ name: 'pw_bulk_med' }] }],
            ['DELETE', `/api/master/medications/${ids.platformMed}`],
            ['DELETE', '/api/master/medications/all'],
            ['POST', '/api/master/lab-tests', { test_name: 'pw_lab', test_group: 'G', unit: 'u' }],
            ['POST', '/api/master/body-regions', { region_id: 'pw_region', name: 'PW region' }],
            ['POST', '/api/master/scenario-templates', { template_id: 'pw_tpl', name: 'PW', duration_minutes: 5 }],
            ['POST', '/api/admin/seed/body-regions'],
            ['POST', '/api/labs/test', { test_name: 'pw_json_lab', category: 'X' }],
            ['POST', '/api/labs/reload'],
        ];
        for (const [method, path, json] of writes) {
            const res = await as.admin2(path, { method, json });
            expect(res.status, `${method} ${path}`).toBe(403);
        }
        const row = await get(db, 'SELECT deleted_at FROM medications WHERE id = ?', [ids.platformMed]);
        expect(row.deleted_at).toBeNull();

        const created = await as.admin1('/api/master/medications', { method: 'POST', json: { generic_name: 'pw_new_med' } });
        expect(created.status).toBe(200);
        const bulk = await as.admin1('/api/master/medications/bulk', { method: 'POST', json: { medications: [{ name: 'pw_bulk_a' }, { name: 'pw_bulk_b' }, {}] } });
        expect(bulk.status).toBe(200);
        expect(await bulk.json()).toMatchObject({ inserted: 2, skipped: 1, total: 3 });
        const one = await as.admin1(`/api/master/medications/${(await created.json()).id}`, { method: 'DELETE' });
        expect(one.status).toBe(200);
    });

    it('DELETE /master/medications/all is reachable and wipes for a platform admin (Regression lock: shadowed by /:id)', async () => {
        const res = await as.admin1('/api/master/medications/all', { method: 'DELETE' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toBe('All medications deleted');
        expect(body.deleted).toBeGreaterThan(0);
        const live = await get(db, 'SELECT COUNT(*) AS n FROM medications WHERE deleted_at IS NULL');
        expect(live.n).toBe(0);
        // Put the fixtures back for the rest of the file.
        await run(db, 'UPDATE medications SET deleted_at = NULL, is_active = 1 WHERE id IN (?, ?, ?)', [ids.platformMed, ids.tenant2Med, ids.t2OwnMed]);
    });

    it('catalogue platform rows: tenant admin may not edit, delete or promote to platform (Regression lock: canMutate admitted any admin)', async () => {
        expect((await as.admin2(`/api/catalogue/medications/${ids.platformMed}`, { method: 'PUT', json: { drug_class: 'x' } })).status).toBe(403);
        expect((await as.admin2(`/api/catalogue/medications/${ids.platformMed}`, { method: 'DELETE' })).status).toBe(403);
        expect((await as.admin2(`/api/catalogue/lab-tests/${ids.platformLab}`, { method: 'PUT', json: { unit: 'x' } })).status).toBe(403);
        const promote = await as.admin2(`/api/catalogue/medications/${ids.t2OwnMed}/promote`, { method: 'POST', json: { scope: 'platform' } });
        expect(promote.status).toBe(403);
        expect((await get(db, 'SELECT scope FROM medications WHERE id = ?', [ids.t2OwnMed])).scope).toBe('tenant');
        // Widening to the tenant's own scope stays a tenant admin's call.
        expect((await as.admin2(`/api/catalogue/medications/${ids.t2OwnMed}/promote`, { method: 'POST', json: { scope: 'tenant' } })).status).toBe(200);
        // The platform admin still edits platform rows.
        expect((await as.admin1(`/api/catalogue/medications/${ids.platformMed}`, { method: 'PUT', json: { drug_class: 'pw-class' } })).status).toBe(200);
    });

    it('treatment effects: tenant admin creates tenant rows and cannot touch platform rows (Regression lock: admin default scope platform)', async () => {
        const created = await as.admin2('/api/treatment-effects', { method: 'POST', json: { treatment_type: 'medication', treatment_name: 'pw_t2_effect' } });
        expect(created.status).toBe(201);
        expect((await created.json()).effect.scope).toBe('tenant');
        const asked = await as.admin2('/api/treatment-effects', { method: 'POST', json: { treatment_type: 'medication', treatment_name: 'pw_t2_platform', scope: 'platform' } });
        expect(asked.status).toBe(403);
        expect((await as.admin2(`/api/treatment-effects/${ids.platformEffect}`, { method: 'PUT', json: { treatment_name: 'pw_renamed' } })).status).toBe(403);
        expect((await as.admin2(`/api/treatment-effects/${ids.platformEffect}`, { method: 'DELETE' })).status).toBe(403);
        const platform = await as.admin1('/api/treatment-effects', { method: 'POST', json: { treatment_type: 'medication', treatment_name: 'pw_platform_new' } });
        expect(platform.status).toBe(201);
        expect((await platform.json()).effect.scope).toBe('platform');
    });

    it('anonymous master lists show platform-scope rows only (Regression lock: L2-09 public list leaked tenant rows)', async () => {
        const meds = await (await fetch(`${server.baseUrl}/api/master/medications?search=pw_`)).json();
        const names = meds.medications.map((m) => m.generic_name);
        expect(names).toContain('pw_platform_med');
        expect(names).not.toContain('pw_t2_private_med');
        expect(meds.medications.every((m) => m.scope === 'platform')).toBe(true);
    });

    it('install-level reads are a platform admin\'s (Regression lock: L2-11 tenant admin read install settings)', async () => {
        expect((await as.admin2('/api/platform-settings')).status).toBe(403);
        expect((await as.admin1('/api/platform-settings')).status).toBe(200);
        const t2 = await (await as.admin2('/api/setup/status')).json();
        expect(t2.llm).not.toHaveProperty('base_url');
        const t1 = await (await as.admin1('/api/setup/status')).json();
        expect(t1.llm).toHaveProperty('base_url');
        const voice = await (await as.admin2('/api/platform-settings/voice')).json();
        expect(voice).not.toHaveProperty('kokoro_remote_url');
        expect((await as.admin2('/api/platform-settings/voice/kokoro-remote/test', { method: 'POST', json: {} })).status).toBe(403);
        const llm = await (await as.edu2('/api/platform-settings/llm')).json();
        expect(llm).not.toHaveProperty('baseUrl');
    });

    it('rate limits: one reader with the proxy, validated writes; the LLM-test fingerprint never leaves the server (Regression lock: F-24, L2-11 hash oracle)', async () => {
        await run(db, "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('llm_last_test_ok', 'deadbeef') ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value");
        const dump = await (await as.admin1('/api/platform-settings')).json();
        expect(dump.settings.map((r) => r.setting_key)).not.toContain('llm_last_test_ok');
        const limits = await (await as.admin2('/api/platform-settings/rate-limits')).json();
        expect(limits).toMatchObject({ tokensPerUserDaily: 0, tokensTenantDaily: 0, costTenantDaily: 0 });
        expect((await as.admin1('/api/platform-settings/rate-limits', { method: 'PUT', json: { tokensPerUserDaily: -5 } })).status).toBe(400);
        expect((await as.admin1('/api/platform-settings/rate-limits', { method: 'PUT', json: { tokensTenantDaily: 5000 } })).status).toBe(200);
        expect((await (await as.admin1('/api/platform-settings/rate-limits')).json()).tokensTenantDaily).toBe(5000);
        await run(db, "DELETE FROM platform_settings WHERE setting_key = 'rate_limit_tokens_tenant_daily'");
    });

    it('database stats are tenant-scoped for a tenant admin (Regression lock: L7-18 install-wide counts)', async () => {
        const t2 = (await (await as.admin2('/api/admin/database-stats')).json()).stats;
        const t1 = (await (await as.admin1('/api/admin/database-stats')).json()).stats;
        expect(t2.users).toBe(2);
        expect(t1.users).toBeGreaterThan(t2.users);
        expect(t2).not.toHaveProperty('database_size_mb');
        expect(t1).toHaveProperty('database_size_mb');
    });

    it('catalogue lists clamp limit and treat LIKE wildcards literally (Regression lock: L7-18 limit=-1, raw % _)', async () => {
        await run(db, "INSERT INTO medications (generic_name, scope, tenant_id, is_active) VALUES ('pwq_lit', 'platform', 1, 1), ('pwqxlit', 'platform', 1, 1)");
        const hits = await (await as.edu2(`/api/catalogue/medications?q=${encodeURIComponent('pwq_')}`)).json();
        expect(hits.medications.map((m) => m.generic_name)).toEqual(['pwq_lit']);
        const one = await (await as.edu2('/api/catalogue/medications?limit=-1')).json();
        expect(one.medications.length).toBe(1);
    });
});
