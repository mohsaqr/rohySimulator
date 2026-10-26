// Regression lock: rows written for tenant ≥2 were filed under tenant 1 (session notes, patient record, active treatments, clinical notes, audit rows), an educator planted lab rows on another tenant's case, and client-supplied session/case ids were trusted on write (security audit 2026-10-26, F-15, F-16, F-17, F-18, F-19; migration 0072)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { all, asUser, closeDb, get, openDb, run, seedUser } from '../utils/authHttp.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function poll(fn, { tries = 40, ms = 100 } = {}) {
    for (let i = 0; i < tries; i += 1) {
        const v = await fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, ms));
    }
    return null;
}

describe('sec2 lane B — tenant stamps and trusted ids', () => {
    let server;
    let db;
    const ids = {};
    const as = {};

    beforeAll(async () => {
        server = await startTestServer();
        db = await openDb(server.dbPath);
        await run(db, "INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'sec2b-tr2', 'Tenant 2')");
        ids.edu1 = await seedUser(db, { username: 'tr_edu1', role: 'educator', tenantId: 1 });
        ids.stuA = await seedUser(db, { username: 'tr_stu_a', role: 'student', tenantId: 1 });
        ids.stuB = await seedUser(db, { username: 'tr_stu_b', role: 'student', tenantId: 1 });
        ids.admin2 = await seedUser(db, { username: 'tr_admin2', role: 'admin', tenantId: 2 });
        ids.stu2 = await seedUser(db, { username: 'tr_stu2', role: 'student', tenantId: 2 });

        ids.case1 = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id, is_available) VALUES ('TR case 1', 'p', '{}', 1, 1)")).lastID;
        ids.case2 = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id, is_available) VALUES ('TR secret tenant-2 title', 'p', '{}', 2, 1)")).lastID;
        ids.deletedCase = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id, deleted_at) VALUES ('TR deleted title', 'p', '{}', 1, CURRENT_TIMESTAMP)")).lastID;
        const session = async (caseId, userId, tenant) => (await run(db,
            "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S', 'active', ?)",
            [caseId, userId, tenant])).lastID;
        ids.sA = await session(ids.case1, ids.stuA, 1);
        ids.sB = await session(ids.case1, ids.stuB, 1);
        ids.s2 = await session(ids.case2, ids.stu2, 2);

        as.edu1 = await asUser(server.baseUrl, 'tr_edu1');
        as.stuA = await asUser(server.baseUrl, 'tr_stu_a');
        as.admin2 = await asUser(server.baseUrl, 'tr_admin2');
        as.stu2 = await asUser(server.baseUrl, 'tr_stu2');
    }, 120_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('F-15: an educator cannot add or reconcile labs on another tenant\'s case (Regression lock: cross-tenant lab planting)', async () => {
        const post = await as.edu1(`/api/cases/${ids.case2}/labs`, { method: 'POST', json: { test_name: 'Troponin I', current_value: '99' } });
        expect(post.status).toBe(404);
        const put = await as.edu1(`/api/cases/${ids.case2}/labs`, { method: 'PUT', json: { labs: [{ test_name: 'Troponin I', current_value: '99' }] } });
        expect(put.status).toBe(404);
        const planted = await get(db, 'SELECT COUNT(*) AS n FROM case_investigations WHERE case_id = ?', [ids.case2]);
        expect(planted.n).toBe(0);
        const own = await as.edu1(`/api/cases/${ids.case1}/labs`, { method: 'POST', json: { test_name: 'Troponin I', current_value: '0.01' } });
        expect(own.status).toBe(200);
    });

    it('F-16: a questionnaire cannot name a case the caller cannot open, and the GET never shows a foreign title (Regression lock: case-title enumeration)', async () => {
        for (const caseId of [ids.case2, ids.deletedCase]) {
            const res = await as.stuA('/api/questionnaire-responses', { method: 'POST', json: { case_id: caseId, responses: {} } });
            expect(res.status, `case ${caseId}`).toBe(404);
        }
        // A session's case comes from the session, whatever the body says.
        const ok = await as.stuA('/api/questionnaire-responses', { method: 'POST', json: { session_id: ids.sA, case_id: ids.case2, responses: { a: 1 } } });
        expect(ok.status).toBe(200);
        const row = await get(db, 'SELECT case_id FROM questionnaire_responses WHERE id = ?', [(await ok.json()).id]);
        expect(row.case_id).toBe(ids.case1);
        // A pre-fix row pointing at a foreign case is not labelled with its title.
        await run(db, "INSERT INTO questionnaire_responses (user_id, case_id, responses, tenant_id) VALUES (?, ?, '{}', 1)", [ids.stuA, ids.case2]);
        const listed = JSON.stringify(await (await as.stuA('/api/questionnaire-responses')).json());
        expect(listed).not.toContain('TR secret tenant-2 title');
        expect(listed).not.toContain('TR case 1');
    });

    it('F-39: one reflection per learner and session; a client-log line keeps only an owned session (Regression lock: unlimited rows, unchecked X-Rohy-Session-Id)', async () => {
        const again = await as.stuA('/api/questionnaire-responses', { method: 'POST', json: { session_id: ids.sA, responses: { a: 2 } } });
        expect(again.status).toBe(409);
        expect((await as.stuA('/api/questionnaire-responses', { method: 'POST', json: { responses: {} } })).status).toBe(400);
        const logs = await as.stuA('/api/client-logs/batch', {
            method: 'POST',
            headers: { 'X-Rohy-Session-Id': String(ids.sB) },
            json: { entries: [{ level: 'info', component: 'tr', msg: 'tr-foreign-session', ts: new Date().toISOString() }] },
        });
        expect(logs.status).toBeLessThan(300);
        const row = await poll(() => get(db, "SELECT session_id FROM client_logs WHERE msg = 'tr-foreign-session'"));
        expect(row).toBeTruthy();
        expect(row.session_id).toBeNull();
        const own = await as.stuA('/api/client-logs/batch', {
            method: 'POST',
            headers: { 'X-Rohy-Session-Id': String(ids.sA) },
            json: { entries: [{ level: 'info', component: 'tr', msg: 'tr-own-session', ts: new Date().toISOString() }] },
        });
        expect(own.status).toBeLessThan(300);
        const kept = await poll(() => get(db, "SELECT session_id FROM client_logs WHERE msg = 'tr-own-session'"));
        expect(kept?.session_id).toBe(ids.sA);
    });

    it("F-17: settings/log refuses another learner's session and never writes an event under their name (Regression lock: forged CHANGED_SETTING)", async () => {
        const res = await as.stuA('/api/settings/log', { method: 'POST', json: { setting_type: 'monitor', setting_name: 'x', session_id: ids.sB } });
        expect(res.status).toBe(403);
        const forged = await get(db, "SELECT COUNT(*) AS n FROM learning_events WHERE session_id = ? AND verb = 'CHANGED_SETTING'", [ids.sB]);
        expect(forged.n).toBe(0);
        const own = await as.stuA('/api/settings/log', { method: 'POST', json: { setting_type: 'monitor', setting_name: 'x', session_id: ids.sA } });
        expect(own.status).toBe(200);
        const logged = await get(db, 'SELECT case_id FROM settings_logs WHERE id = ?', [(await own.json()).id]);
        expect(logged.case_id).toBe(ids.case1);
    });

    it('F-18: session-owned rows carry the session tenant (Regression lock: rows filed under tenant 1)', async () => {
        expect((await as.stu2(`/api/sessions/${ids.s2}/discussion-notes`, { method: 'PUT', json: { note_text: 'my notes' } })).status).toBe(200);
        expect((await as.stu2(`/api/sessions/${ids.s2}/notes`, { method: 'POST', json: { content: 'charted' } })).status).toBe(200);
        const sync = await as.stu2('/api/patient-record/sync', {
            method: 'POST',
            json: {
                session_id: ids.s2, record_id: 'tr-rec',
                events: [{ id: 'tr-e1', verb: 'ORDERED', time: 1, category: 'lab', item: 'Hb', content: 'Hb' }],
                patient_info: { name: 'P' }, current_state: {}, events_count: 1, document: {},
            },
        });
        expect(sync.status).toBe(200);
        await run(db, "INSERT INTO treatment_effects (treatment_type, treatment_name, scope, tenant_id, is_active, onset_minutes, peak_minutes, duration_minutes, hr_effect) VALUES ('medication', 'tr_drug', 'platform', 1, 1, 1, 2, 10, -5)");
        const orderId = (await run(db, "INSERT INTO treatment_orders (session_id, treatment_type, treatment_item, status, tenant_id) VALUES (?, 'medication', 'tr_drug', 'ordered', 2)", [ids.s2])).lastID;
        const administered = await as.stu2(`/api/sessions/${ids.s2}/administer/${orderId}`, { method: 'POST', json: {} });
        expect(administered.status, await administered.clone().text()).toBe(200);

        const tenants = async (table) => (await poll(async () => {
            const rows = await all(db, `SELECT tenant_id FROM ${table} WHERE session_id = ?`, [ids.s2]);
            return rows.length ? rows : null;
        }))?.map((r) => r.tenant_id);
        expect(await tenants('session_notes')).toEqual([2]);
        expect(await tenants('clinical_notes')).toEqual([2]);
        expect(await tenants('patient_record_events')).toEqual([2]);
        expect(await tenants('patient_record_documents')).toEqual([2]);
        expect(await tenants('active_treatments')).toEqual([2]);
    });

    it('F-19: an audit row without an explicit tenant lands in the acting user\'s tenant (Regression lock: logAudit defaulted to tenant 1)', async () => {
        const target = await get(db, 'SELECT id FROM active_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [ids.stu2]);
        expect(target).toBeTruthy();
        const res = await as.admin2(`/api/admin/active-sessions/${target.id}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const row = await poll(() => get(db, "SELECT tenant_id FROM system_audit_log WHERE action = 'FORCE_LOGOUT' AND user_id = ? ORDER BY id DESC LIMIT 1", [ids.admin2]));
        expect(row?.tenant_id).toBe(2);
    });

    it('migration 0072 moves pre-fix rows to their session tenant and leaves tenant-1 rows alone (Regression lock: backfill)', async () => {
        await run(db, "INSERT INTO session_notes (session_id, user_id, note_text, tenant_id) VALUES (?, ?, 'legacy', 1)", [ids.sB, ids.stuB]);
        const legacyDoc = await run(db, "INSERT INTO clinical_notes (session_id, user_id, note_type, content, tenant_id) VALUES (?, ?, 'general', 'legacy t2', 1)", [ids.s2, ids.stu2]);
        const keepDoc = await run(db, "INSERT INTO clinical_notes (session_id, user_id, note_type, content, tenant_id) VALUES (?, ?, 'general', 'legacy t1', 1)", [ids.sA, ids.stuA]);
        const sql = fs.readFileSync(path.join(repoRoot, 'migrations', '0072_session_rows_tenant_backfill.sql'), 'utf8');
        await new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
        expect((await get(db, 'SELECT tenant_id FROM clinical_notes WHERE id = ?', [legacyDoc.lastID])).tenant_id).toBe(2);
        expect((await get(db, 'SELECT tenant_id FROM clinical_notes WHERE id = ?', [keepDoc.lastID])).tenant_id).toBe(1);
        expect((await get(db, 'SELECT tenant_id FROM session_notes WHERE session_id = ?', [ids.sB])).tenant_id).toBe(1);
        // Idempotent.
        await new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
        expect((await get(db, 'SELECT tenant_id FROM clinical_notes WHERE id = ?', [legacyDoc.lastID])).tenant_id).toBe(2);
    });
});
