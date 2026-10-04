// Regression lock: a learner reading their own analytics (learning events, moments, turns, case insights, the CSV export) and Oyon records received the case's authoring title, which often names the diagnosis; below reviewer every title field now carries the case code (2026-10-04)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { withLearnerCaseLabels } from '../../server/services/caseProjection.js';

const PASSWORD = 'TitleTests1!';
const TITLE = 'TITLE-Anterior-STEMI-LAD';

describe('withLearnerCaseLabels (unit)', () => {
    const db = { all: async () => [{ id: 7, case_code: 'EN-0007' }] };
    it('relabels every title key, at any depth, from the row case id', async () => {
        const out = await withLearnerCaseLabels({
            a: [{ case_id: 7, case_name: TITLE, case_title: TITLE }],
            b: { nested: { caseId: 7, caseTitle: TITLE } },
            c: { case_title_snapshot: TITLE },
        }, 'student', 1, db);
        expect(JSON.stringify(out)).not.toContain(TITLE);
        expect(out.a[0]).toEqual({ case_id: 7, case_name: 'EN-0007', case_title: 'EN-0007' });
        expect(out.b.nested.caseTitle).toBe('EN-0007');
        expect(out.c.case_title_snapshot).toBeNull();
    });
    it('leaves a reviewer and above untouched, without a query', async () => {
        const payload = { a: [{ case_id: 7, case_name: TITLE }] };
        const noDb = { all: async () => { throw new Error('queried'); } };
        expect(await withLearnerCaseLabels(payload, 'reviewer', 1, noDb)).toBe(payload);
        expect(await withLearnerCaseLabels(payload, 'admin', 1, noDb)).toBe(payload);
    });
});

let server; let studentToken; let educatorToken; let caseId; let caseCode; let sessionId;
const pRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));

beforeAll(async () => {
    // Oyon on, so /addons/oyon/student/me is exercised rather than answering
    // 503 (add-on off) — CI's unit job has no OYON_ENABLED in its environment.
    server = await startTestServer({ env: { OYON_ENABLED: '1' } });
    const db = await new Promise((resolve, reject) => { const d = new (sqlite3.verbose().Database)(server.dbPath, (e) => (e ? reject(e) : resolve(d))); });
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const student = (await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('title-student', 'S', 'ts@example.com', ?, 'student', 1, 'active')`, [hash])).lastID;
        await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('title-educator', 'E', 'te@example.com', ?, 'educator', 1, 'active')`, [hash]);
        caseId = (await pRun(db, `INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES (?, 'p', '{}', 1)`, [TITLE])).lastID;
        caseCode = `EN-${String(caseId).padStart(4, '0')}`;
        await pRun(db, 'UPDATE cases SET case_code = ? WHERE id = ?', [caseCode, caseId]);
        sessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S', 'active', 1)`, [caseId, student])).lastID;
        await pRun(db, `INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, object_name, tenant_id) VALUES (?, ?, ?, 'EXAMINED', 'body_region', 'chest', 1)`, [sessionId, student, caseId]);
        await pRun(db, `INSERT INTO oyon_emotion_records (tenant_id, user_id, session_id, case_id, case_title_snapshot, window_start, window_end, capture_mode, consent_version, student_can_view)
                        VALUES (1, ?, ?, ?, ?, '2026-10-04T10:00:00Z', '2026-10-04T10:00:05Z', 'local-browser', 'v3', 1)`, [String(student), String(sessionId), caseId, TITLE]);
    } finally { await new Promise((r) => db.close(r)); }
    const login = async (username) => (await (await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }),
    })).json()).token;
    studentToken = await login('title-student');
    educatorToken = await login('title-educator');
}, 90_000);
afterAll(async () => { await server?.close(); });

const get = (token, path) => fetch(`${server.baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
const LEARNER_PATHS = () => [
    '/learning-events/all',
    '/learning-events/moments',
    `/chat-log/turns?session_id=${sessionId}`,
    `/analytics/case-insights?case_id=${caseId}`,
    '/export/learning-events',
    '/addons/oyon/student/me',
];

describe('a learner reading their own analytics never receives the case title', () => {
    it('every route answers without the title', async () => {
        for (const path of LEARNER_PATHS()) {
            const res = await get(studentToken, path);
            const text = await res.text();
            if (res.status !== 200) {
                // A route the student may not reach at all leaks nothing either.
                expect([403, 404], `${path} ${res.status}`).toContain(res.status);
            }
            expect(text, path).not.toContain(TITLE);
        }
    });

    it('the events and the export carry the case code instead', async () => {
        const { events, sessions } = await (await get(studentToken, '/learning-events/all')).json();
        expect(events.find((e) => e.case_id === caseId).case_name).toBe(caseCode);
        expect(sessions.find((s) => s.id === sessionId).case_name).toBe(caseCode);
        expect(await (await get(studentToken, '/export/learning-events')).text()).toContain(caseCode);
        const ownRes = await get(studentToken, '/addons/oyon/student/me');
        expect(ownRes.status).toBe(200);
        const own = await ownRes.json();
        expect(own.records.length).toBeGreaterThan(0);
        expect(own.records.every((r) => r.case_title_snapshot === caseCode)).toBe(true);
    });

    it('an educator still sees the title', async () => {
        const { events } = await (await get(educatorToken, '/learning-events/all')).json();
        expect(events.find((e) => e.case_id === caseId).case_name).toBe(TITLE);
    });
});
