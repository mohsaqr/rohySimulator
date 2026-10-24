// Regression locks for the route findings of the 2026-10-24 security audit
// (#1–#11; #12 lives in route-auth-allowlist.test.js). One real server, two
// tenants, and the cross-tenant / cross-role probes that used to succeed.
//
// Fixture: tenant 1 is the default ("platform") tenant, tenant 2 a second
// one. admin1 is therefore a platform admin; admin2 is a tenant admin only.

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { all, asUser, closeDb, get, openDb, run, seedUser } from '../utils/authHttp.js';

function captureServer(handler) {
    const hits = [];
    const srv = http.createServer((req, res) => {
        hits.push({ url: req.url, authorization: req.headers.authorization || null });
        handler(req, res);
    });
    return new Promise((resolve) => {
        srv.listen(0, '127.0.0.1', () => {
            resolve({
                hits,
                url: `http://127.0.0.1:${srv.address().port}`,
                close: () => new Promise((r) => srv.close(() => r())),
            });
        });
    });
}

describe('security audit 2026-10-24 — route fixes', () => {
    let server;
    let db;
    const ids = {};
    const as = {};

    beforeAll(async () => {
        server = await startTestServer();
        db = await openDb(server.dbPath);
        await run(db, "INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'audit-t2', 'Audit tenant 2')");

        ids.admin1 = await seedUser(db, { username: 'sa_admin1', role: 'admin', tenantId: 1 });
        ids.educator1 = await seedUser(db, { username: 'sa_edu1', role: 'educator', tenantId: 1 });
        ids.student1 = await seedUser(db, { username: 'sa_stu1', role: 'student', tenantId: 1 });
        ids.mover = await seedUser(db, { username: 'sa_mover', role: 'student', tenantId: 1 });
        ids.admin2 = await seedUser(db, { username: 'sa_admin2', role: 'admin', tenantId: 2 });
        ids.educator2 = await seedUser(db, { username: 'sa_edu2', role: 'educator', tenantId: 2 });
        ids.student2 = await seedUser(db, { username: 'sa_stu2', role: 'student', tenantId: 2 });

        // Tenant 1: two cases, a live session on case A, a soft-deleted session.
        ids.caseA = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('Audit A', 'p', '{}', 1)")).lastID;
        ids.caseB = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('Audit B', 'p', '{}', 1)")).lastID;
        ids.case2 = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('Audit T2', 'p', '{}', 2)")).lastID;
        ids.session1 = (await run(db, "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S1', 'active', 1)", [ids.caseA, ids.student1])).lastID;
        ids.deletedSession = (await run(db, "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id, deleted_at) VALUES (?, ?, 'S1', 'active', 1, CURRENT_TIMESTAMP)", [ids.caseA, ids.student1])).lastID;
        ids.session2 = (await run(db, "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S2', 'active', 2)", [ids.case2, ids.student2])).lastID;
        await run(db, "INSERT INTO interactions (session_id, role, content, tenant_id) VALUES (?, 'user', 'secret transcript line', 1)", [ids.session1]);

        ids.invA = (await run(db, "INSERT INTO case_investigations (case_id, investigation_type, test_name, current_value, tenant_id) VALUES (?, 'lab', 'Audit Hb', '13', 1)", [ids.caseA])).lastID;
        ids.invB = (await run(db, "INSERT INTO case_investigations (case_id, investigation_type, test_name, current_value, tenant_id) VALUES (?, 'lab', 'Audit Na', '140', 1)", [ids.caseB])).lastID;

        // 1100 learning events for student1 (limit cap) — none in tenant 2.
        await run(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1100)
                       INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, tenant_id)
                       SELECT ?, ?, ?, 'viewed', 'audit', 1 FROM n`, [ids.session1, ids.student1, ids.caseA]);

        // Questionnaire rows in both tenants.
        await run(db, "INSERT INTO questionnaire_responses (session_id, user_id, case_id, responses, tenant_id) VALUES (?, ?, ?, '{\"diagnosis\":[\"t1-only\"]}', 1)", [ids.session1, ids.student1, ids.caseA]);

        // A private scenario owned by educator1.
        ids.privateScenario = (await run(db, "INSERT INTO scenarios (name, duration_minutes, timeline, created_by, is_public, tenant_id) VALUES ('Private audit', 10, '[]', ?, 0, 1)", [ids.educator1])).lastID;

        // A tenant-1 catalogue row (promote target).
        ids.t1Medication = (await run(db, "INSERT INTO medications (generic_name, scope, tenant_id, is_active) VALUES ('auditmed_t1', 'tenant', 1, 1)")).lastID;

        // Secret platform settings the system log must never show.
        await run(db, `INSERT INTO platform_settings (setting_key, setting_value) VALUES ('llm_api_key', 'sk-stored-secret')
                       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`);

        for (const [name, username] of Object.entries({
            admin1: 'sa_admin1', educator1: 'sa_edu1', student1: 'sa_stu1', admin2: 'sa_admin2', educator2: 'sa_edu2', student2: 'sa_stu2',
        })) {
            as[name] = await asUser(server.baseUrl, username);
        }
    }, 120_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    // --- #1 ---------------------------------------------------------------
    it('#1 system log refuses non-log tables and never dumps secrets (Regression lock: raw table dump)', async () => {
        for (const table of ['platform_settings', 'users', 'active_sessions', 'sqlite_master']) {
            const res = await as.admin1(`/api/system-log/table/${table}`);
            expect(res.status, table).toBe(404);
        }
        const ok = await as.admin1('/api/system-log/table/learning_events?limit=5');
        expect(ok.status).toBe(200);
        const body = await ok.json();
        expect(body.rows).toHaveLength(5);
        expect(JSON.stringify(body)).not.toContain('sk-stored-secret');
    });

    it('#1 system log table list is the allowlist with tenant-scoped counts (Regression lock: every table counted)', async () => {
        const t1 = await (await as.admin1('/api/system-log/tables')).json();
        const t2 = await (await as.admin2('/api/system-log/tables')).json();
        const names = t1.tables.map((t) => t.name);
        expect(names).toContain('learning_events');
        expect(names).not.toContain('platform_settings');
        expect(names).not.toContain('users');
        expect(t1.tables.find((t) => t.name === 'learning_events').count).toBeGreaterThanOrEqual(1100);
        // Tenant 2 has only its own login events, none of tenant 1's 1100.
        expect(t2.tables.find((t) => t.name === 'learning_events').count).toBeLessThan(50);
    });

    // --- #2 ---------------------------------------------------------------
    it('#2 tenant admin cannot create tenants or move users (Regression lock: tenant admin minted tenants / pulled users)', async () => {
        const create = await as.admin2('/api/tenants', { method: 'POST', json: { slug: 'evil', name: 'Evil' } });
        expect(create.status).toBe(403);
        const move = await as.admin2(`/api/users/${ids.student1}/tenant`, { method: 'POST', json: { tenant_id: 2 } });
        expect(move.status).toBe(403);
        expect((await get(db, 'SELECT tenant_id FROM users WHERE id = ?', [ids.student1])).tenant_id).toBe(1);
    });

    it('#2 platform admin can place another admin or a student, never themselves (Regression lock: cross-tenant user grab)', async () => {
        // Placing a new tenant's first admin is the job (tests/e2e/tenant.spec.js
        // does exactly that), so another admin may be moved; the caller's own
        // account may not, or the install could lose its last platform admin.
        const self = await as.admin1(`/api/users/${ids.admin1}/tenant`, { method: 'POST', json: { tenant_id: 2 } });
        expect(self.status).toBe(403);
        expect((await self.json()).code).toBe('self_move');
        expect((await get(db, 'SELECT tenant_id FROM users WHERE id = ?', [ids.admin1])).tenant_id).toBe(1);
        const peer = await as.admin1(`/api/users/${ids.admin2}/tenant`, { method: 'POST', json: { tenant_id: 2 } });
        expect(peer.status).toBe(200);
        const student = await as.admin1(`/api/users/${ids.mover}/tenant`, { method: 'POST', json: { tenant_id: 2 } });
        expect(student.status).toBe(200);
    });

    // --- #3 ---------------------------------------------------------------
    it('#3 complete-session export is tenant- and owner-scoped (Regression lock: cross-tenant transcript export)', async () => {
        const foreign = await as.educator2(`/api/export/complete-session/${ids.session1}`);
        expect(foreign.status).toBe(404);
        expect(await foreign.text()).not.toContain('secret transcript line');
        const otherStudent = await as.student2(`/api/export/complete-session/${ids.session1}`);
        expect(otherStudent.status).toBe(404);
        const deleted = await as.student1(`/api/export/complete-session/${ids.deletedSession}`);
        expect(deleted.status).toBe(404);
        const own = await as.student1(`/api/export/complete-session/${ids.session1}`);
        expect(own.status).toBe(200);
    });

    // --- #4 ---------------------------------------------------------------
    it('#4 questionnaire reads are tenant-scoped (Regression lock: admin export / reviewer list across tenants)', async () => {
        const csv = await (await as.admin2('/api/export/questionnaire-responses')).text();
        expect(csv).not.toContain('t1-only');
        const list = await (await as.educator2('/api/questionnaire-responses')).json();
        expect(JSON.stringify(list)).not.toContain('t1-only');
        const own = await (await as.admin1('/api/questionnaire-responses')).json();
        expect(JSON.stringify(own)).toContain('t1-only');
    });

    it('#4 questionnaire/emotion writes verify the session and stamp the tenant (Regression lock: foreign session_id, missing tenant_id)', async () => {
        const foreignQ = await as.student2('/api/questionnaire-responses', { method: 'POST', json: { session_id: ids.session1, responses: { a: 1 } } });
        expect(foreignQ.status).toBe(404);
        const foreignE = await as.student2('/api/emotion-logs', { method: 'POST', json: { session_id: ids.session1, emotion: 'calm' } });
        expect(foreignE.status).toBe(404);
        const mine = await as.student2('/api/questionnaire-responses', { method: 'POST', json: { session_id: ids.session2, responses: { a: 1 } } });
        expect(mine.status).toBe(200);
        const row = await get(db, 'SELECT tenant_id FROM questionnaire_responses WHERE id = ?', [(await mine.json()).id]);
        expect(row.tenant_id).toBe(2);
    });

    it('#4 learning-events per-user limit is capped at 1000 (Regression lock: limit=-1 returned everything)', async () => {
        // Out-of-range clamps into [1, 1000]; a non-integer falls back to 1000.
        for (const [limit, expected] of [['-1', 1], ['5000', 1000], ['abc', 1000], ['1000000', 1000]]) {
            const res = await as.admin1(`/api/learning-events/user/${ids.student1}?limit=${limit}`);
            expect(res.status).toBe(200);
            const { events } = await res.json();
            expect(events.length, `limit=${limit}`).toBe(expected);
        }
    });

    // --- #5 ---------------------------------------------------------------
    it("#5 an order may only name the session case's investigations (Regression lock: arbitrary investigation_ids inserted)", async () => {
        const foreign = await as.student1(`/api/sessions/${ids.session1}/order`, { method: 'POST', json: { investigation_ids: [ids.invB] } });
        expect(foreign.status).toBe(400);
        const own = await as.student1(`/api/sessions/${ids.session1}/order`, { method: 'POST', json: { investigation_ids: [ids.invA, ids.invB] } });
        expect(own.status).toBe(200);
        const ordered = await all(db, 'SELECT investigation_id FROM investigation_orders WHERE session_id = ?', [ids.session1]);
        expect(ordered.map((r) => r.investigation_id)).toEqual([ids.invA]);
    });

    it("#5 lab edit is bound to the session's case and tenant (Regression lock: UPDATE by id alone)", async () => {
        const crossTenant = await as.educator2(`/api/sessions/${ids.session2}/labs/${ids.invA}`, { method: 'PUT', json: { current_value: '1' } });
        expect([403, 404]).toContain(crossTenant.status);
        const otherCase = await as.educator1(`/api/sessions/${ids.session1}/labs/${ids.invB}`, { method: 'PUT', json: { current_value: '1' } });
        expect([403, 404]).toContain(otherCase.status);
        const values = await all(db, 'SELECT id, current_value FROM case_investigations WHERE id IN (?, ?) ORDER BY id', [ids.invA, ids.invB]);
        expect(values.map((v) => String(v.current_value))).toEqual(['13', '140']);
    });

    it("#5 investigations attach only to the caller's tenant's cases; treatments need session access (Regression lock: foreign case_id / open treatments)", async () => {
        const res = await as.educator1('/api/investigations', { method: 'POST', json: { case_id: ids.case2, investigation_type: 'lab', test_name: 'x' } });
        expect(res.status).toBe(404);
        const treat = await as.student2(`/api/sessions/${ids.session1}/available-treatments`);
        expect(treat.status).toBe(404);
    });

    // --- #6 ---------------------------------------------------------------
    it('#6 master catalogue writes are admin-only (Regression lock: educator wrote global catalogue)', async () => {
        const edu = await as.educator1('/api/master/medications', { method: 'POST', json: { generic_name: 'edu_med' } });
        expect(edu.status).toBe(403);
        const wipe = await as.educator1('/api/master/medications/all', { method: 'DELETE' });
        expect(wipe.status).toBe(403);
        const labs = await as.educator1('/api/labs/reload', { method: 'POST' });
        expect(labs.status).toBe(403);
    });

    // --- #7 ---------------------------------------------------------------
    it('#7 public master GETs clamp paging and treat LIKE wildcards literally (Regression lock: limit=-1, raw % _)', async () => {
        const a = await as.admin1('/api/master/medications', { method: 'POST', json: { generic_name: 'zzqaudit_lit' } });
        expect(a.status).toBe(200);
        await as.admin1('/api/master/medications', { method: 'POST', json: { generic_name: 'zzqauditxlit' } });

        const search = await (await fetch(`${server.baseUrl}/api/master/medications?search=${encodeURIComponent('zzqaudit_')}`)).json();
        const names = (search.medications || search).map((m) => m.generic_name);
        expect(names).toEqual(['zzqaudit_lit']);

        const everything = await fetch(`${server.baseUrl}/api/master/medications?limit=-1&offset=-5`);
        expect(everything.status).toBe(200);
        const rows = await everything.json();
        expect((rows.medications || rows).length).toBeLessThanOrEqual(200);
    });

    // --- #9 ---------------------------------------------------------------
    it('#9 a tenant admin cannot write platform settings; a platform admin can (Regression lock: tenant admin rewrote global LLM config)', async () => {
        const llm = await as.admin2('/api/platform-settings/llm', { method: 'PUT', json: { model: 'evil-model' } });
        expect(llm.status).toBe(403);
        expect((await llm.json()).code).toBe('platform_admin_required');
        const reg = await as.admin2('/api/platform-settings/registration', { method: 'PUT', json: { mode: 'open' } });
        expect(reg.status).toBe(403);
        const voice = await as.admin2('/api/platform-settings/voice', { method: 'PUT', json: {} });
        expect(voice.status).toBe(403);
        const ok = await as.admin1('/api/platform-settings/llm', { method: 'PUT', json: { model: 'audit-model' } });
        expect(ok.status).toBe(200);
        // Reads stay open to tenant admins.
        expect((await as.admin2('/api/platform-settings')).status).toBe(200);
    });

    // --- #10 --------------------------------------------------------------
    it('#10 detect never sends the stored key to a different URL, follows no redirect, truncates upstream text (Regression lock: key exfil via body baseUrl)', async () => {
        const models = await captureServer((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: [{ id: 'm1' }] }));
        });
        const sink = await captureServer((req, res) => { res.writeHead(200); res.end('{}'); });
        const bouncer = await captureServer((req, res) => {
            res.writeHead(302, { location: `${sink.url}/models` });
            res.end();
        });
        const noisy = await captureServer((req, res) => { res.writeHead(500); res.end('E'.repeat(2000)); });
        try {
            await run(db, `INSERT INTO platform_settings (setting_key, setting_value) VALUES ('llm_base_url', ?)
                           ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [models.url]);

            // Different URL + the "[redacted]" placeholder: no key travels.
            await as.admin1('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai', baseUrl: `${sink.url}/v1`, apiKey: '[redacted]' } });
            expect(sink.hits).toHaveLength(1);
            expect(sink.hits[0].authorization).toBeNull();

            // Stored URL: the stored key is used.
            const stored = await as.admin1('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai' } });
            expect(stored.status).toBe(200);
            expect(models.hits.at(-1).authorization).toBe('Bearer sk-stored-secret');

            // A redirect is not followed.
            const before = sink.hits.length;
            await as.admin1('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai', baseUrl: bouncer.url, apiKey: '' } });
            expect(sink.hits.length).toBe(before);

            // Upstream error text is truncated.
            const err = await as.admin1('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai', baseUrl: noisy.url, apiKey: '' } });
            expect(err.status).toBe(400);
            expect((await err.json()).error.length).toBeLessThan(400);

            // A non-http URL is refused before any fetch.
            const bad = await as.admin1('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai', baseUrl: 'file:///etc/passwd' } });
            expect(bad.status).toBe(400);
            // And a tenant admin may not probe at all.
            const t2 = await as.admin2('/api/platform-settings/llm/models/detect', { method: 'POST', json: { provider: 'openai' } });
            expect(t2.status).toBe(403);
        } finally {
            await Promise.all([models.close(), sink.close(), bouncer.close(), noisy.close()]);
        }
    }, 30_000);

    // --- #11 --------------------------------------------------------------
    it('#11 a private scenario is readable only by its author (Regression lock: GET /scenarios/:id skipped is_public)', async () => {
        expect((await as.student1(`/api/scenarios/${ids.privateScenario}`)).status).toBe(404);
        expect((await as.educator1(`/api/scenarios/${ids.privateScenario}`)).status).toBe(200);
    });

    it("#11 promote is limited to the caller's tenant's rows (Regression lock: cross-tenant promote to platform)", async () => {
        const res = await as.admin2(`/api/catalogue/medications/${ids.t1Medication}/promote`, { method: 'POST', json: { scope: 'platform' } });
        expect(res.status).toBe(404);
        expect((await get(db, 'SELECT scope FROM medications WHERE id = ?', [ids.t1Medication])).scope).toBe('tenant');
    });

    it('#11 a soft-deleted session is gone for session-scoped routes (Regression lock: verifySessionOwnership ignored deleted_at)', async () => {
        expect((await as.student1(`/api/sessions/${ids.deletedSession}/orders`)).status).toBe(404);
        expect((await as.admin1(`/api/analytics/sessions/${ids.deletedSession}`)).status).toBe(404);
    });
});
