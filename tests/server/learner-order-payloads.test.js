// Regression lock: a learner's order payloads carry no answer key.
//
// Rohy is exam software. The lab catalogue used to send a learner every
// configured lab's value and abnormal flag before anything was ordered, plus a
// `source` and an id prefix (numeric / config_ / default_) that marked which
// tests the author had set up. The order worklists sent values and reports
// while the turnaround was still running, and radiology results said whether
// the author wrote them (`hasConfiguredResult`, `isNormalDefault`). None of it
// was on screen; all of it was readable in DevTools.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }

async function loginAs(server, username) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'correctpass' }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    return (await r.json()).token;
}

// The full lab catalogue is open; the author configured one abnormal value and
// one radiology report. Waits are long so every order is still pending.
const CASE_CONFIG = {
    investigations: {
        defaultTurnaround: 30,
        labs: [{
            id: 'lab_hb', test_name: 'Hemoglobin', test_group: 'Hematology', gender_category: 'Male',
            min_value: 13.5, max_value: 17.5, current_value: 6.1, unit: 'g/dL',
            normal_samples: [], is_abnormal: true, turnaround_minutes: null,
        }],
    },
    radiology: [{
        studyId: 'xray_chest_pa', studyName: 'Chest X-Ray (PA/Lateral)',
        findings: 'Bilateral alveolar oedema.', interpretation: 'Pulmonary oedema.', turnaroundMinutes: 30,
    }],
};

const RESULT_FIELDS = ['current_value', 'is_abnormal', 'normal_samples', 'min_value', 'max_value', 'source'];

describe('learner order payloads carry no answer key', () => {
    let server;
    let student;
    let educator;
    const get = (token, url) => fetch(`${server.baseUrl}/api${url}`, { headers: { authorization: `Bearer ${token}` } });
    const post = (token, url, body) => fetch(`${server.baseUrl}/api${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db, `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
                         VALUES (720, 'exam_student', 'Exam Student', ?, 'es@example.com', 'student', 'active', 1)`, [hash]);
        await dbRun(db, `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
                         VALUES (721, 'exam_educator', 'Exam Educator', ?, 'ee@example.com', 'educator', 'active', 1)`, [hash]);
        await dbRun(db, `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
                         VALUES (72, 'Exam case', 'be a patient', ?, 1)`, [JSON.stringify(CASE_CONFIG)]);
        await dbRun(db, `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
                         VALUES (820, 72, 720, 'Exam Student', 'active', 1)`);
        await dbRun(db, `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
                         VALUES (821, 72, 720, 'Exam Student', 'active', 1)`);
        await dbClose(db);
        student = await loginAs(server, 'exam_student');
        educator = await loginAs(server, 'exam_educator');
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    it('the lab catalogue gives a learner names only, one id shape for configured and database tests', async () => {
        const res = await get(student, '/sessions/820/available-labs');
        expect(res.status).toBe(200);
        const { labs } = await res.json();
        expect(labs.length).toBeGreaterThan(10);
        for (const lab of labs) {
            for (const field of RESULT_FIELDS) expect(lab, `${lab.test_name}.${field}`).not.toHaveProperty(field);
            expect(lab.id, lab.test_name).toMatch(/^default_/);
        }
        const hb = labs.find((l) => l.test_name === 'Hemoglobin');
        const other = labs.find((l) => l.test_name !== 'Hemoglobin');
        expect(Object.keys(hb).sort()).toEqual(Object.keys(other).sort());
    }, 20_000);

    it('an educator still gets the full catalogue', async () => {
        const { labs } = await (await get(educator, '/sessions/820/available-labs')).json();
        const hb = labs.find((l) => l.test_name === 'Hemoglobin');
        expect(hb.current_value).toBe(6.1);
        expect(hb.is_abnormal).toBe(true);
    }, 20_000);

    it('a learner ordering by name gets the configured value, and a repeat order reuses one case row', async () => {
        const { labs } = await (await get(student, '/sessions/820/available-labs')).json();
        const hb = labs.find((l) => l.test_name === 'Hemoglobin');
        const other = labs.find((l) => l.test_name !== 'Hemoglobin');
        expect((await post(student, '/sessions/820/order-labs', { lab_ids: [hb.id, other.id] })).status).toBe(200);
        expect((await post(student, '/sessions/821/order-labs', { lab_ids: [hb.id, other.id] })).status).toBe(200);

        const db = await openDb(server.dbPath);
        const rows = await dbAll(db, `SELECT io.session_id, ci.id AS row_id, ci.test_name, ci.current_value, ci.is_abnormal
                                      FROM investigation_orders io JOIN case_investigations ci ON ci.id = io.investigation_id
                                      WHERE io.session_id IN (820, 821) ORDER BY io.session_id, ci.test_name`);
        const caseRows = await dbAll(db, `SELECT test_name FROM case_investigations WHERE case_id = 72 AND investigation_type = 'lab'`);
        await dbClose(db);

        const hbRows = rows.filter((r) => r.test_name === 'Hemoglobin');
        expect(hbRows).toHaveLength(2);
        hbRows.forEach((r) => { expect(r.current_value).toBe(6.1); expect(r.is_abnormal).toBe(1); });
        // Both sessions point at the same rows: two tests, two case rows.
        expect(new Set(rows.map((r) => r.row_id)).size).toBe(2);
        expect(caseRows).toHaveLength(2);
    }, 20_000);

    it('a pending lab order shows no value to the learner', async () => {
        const { orders } = await (await get(student, '/sessions/820/orders')).json();
        expect(orders.length).toBe(2);
        for (const o of orders) {
            expect(o.is_ready).toBe(false);
            expect(o.current_value).toBeNull();
            expect(o.is_abnormal).toBeNull();
        }
        const asEducator = await (await get(educator, '/sessions/820/orders')).json();
        expect(asEducator.orders.find((o) => o.test_name === 'Hemoglobin').current_value).toBe(6.1);
    }, 20_000);

    it('a pending radiology report is withheld, and a due one does not say who wrote it', async () => {
        expect((await post(student, '/sessions/820/order-radiology', { radiology_ids: ['xray_chest_pa', 'xray_cspine'] })).status).toBe(200);
        let { orders } = await (await get(student, '/sessions/820/radiology-orders')).json();
        expect(orders).toHaveLength(2);
        orders.forEach((o) => { expect(o.is_ready).toBe(0); expect(o.result_data).toBeNull(); });

        const db = await openDb(server.dbPath);
        await dbRun(db, `UPDATE investigation_orders SET available_at = datetime('now', '-1 minute') WHERE session_id = 820`);
        await dbClose(db);

        ({ orders } = await (await get(student, '/sessions/820/radiology-orders')).json());
        const byName = Object.fromEntries(orders.map((o) => [o.test_name, JSON.parse(o.result_data)]));
        expect(byName['Chest X-Ray (PA/Lateral)'].findings).toBe('Bilateral alveolar oedema.');
        for (const report of Object.values(byName)) {
            expect(report).not.toHaveProperty('hasConfiguredResult');
            expect(report).not.toHaveProperty('isNormalDefault');
            expect(report).not.toHaveProperty('isCustomStudy');
        }
        const educatorView = await (await get(educator, '/sessions/820/radiology-orders')).json();
        expect(educatorView.orders.some((o) => JSON.parse(o.result_data).hasConfiguredResult === true)).toBe(true);
    }, 20_000);
});
