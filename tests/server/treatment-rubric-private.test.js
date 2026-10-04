// Regression lock: the treatment grading rubric was stored in cases.config.treatments and every student received it (GET /cases, /cases/:id, the session snapshot, and available-treatments echoed it); the rubric PUT also ignored the tenant (Phase 0 security fix, 2026-10-04)
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';
import { startTestServer } from '../utils/startTestServer.js';

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../migrations/0065_treatment_rubric_out_of_config.sql'), 'utf8');
const RUBRIC = [
    { treatment_type: 'medication', treatment_name: 'Aspirin', is_available: true, is_expected: true, is_contraindicated: false, points_if_ordered: 10, feedback_if_ordered: 'Good', feedback_if_missed: 'Give aspirin' },
    { treatment_type: 'medication', treatment_name: 'Ibuprofen', is_available: true, is_expected: true, is_contraindicated: true, points_if_ordered: -5 },
    { treatment_type: 'medication', treatment_name: 'Hidden', is_available: false, is_expected: true },
];

describe('migration 0065', () => {
    let db;
    afterAll(async () => { await db?.cleanup(); });

    it('backfills rows only where a case has none, then strips the config copies', async () => {
        db = await createTestDb({ seed: true, label: 'rubric-0065' });
        const withConfigOnly = (await db.run(`INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('only-config', 'p', ?, 1)`, [JSON.stringify({ treatments: RUBRIC })])).lastID;
        const withRows = (await db.run(`INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('has-rows', 'p', ?, 1)`, [JSON.stringify({ treatments: RUBRIC })])).lastID;
        await db.run(`INSERT INTO case_treatments (case_id, treatment_type, treatment_name, is_expected, tenant_id) VALUES (?, 'medication', 'Heparin', 1, 1)`, [withRows]);
        await db.run(`INSERT INTO sessions (case_id, student_name, case_snapshot, tenant_id) VALUES (?, 's', ?, 1)`, [withConfigOnly, JSON.stringify({ config: { treatments: RUBRIC, patient_name: 'P' } })]);

        await db.exec(MIGRATION);

        const rows = await db.all(`SELECT treatment_name, is_available, is_expected, is_contraindicated, points_if_ordered FROM case_treatments WHERE case_id = ? ORDER BY treatment_name`, [withConfigOnly]);
        expect(rows).toEqual([
            { treatment_name: 'Aspirin', is_available: 1, is_expected: 1, is_contraindicated: 0, points_if_ordered: 10 },
            { treatment_name: 'Hidden', is_available: 0, is_expected: 0, is_contraindicated: 0, points_if_ordered: 0 },
            { treatment_name: 'Ibuprofen', is_available: 1, is_expected: 0, is_contraindicated: 1, points_if_ordered: -5 },
        ]);
        expect((await db.all(`SELECT treatment_name FROM case_treatments WHERE case_id = ?`, [withRows])).map((r) => r.treatment_name)).toEqual(['Heparin']);

        const configs = await db.all(`SELECT config FROM cases WHERE id IN (?, ?)`, [withConfigOnly, withRows]);
        configs.forEach((c) => expect(JSON.parse(c.config)).not.toHaveProperty('treatments'));
        const snap = JSON.parse((await db.get(`SELECT case_snapshot FROM sessions WHERE case_id = ?`, [withConfigOnly])).case_snapshot);
        expect(snap.config).not.toHaveProperty('treatments');
        expect(snap.config.patient_name).toBe('P');

        await db.exec(MIGRATION); // re-run: nothing added, nothing broken
        expect((await db.all(`SELECT id FROM case_treatments WHERE case_id = ?`, [withConfigOnly])).length).toBe(3);
    });
});

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!res.ok) throw new Error(`login ${username} ${res.status}`);
    return (await res.json()).token;
}
const pRun = (dbPath, sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (e) => {
        if (e) return reject(e);
        db.run(sql, params, function done(err) { db.close(() => (err ? reject(err) : resolve(this))); });
    });
});

describe('the rubric stays out of what students receive', () => {
    let server; let admin; let student; let caseId;
    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash('Student1!', 4);
        await pRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('rubric-student', 'S', 'rs@example.com', ?, 'student', 1, 'active')`, [hash]);
        await pRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('rubric-other-tenant', 'O', 'ro@example.com', ?, 'educator', 2, 'active')`, [hash]);
        const as = (token) => (p, init = {}) => fetch(`${server.baseUrl}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
        admin = as(await login(server.baseUrl, 'admin', 'admin123'));
        student = as(await login(server.baseUrl, 'rubric-student', 'Student1!'));
        server.otherTenant = as(await login(server.baseUrl, 'rubric-other-tenant', 'Student1!'));
        const created = await (await admin('/api/cases', { method: 'POST', body: JSON.stringify({ name: 'rubric', system_prompt: 'p', config: { patient_name: 'P', treatments: RUBRIC } }) })).json();
        caseId = created.id;
        await admin(`/api/cases/${caseId}/treatments`, { method: 'PUT', body: JSON.stringify({ treatments: RUBRIC }) });
    }, 90_000);
    afterAll(async () => { await server?.close(); });

    it('a saved case config carries no rubric, and the editor reads it from GET /cases/:id/treatments', async () => {
        const stored = await (await admin(`/api/cases/${caseId}`)).json();
        expect(stored.config).not.toHaveProperty('treatments');
        const { treatments } = await (await admin(`/api/cases/${caseId}/treatments`)).json();
        expect(treatments.map((t) => t.treatment_name)).toEqual(['Aspirin', 'Ibuprofen', 'Hidden']);
        expect(treatments[0]).toMatchObject({ is_expected: true, points_if_ordered: 10, feedback_if_missed: 'Give aspirin' });
    });

    it('students cannot read the rubric endpoint, and no student payload contains it', async () => {
        expect((await student(`/api/cases/${caseId}/treatments`)).status).toBe(403);
        const list = await (await student('/api/cases')).json();
        expect(JSON.stringify(list)).not.toContain('Give aspirin');
        const session = await (await student('/api/sessions', { method: 'POST', body: JSON.stringify({ case_id: caseId, student_name: 's' }) })).json();
        const avail = await (await student(`/api/sessions/${session.id}/available-treatments`)).json();
        expect(avail.config).toEqual({});
        expect(JSON.stringify(avail)).not.toContain('Give aspirin');
    });

    it('an educator in another tenant can neither read nor rewrite the rubric', async () => {
        expect((await server.otherTenant(`/api/cases/${caseId}/treatments`)).status).toBe(404);
        const put = await server.otherTenant(`/api/cases/${caseId}/treatments`, { method: 'PUT', body: JSON.stringify({ treatments: [] }) });
        expect(put.status).toBe(404);
        const { treatments } = await (await admin(`/api/cases/${caseId}/treatments`)).json();
        expect(treatments).toHaveLength(3);
    });

    // Regression lock: the PUT deleted the rubric and fired its inserts one by one outside a transaction, so a bad row left a partial rubric saved and reported success (Phase 3, 2026-10-04)
    it('a save with one bad row changes nothing and says so', async () => {
        const broken = [RUBRIC[0], { treatment_type: 'not-a-type', treatment_name: 'Bad' }];
        const put = await admin(`/api/cases/${caseId}/treatments`, { method: 'PUT', body: JSON.stringify({ treatments: broken }) });
        expect(put.status).toBe(500);
        const { treatments } = await (await admin(`/api/cases/${caseId}/treatments`)).json();
        expect(treatments.map((t) => t.treatment_name)).toEqual(['Aspirin', 'Ibuprofen', 'Hidden']);
    });
});
