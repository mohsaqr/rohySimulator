// Regression lock: an editor save deleted every learner's lab orders for the case (QA 2026-10-04, PRV-20)
//
// PUT /api/cases/:caseId/labs used to DELETE every investigation_order that
// pointed at the case's lab rows, then soft-delete and re-insert all rows. The
// case editor calls it on every save and auto-save, so simply opening a case
// erased the lab history of running and finished sessions.
//
// This suite locks the reconcile behaviour:
//   - saving the same list keeps every learner order and every row id,
//   - a changed value is updated in place (same id, order still resolves),
//   - a removed test is soft-deleted but the session that ordered it still
//     lists that order,
//   - a new test is inserted.

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
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}
async function withDb(dbPath, work) {
    const db = await openDb(dbPath);
    try { return await work(db); } finally { await dbClose(db); }
}
async function loginAs(server, username, password) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    return (await r.json()).token;
}

const LAB = (test_name, extra = {}) => ({
    test_name, test_group: 'Cardiac Markers', gender_category: 'General',
    min_value: 0, max_value: 0.04, current_value: 0.09, unit: 'ng/mL',
    normal_samples: [], is_abnormal: true, turnaround_minutes: 0, ...extra,
});

describe('PUT /api/cases/:caseId/labs — reconcile, never delete learner orders', () => {
    let server;
    let educatorToken;
    let studentToken;
    const CASE_ID = 70;
    const SESSION_ID = 710;

    const putLabs = (labs) => fetch(`${server.baseUrl}/api/cases/${CASE_ID}/labs`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${educatorToken}` },
        body: JSON.stringify({ labs }),
    });
    const liveRows = () => withDb(server.dbPath, (db) => dbAll(db,
        `SELECT id, test_name, current_value FROM case_investigations
         WHERE case_id = ? AND investigation_type = 'lab' AND deleted_at IS NULL ORDER BY id`, [CASE_ID]));
    const sessionOrders = async () => {
        const r = await fetch(`${server.baseUrl}/api/sessions/${SESSION_ID}/orders`, {
            headers: { authorization: `Bearer ${studentToken}` },
        });
        expect(r.status).toBe(200);
        return (await r.json()).orders.map(o => o.test_name).sort();
    };

    beforeAll(async () => {
        server = await startTestServer();
        await withDb(server.dbPath, async (db) => {
            const hash = await bcrypt.hash('correctpass', 4);
            await dbRun(db,
                `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
                 VALUES (700, 'recon_edu', 'Recon Educator', ?, 'recon-edu@example.com', 'educator', 'active', 1),
                        (701, 'recon_stu', 'Recon Student', ?, 'recon-stu@example.com', 'student', 'active', 1)`,
                [hash, hash]);
            await dbRun(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (?, 'Reconcile case', 'be a patient', 1)`, [CASE_ID]);
            await dbRun(db,
                `INSERT INTO sessions (id, case_id, user_id, student_name, status) VALUES (?, ?, 701, 'Recon Student', 'active')`,
                [SESSION_ID, CASE_ID]);
        });
        educatorToken = await loginAs(server, 'recon_edu', 'correctpass');
        studentToken = await loginAs(server, 'recon_stu', 'correctpass');

        // Author two labs, then the learner orders both.
        const first = await putLabs([LAB('Troponin I, cardiac'), LAB('Hemoglobin', { test_group: 'Hematology (CBC)', unit: 'g/dL' })]);
        expect(first.status).toBe(200);
        const ids = (await liveRows()).map(r => r.id);
        const order = await fetch(`${server.baseUrl}/api/sessions/${SESSION_ID}/order-labs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ lab_ids: ids, turnaround_override: 0 }),
        });
        expect(order.status).toBe(200);
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    it('saving the same list keeps every order and every row id', async () => {
        const before = await liveRows();
        expect(await sessionOrders()).toEqual(['Hemoglobin', 'Troponin I, cardiac']);

        const res = await putLabs([LAB('Troponin I, cardiac'), LAB('Hemoglobin', { test_group: 'Hematology (CBC)', unit: 'g/dL' })]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ updated: 2, inserted: 0, removed: 0 });

        expect((await liveRows()).map(r => r.id)).toEqual(before.map(r => r.id));
        expect(await sessionOrders()).toEqual(['Hemoglobin', 'Troponin I, cardiac']);
    }, 20_000);

    it('updates a changed value in place, keeping the id', async () => {
        const before = await liveRows();
        const res = await putLabs([LAB('Troponin I, cardiac', { current_value: 1.5 }), LAB('Hemoglobin', { test_group: 'Hematology (CBC)', unit: 'g/dL' })]);
        expect(res.status).toBe(200);
        const after = await liveRows();
        expect(after.map(r => r.id)).toEqual(before.map(r => r.id));
        expect(after.find(r => r.test_name === 'Troponin I, cardiac').current_value).toBe(1.5);
    }, 20_000);

    it('soft-deletes a removed test but the session still lists its order, and inserts a new one', async () => {
        const res = await putLabs([LAB('Troponin I, cardiac', { current_value: 1.5 }), LAB('Sodium, serum', { test_group: 'Basic Metabolic Panel', unit: 'mmol/L' })]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ updated: 1, inserted: 1, removed: 1 });

        expect((await liveRows()).map(r => r.test_name)).toEqual(['Troponin I, cardiac', 'Sodium, serum']);
        // Hemoglobin is gone from the case, not from the learner's history.
        expect(await sessionOrders()).toEqual(['Hemoglobin', 'Troponin I, cardiac']);
        const orderRows = await withDb(server.dbPath, (db) => dbAll(db,
            'SELECT COUNT(*) AS n FROM investigation_orders WHERE session_id = ?', [SESSION_ID]));
        expect(orderRows[0].n).toBe(2);
    }, 20_000);

    it('DELETE of one lab soft-deletes it and keeps the learner order', async () => {
        const troponin = (await liveRows()).find(r => r.test_name === 'Troponin I, cardiac');
        const res = await fetch(`${server.baseUrl}/api/cases/${CASE_ID}/labs/${troponin.id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${educatorToken}` },
        });
        expect(res.status).toBe(200);
        expect((await res.json()).learner_orders_kept).toBe(1);
        expect((await liveRows()).map(r => r.test_name)).toEqual(['Sodium, serum']);
        expect(await sessionOrders()).toEqual(['Hemoglobin', 'Troponin I, cardiac']);
    }, 20_000);

    it('refuses a lab without a test name and changes nothing', async () => {
        const before = await liveRows();
        const res = await putLabs([{ test_group: 'Nameless' }]);
        expect(res.status).toBe(400);
        expect(await liveRows()).toEqual(before);
    }, 20_000);
});
