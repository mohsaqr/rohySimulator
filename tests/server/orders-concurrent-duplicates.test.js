// Identical orders arriving at the same moment become ONE order.
//
// Lab, imaging and treatment orders each checked "already ordered?" and then
// inserted, as two steps. Under load (stability run, rc.47) identical requests
// both passed the check: labs and studies were ordered twice, and a repeated
// expected treatment was scored as the first order twice. The lab check now
// lives inside the INSERT; imaging and treatment run check and insert under a
// lock on (session, item).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'Concur1!';
const PARALLEL = 8;

const openDb = (p) => new Promise((resolve, reject) => { const db = new (sqlite3.verbose()).Database(p, (e) => (e ? reject(e) : resolve(db))); });
const pRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(e) { e ? reject(e) : resolve(this); }));
const pGet = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
async function withDb(p, work) { const db = await openDb(p); try { return await work(db); } finally { await new Promise((r) => db.close(r)); } }

describe('concurrent identical orders', () => {
    let server;
    let token;
    let sessionId;
    let labId;

    const api = (path, body) => fetch(`${server.baseUrl}/api${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        await withDb(server.dbPath, async (db) => {
            const hash = await bcrypt.hash(PASSWORD, 4);
            await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                            VALUES ('cc-student', 'cc', 'cc@example.com', ?, 'student', 1, 'active')`, [hash]);
            await pRun(db, `INSERT INTO treatment_effects (treatment_type, treatment_name, route, description, is_active)
                            VALUES ('medication', 'CC Aspirinol', 'PO', 'expected', 1)`);
            const c = await pRun(db, `INSERT INTO cases (name, tenant_id, is_available, is_default, config)
                                      VALUES ('CC Case', 1, 1, 1, '{"investigations":{"instantResults":true}}')`);
            await pRun(db, `INSERT INTO case_treatments (case_id, treatment_type, treatment_name, is_available, is_expected, is_contraindicated, points_if_ordered)
                            VALUES (?, 'medication', 'CC Aspirinol', 1, 1, 0, 100)`, [c.lastID]);
            const lab = await pRun(db, `INSERT INTO case_investigations (case_id, investigation_type, test_name, test_group, current_value, unit, tenant_id)
                                        VALUES (?, 'lab', 'CC Hemoglobin', 'Hematology', 140, 'g/L', 1)`, [c.lastID]);
            labId = lab.lastID;
            const login = await fetch(`${server.baseUrl}/api/auth/login`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'cc-student', password: PASSWORD }),
            });
            token = (await login.json()).token;
            const start = await api('/sessions', { case_id: c.lastID });
            sessionId = (await start.json()).id;
        });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const countOf = (sql, params) => withDb(server.dbPath, (db) => pGet(db, sql, params)).then((r) => r.n);

    it('a lab ordered by several identical requests at once is ordered once', async () => {
        // Regression lock: SELECT-then-INSERT let parallel identical lab orders all insert
        const answers = await Promise.all(Array.from({ length: PARALLEL }, () => api(`/sessions/${sessionId}/order-labs`, { lab_ids: [labId] })));
        expect(answers.map((r) => r.status)).toEqual(Array(PARALLEL).fill(200));
        expect(await countOf('SELECT COUNT(*) AS n FROM investigation_orders WHERE session_id = ? AND investigation_id = ?', [sessionId, labId])).toBe(1);
    });

    it('a study ordered by several identical requests at once is ordered once', async () => {
        // Regression lock: parallel identical imaging orders each inserted a study row and an order
        const answers = await Promise.all(Array.from({ length: PARALLEL }, () => api(`/sessions/${sessionId}/order-radiology`, { radiology_ids: ['xray_cspine'] })));
        expect(answers.map((r) => r.status)).toEqual(Array(PARALLEL).fill(200));
        expect(await countOf(`SELECT COUNT(*) AS n FROM investigation_orders io JOIN case_investigations ci ON ci.id = io.investigation_id
                               WHERE io.session_id = ? AND ci.investigation_type = 'radiology'`, [sessionId])).toBe(1);
    });

    it('an expected treatment ordered several times at once scores once', async () => {
        // Regression lock: parallel identical treatment orders were each scored as the first
        const answers = await Promise.all(Array.from({ length: PARALLEL }, () => api(`/sessions/${sessionId}/order-treatment`, {
            treatment_type: 'medication', treatment_name: 'CC Aspirinol', dose: '1 mg', route: 'PO',
        })));
        expect(answers.map((r) => r.status)).toEqual(Array(PARALLEL).fill(201));
        const bodies = await Promise.all(answers.map((r) => r.json()));
        expect(bodies.filter((b) => b.repeat === false)).toHaveLength(1);
        expect(await countOf('SELECT SUM(points_awarded) AS n FROM treatment_orders WHERE session_id = ?', [sessionId])).toBe(100);
    });

    it('an exam finding posted several times at once is recorded and counted once', async () => {
        // Regression lock: parallel identical findings each inserted a row and bumped exam_findings_count
        const answers = await Promise.all(Array.from({ length: PARALLEL }, () => api(`/sessions/${sessionId}/exam-findings`, {
            body_region: 'chest', exam_type: 'auscultation', finding: 'clear',
        })));
        expect(answers.map((r) => r.status)).toEqual(Array(PARALLEL).fill(200));
        const bodies = await Promise.all(answers.map((r) => r.json()));
        expect(bodies.filter((b) => b.already_recorded === false)).toHaveLength(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM physical_exam_findings WHERE session_id = ?', [sessionId])).toBe(1);
        expect(await countOf('SELECT exam_findings_count AS n FROM sessions WHERE id = ?', [sessionId])).toBe(1);
    });
});
