// Regression lock: GET /cases, GET /cases/:id, GET /sessions/:id and /analytics/sessions* sent a learner the case as stored — authoring title, description, system prompt, expected diagnosis, the author's notes to the model, scenario alternatives — and /cases/:id/investigations every result value; learners now get an allow-list of what their runtime reads (Phase 3, 2026-10-04)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import {
    projectCaseForRole, projectCaseConfigForRole, projectCaseSnapshotForRole, projectScenarioForRole,
} from '../../server/services/caseProjection.js';

const PASSWORD = 'ProjectionTests1!';
const TITLE = 'TITLE-Anterior-STEMI-with-LAD-occlusion';
const DESCRIPTION = 'DESCRIPTION-proximal-LAD';
const SYSTEM_PROMPT = 'SYSTEM-PROMPT-secret';
const DIAGNOSIS = 'ANSWER-KEY-anterior-STEMI';
const AI_NOTES = 'AI-NOTES-do-not-reveal';
const ALTERNATIVE = 'ALTERNATIVE-post-PCI';
const NEW_KEY = 'NEW-KEY-the-allow-list-has-never-heard-of';
const INVESTIGATION_VALUE = 'INVESTIGATION-troponin-52';

const config = {
    patient_name: 'John Example',
    demographics: { age: 58, gender: 'Male', mrn: 'MRN-1', private_note: NEW_KEY },
    structuredHistory: { chiefComplaint: 'chest pain', hpi: 'two hours', aiNotes: AI_NOTES, additionalNotes: AI_NOTES },
    diagnosis: DIAGNOSIS,
    expected_diagnosis: DIAGNOSIS,
    clinical_records: { differential_diagnosis: DIAGNOSIS },
    initialVitals: { hr: 104, spo2: 95 },
    physical_exam: { chest: { auscultation: { finding: 'S4', abnormal: true } } },
    voice: { case_voice: 'am_michael', tts_rate: 1, secret: NEW_KEY },
    personality: NEW_KEY,
    some_future_key: NEW_KEY,
};
const scenario = {
    autoStart: true,
    description: DESCRIPTION,
    alternatives: [{ name: ALTERNATIVE, timeline: [] }],
    timeline: [{ time: 0, label: 'start', params: { hr: 104 }, rhythm: 'sinus', note: NEW_KEY }],
};
const SECRETS = [TITLE, DESCRIPTION, SYSTEM_PROMPT, DIAGNOSIS, AI_NOTES, ALTERNATIVE, NEW_KEY];
const caseRow = { id: 7, name: TITLE, description: DESCRIPTION, system_prompt: SYSTEM_PROMPT, case_code: 'C-7', is_default: true, patient_name: 'John Example', learning_objectives: DIAGNOSIS, config, scenario };

describe('caseProjection (unit)', () => {
    it('a learner gets the runtime fields and none of the authoring side', () => {
        for (const role of ['student', 'guest', 'user']) {
            const out = projectCaseForRole(caseRow, PLUGIN_MANIFESTS, role);
            const text = JSON.stringify(out);
            for (const secret of SECRETS) expect(text, `${role} ${secret}`).not.toContain(secret);
            expect(out).toMatchObject({ id: 7, case_code: 'C-7', is_default: true, patient_name: 'John Example' });
            expect(out.config.physical_exam.chest.auscultation.finding).toBe('S4');
            expect(out.config.initialVitals.hr).toBe(104);
            expect(out.config.structuredHistory).toEqual({ chiefComplaint: 'chest pain', hpi: 'two hours' });
            expect(out.config.voice).toEqual({ case_voice: 'am_michael', tts_rate: 1 });
            expect(out.scenario).toEqual({ autoStart: true, timeline: [{ time: 0, label: 'start', params: { hr: 104 }, rhythm: 'sinus' }] });
        }
    });

    it('reviewer and above get the case untouched', () => {
        for (const role of ['reviewer', 'educator', 'admin']) {
            const out = projectCaseForRole(caseRow, PLUGIN_MANIFESTS, role);
            expect(out.name).toBe(TITLE);
            expect(out.config.diagnosis).toBe(DIAGNOSIS);
            expect(out.scenario).toBe(scenario);
        }
    });

    it('is idempotent and never adds a key the source lacked', () => {
        const once = projectCaseConfigForRole(config, PLUGIN_MANIFESTS, 'student');
        expect(projectCaseConfigForRole(once, PLUGIN_MANIFESTS, 'student')).toEqual(once);
        expect(projectCaseConfigForRole({}, PLUGIN_MANIFESTS, 'student')).toEqual({});
        expect(projectScenarioForRole(null, 'student')).toBeNull();
    });

    it('a snapshot keeps its form (string in, string out) and loses the title and prompt', () => {
        const snap = JSON.stringify({ case_id: 7, name: TITLE, system_prompt: SYSTEM_PROMPT, config, scenario, snapshot_at: 'T' });
        const out = projectCaseSnapshotForRole(snap, PLUGIN_MANIFESTS, 'student');
        expect(typeof out).toBe('string');
        for (const secret of SECRETS) expect(out).not.toContain(secret);
        expect(JSON.parse(out)).toMatchObject({ case_id: 7, snapshot_at: 'T' });
        expect(projectCaseSnapshotForRole(snap, PLUGIN_MANIFESTS, 'admin')).toBe(snap);
        // Nothing in an unreadable snapshot can be vouched for.
        expect(projectCaseSnapshotForRole('{not json', PLUGIN_MANIFESTS, 'student')).toBeNull();
        expect(projectCaseSnapshotForRole('{not json', PLUGIN_MANIFESTS, 'admin')).toBe('{not json');
    });
});

let server; let studentToken; let educatorToken; let caseId; let sessionId;
const pRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));

beforeAll(async () => {
    server = await startTestServer();
    const db = await new Promise((resolve, reject) => { const d = new (sqlite3.verbose().Database)(server.dbPath, (e) => (e ? reject(e) : resolve(d))); });
    let studentId;
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        studentId = (await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('proj-student', 'S', 'ps@example.com', ?, 'student', 1, 'active')`, [hash])).lastID;
        await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('proj-educator', 'E', 'pe@example.com', ?, 'educator', 1, 'active')`, [hash]);
        caseId = (await pRun(db, `INSERT INTO cases (name, description, system_prompt, config, scenario, is_available, tenant_id) VALUES (?, ?, ?, ?, ?, 1, 1)`,
            [TITLE, DESCRIPTION, SYSTEM_PROMPT, JSON.stringify(config), JSON.stringify(scenario)])).lastID;
        const snapshot = { case_id: caseId, name: TITLE, system_prompt: SYSTEM_PROMPT, config, scenario, snapshot_at: 'T' };
        sessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, student_name, status, case_snapshot, tenant_id) VALUES (?, ?, 'S', 'active', ?, 1)`,
            [caseId, studentId, JSON.stringify(snapshot)])).lastID;
        await pRun(db, `INSERT INTO case_investigations (case_id, investigation_type, test_name, result_data, tenant_id) VALUES (?, 'lab', 'Troponin', ?, 1)`,
            [caseId, JSON.stringify({ value: INVESTIGATION_VALUE })]);
    } finally { await new Promise((r) => db.close(r)); }
    const login = async (username) => (await (await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }),
    })).json()).token;
    studentToken = await login('proj-student');
    educatorToken = await login('proj-educator');
}, 90_000);
afterAll(async () => { await server?.close(); });

const get = (token, path) => fetch(`${server.baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('learner endpoints carry no authoring material', () => {
    const paths = () => [`/cases`, `/cases/${caseId}`, `/sessions/${sessionId}`, `/analytics/sessions`, `/analytics/sessions/${sessionId}`];

    it('as the student, every response is free of the title, prompt, answer key and unknown keys', async () => {
        for (const path of paths()) {
            const res = await get(studentToken, path);
            expect(res.status, path).toBe(200);
            const text = await res.text();
            for (const secret of SECRETS) expect(text, `${path} leaked ${secret}`).not.toContain(secret);
        }
    });

    it('as the student, the runtime still gets what it reads', async () => {
        const single = await (await get(studentToken, `/cases/${caseId}`)).json();
        expect(single.config.physical_exam.chest.auscultation.finding).toBe('S4');
        expect(single.scenario.timeline).toHaveLength(1);
        const listed = (await (await get(studentToken, '/cases')).json()).cases.find((c) => c.id === caseId);
        expect(listed.config.initialVitals.hr).toBe(104);
        const { session } = await (await get(studentToken, `/sessions/${sessionId}`)).json();
        expect(JSON.parse(session.case_snapshot).config.voice.case_voice).toBe('am_michael');
    });

    it('as an educator, the same endpoints still return the whole case', async () => {
        const single = await (await get(educatorToken, `/cases/${caseId}`)).json();
        expect(single.name).toBe(TITLE);
        expect(single.config.diagnosis).toBe(DIAGNOSIS);
        expect(single.scenario.alternatives[0].name).toBe(ALTERNATIVE);
        const { session } = await (await get(educatorToken, `/sessions/${sessionId}`)).json();
        expect(session.case_name).toBe(TITLE);
    });

    it('case investigations are an authoring view', async () => {
        expect((await get(studentToken, `/cases/${caseId}/investigations`)).status).toBe(403);
        const res = await get(educatorToken, `/cases/${caseId}/investigations`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(INVESTIGATION_VALUE);
    });
});
