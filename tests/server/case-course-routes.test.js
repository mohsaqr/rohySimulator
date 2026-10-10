// Course materials that open after the case, and case questionnaires
// (lessons.unlock_case_id + cases.config.courseGate / questionnaires).
//
// Drives the real server. The load-bearing locks:
// - a learner gets NO content of a lesson locked behind a case until that
//   case's gate is met (list, detail, sections, complete), and the gate needs
//   BOTH the minutes since the learner first started the case and every slide
//   opened;
// - a learner never receives a questionnaire's answer key before the attempt
//   that releases it, and cannot pick an attempt the server has not opened.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CourseGate1!';
const SECRET_BODY = 'Adenokarsinooman tunnusmerkit: kribriforminen rakenne';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
const closeDb = (db) => new Promise((r) => db.close(() => r()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const pGet = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

async function seedUser(db, { username, role }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]);
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

const SLIDES = [{ id: 'slide-a1', label: 'A1 — HE' }, { id: 'slide-b1', label: 'B1 — HE' }];
const QUESTIONNAIRES = [
    {
        id: 'prepost', title: 'Diagnoosi', timing: 'pre_post', graded: true,
        questions: [
            { id: 'origin', type: 'single', text: 'Alkuperä?', options: ['Paksusuoli', 'Keuhko'], correct: [0], feedback: 'CDX2 tukee suolistoperää.', required: true },
            { id: 'why', type: 'text', text: 'Perustele', required: false },
        ],
    },
    {
        id: 'reflect', title: 'Pohdinta', timing: 'during', graded: false,
        questions: [{ id: 'hard', type: 'text', text: 'Mikä oli vaikeinta?', required: true }],
    },
    {
        id: 'after', title: 'Jälkikysely', timing: 'after', graded: true,
        questions: [{ id: 'node', type: 'single', text: 'Imusolmuke?', options: ['Antrakoosi', 'Metastaasi'], correct: [0], required: true }],
    },
];

describe('course gate + case questionnaires', () => {
    let server;
    let dbPath;
    let teacher, otherTeacher, student, peer;
    let studentId, peerId;
    let caseId, cohortId, lockedLessonId, openLessonId;

    const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
    async function withDb(work) {
        const db = await openDb(dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    }
    const startSession = (userId, startedAt) => withDb(async (db) => (await pRun(db,
        'INSERT INTO sessions (case_id, user_id, tenant_id, start_time) VALUES (?, ?, 1, ?)',
        [caseId, userId, startedAt])).lastID);
    const openSlide = (userId, slideId) => withDb((db) => pRun(db,
        `INSERT INTO learning_events (user_id, case_id, tenant_id, verb, object_type, object_id)
         VALUES (?, ?, 1, 'OPENED_SLIDE', 'slide', ?)`,
        [userId, caseId, slideId]));
    const lessons = async (as) => (await (await as(`/api/courses/modules/${cohortId}/lectures?include=sections`)).json()).data;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        dbPath = server.dbPath;
        await withDb(async (db) => {
            await seedUser(db, { username: 'cg-teacher', role: 'educator' });
            await seedUser(db, { username: 'cg-other-teacher', role: 'educator' });
            await seedUser(db, { username: 'cg-student', role: 'student' });
            await seedUser(db, { username: 'cg-peer', role: 'student' });
            studentId = (await pGet(db, "SELECT id FROM users WHERE username = 'cg-student'")).id;
            peerId = (await pGet(db, "SELECT id FROM users WHERE username = 'cg-peer'")).id;
            // Inserted directly: a real pathology document is not the subject here,
            // only the slide ids the gate counts.
            caseId = (await pRun(db,
                `INSERT INTO cases (name, config, tenant_id, is_available) VALUES (?, ?, 1, 1)`,
                ['Gate case', JSON.stringify({
                    patient_name: 'Pentti',
                    courseGate: { afterMinutes: 15, allSlidesOpened: true },
                    questionnaires: QUESTIONNAIRES,
                    pathology: { manifest: { slides: SLIDES } },
                })])).lastID;
        });
        teacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'cg-teacher'));
        otherTeacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'cg-other-teacher'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'cg-student'));
        peer = authedFetch(server.baseUrl, await login(server.baseUrl, 'cg-peer'));

        cohortId = (await (await teacher('/api/cohorts', { method: 'POST', body: JSON.stringify({ name: 'Patologia' }) })).json()).cohort.id;
        for (const identifier of ['cg-student', 'cg-peer']) {
            await teacher(`/api/cohorts/${cohortId}/members`, { method: 'POST', body: JSON.stringify({ identifier }) });
        }
        expect((await teacher(`/api/cases/${caseId}/course`, { method: 'PUT', body: JSON.stringify({ cohortId }) })).status).toBe(200);
        const create = async (title, description) => (await (await teacher(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title, description, content: `<p>${SECRET_BODY}</p>`, isPublished: true }),
        })).json()).data.id;
        lockedLessonId = await create('Paksusuolen kasvaimet', 'Adenokarsinooma');
        openLessonId = await create('Johdanto', 'Kurssin esittely');
        await teacher(`/api/courses/lectures/${lockedLessonId}/sections`, {
            method: 'POST', body: JSON.stringify({ title: 'Osa 1', type: 'text', content: `<p>${SECRET_BODY}</p>` }),
        });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    describe('locking lessons from the case', () => {
        it('lists the case course lessons for its educator', async () => {
            const res = await teacher(`/api/cases/${caseId}/course-lessons`);
            expect(res.status).toBe(200);
            const body = (await res.json()).data;
            expect(body.cohortId).toBe(cohortId);
            expect(body.lessons.map((l) => [l.title, l.locked])).toEqual([['Paksusuolen kasvaimet', false], ['Johdanto', false]]);
        });

        it('refuses an educator who does not manage the course', async () => {
            expect((await otherTeacher(`/api/cases/${caseId}/course-locks`, {
                method: 'PUT', body: JSON.stringify({ lessonIds: [lockedLessonId] }),
            })).status).toBe(403);
        });

        it('refuses a lesson from another course', async () => {
            expect((await teacher(`/api/cases/${caseId}/course-locks`, {
                method: 'PUT', body: JSON.stringify({ lessonIds: [999999] }),
            })).status).toBe(404);
        });

        it('locks exactly the listed lessons', async () => {
            const res = await teacher(`/api/cases/${caseId}/course-locks`, {
                method: 'PUT', body: JSON.stringify({ lessonIds: [lockedLessonId] }),
            });
            expect(res.status).toBe(200);
            const body = (await (await teacher(`/api/cases/${caseId}/course-lessons`)).json()).data;
            expect(body.lessons.map((l) => [l.id, l.locked])).toEqual([[lockedLessonId, true], [openLessonId, false]]);
        });

        it('a learner who could not start the case could not open the case course side of another student', async () => {
            expect((await student('/api/cases/999999/course-state')).status).toBe(404);
        });
    });

    describe('a locked lesson, before the gate', () => {
        it('reaches the learner as a title and progress only', async () => {
            // Regression lock: the course materials explain the case's answer; a locked lesson must carry none of its content to the learner
            const list = await lessons(student);
            const locked = list.find((l) => l.id === lockedLessonId);
            expect(locked).toMatchObject({ title: 'Paksusuolen kasvaimet', locked: true, lock: { afterMinutes: 15, slidesTotal: 2, slidesOpened: 0 } });
            expect(JSON.stringify(locked)).not.toContain(SECRET_BODY);
            expect(locked).not.toHaveProperty('description');
            expect(locked).not.toHaveProperty('sections');
            expect(list.find((l) => l.id === openLessonId).sections).toEqual([]);
        });

        it('cannot be read, its sections listed, or marked complete', async () => {
            for (const [path, method] of [
                [`/api/courses/lectures/${lockedLessonId}`, 'GET'],
                [`/api/courses/lectures/${lockedLessonId}/sections`, 'GET'],
                [`/api/courses/lectures/${lockedLessonId}/complete`, 'POST'],
            ]) {
                const res = await student(path, { method });
                expect(res.status, path).toBe(403);
                const body = await res.json();
                expect(body.code).toBe('lesson_locked');
                expect(JSON.stringify(body)).not.toContain(SECRET_BODY);
            }
        });

        it('stays open to its educator', async () => {
            expect((await teacher(`/api/courses/lectures/${lockedLessonId}`)).status).toBe(200);
        });

        it('stays locked when the time is met but a slide is unopened', async () => {
            await startSession(studentId, minutesAgo(20));
            await openSlide(studentId, 'slide-a1');
            const locked = (await lessons(student)).find((l) => l.id === lockedLessonId);
            expect(locked.locked).toBe(true);
            expect(locked.lock).toMatchObject({ slidesOpened: 1, remainingSeconds: 0 });
        });

        it('stays locked for a learner who opened every slide but started only minutes ago', async () => {
            await startSession(peerId, minutesAgo(5));
            await openSlide(peerId, 'slide-a1');
            await openSlide(peerId, 'slide-b1');
            const locked = (await lessons(peer)).find((l) => l.id === lockedLessonId);
            expect(locked.locked).toBe(true);
            expect(locked.lock.remainingSeconds).toBeGreaterThan(9 * 60);
        });

        it('does not count a slide that is no longer in the case', async () => {
            await openSlide(studentId, 'slide-removed');
            expect((await lessons(student)).find((l) => l.id === lockedLessonId).lock.slidesOpened).toBe(1);
        });
    });

    describe('the questionnaires, before the gate', () => {
        it('reach the learner without the answer key, with the pre-test open', async () => {
            // Regression lock: correct options and feedback are the questionnaire's answer key; the learner's copy must not carry them
            const res = await student(`/api/cases/${caseId}/course-state`);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.gate).toMatchObject({ configured: true, unlocked: false });
            const text = JSON.stringify(body.questionnaires);
            expect(text).not.toContain('correct');
            expect(text).not.toContain('CDX2 tukee');
            expect(body.questionnaires.map((q) => [q.id, q.openAttempt])).toEqual([['prepost', 'pre'], ['reflect', 'single'], ['after', null]]);
        });

        it('are not in the case a learner reads', async () => {
            const res = await student(`/api/cases/${caseId}`);
            const text = JSON.stringify(await res.json());
            expect(text).not.toContain('questionnaires');
            expect(text).not.toContain('courseGate');
        });

        it('refuse an attempt the server has not opened', async () => {
            const res = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'post', answers: { origin: 0 } }),
            });
            expect(res.status).toBe(409);
            expect((await res.json())).toMatchObject({ code: 'attempt_closed', openAttempt: 'pre' });
            const after = await student(`/api/cases/${caseId}/questionnaires/after/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'single', answers: { node: 0 } }),
            });
            expect(after.status).toBe(409);
        });

        it('refuse malformed answers', async () => {
            const res = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'pre', answers: { origin: 7 } }),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('invalid_answers');
        });

        it('refuse a session that is not the learner own', async () => {
            const peerSession = await startSession(peerId, minutesAgo(1));
            const res = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'pre', answers: { origin: 1 }, sessionId: peerSession }),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('invalid_session');
        });

        it('take the pre-test once, and show neither its score nor its key', async () => {
            const res = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'pre', answers: { origin: 1, why: 'arvaus' } }),
            });
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body).toMatchObject({ attempt: 'pre', answers: { origin: 1, why: 'arvaus' } });
            expect(body).not.toHaveProperty('score');
            expect(body).not.toHaveProperty('key');
            const again = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'pre', answers: { origin: 0 } }),
            });
            expect(again.status).toBe(409);
            expect((await again.json()).code).toBe('already_submitted');
        });

        it('take an ungraded "during" questionnaire at any time', async () => {
            const res = await student(`/api/cases/${caseId}/questionnaires/reflect/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'single', answers: { hard: 'Imusolmukkeen pigmentti' } }),
            });
            expect(res.status).toBe(201);
            expect(await res.json()).not.toHaveProperty('score');
        });
    });

    describe('after the gate', () => {
        it('opens the lesson once every slide is opened', async () => {
            await openSlide(studentId, 'slide-b1');
            const lesson = (await lessons(student)).find((l) => l.id === lockedLessonId);
            expect(lesson.locked).toBeUndefined();
            expect(lesson.sections.map((s) => s.title)).toEqual(['Osa 1']);
            const detail = await student(`/api/courses/lectures/${lockedLessonId}`);
            expect(detail.status).toBe(200);
            expect(JSON.stringify(await detail.json())).toContain(SECRET_BODY);
            expect((await student(`/api/courses/lectures/${lockedLessonId}/complete`, { method: 'POST' })).status).toBe(200);
        });

        it('keeps it locked for the learner who has not met it', async () => {
            expect((await lessons(peer)).find((l) => l.id === lockedLessonId).locked).toBe(true);
        });

        it('closes the pre-test and opens the post-test', async () => {
            const body = await (await student(`/api/cases/${caseId}/course-state`)).json();
            expect(body.gate.unlocked).toBe(true);
            expect(body.questionnaires.map((q) => [q.id, q.openAttempt])).toEqual([['prepost', 'post'], ['reflect', null], ['after', 'single']]);
        });

        it('scores the post-test, releases its key, and then the pre-test score', async () => {
            const res = await student(`/api/cases/${caseId}/questionnaires/prepost/responses`, {
                method: 'POST', body: JSON.stringify({ attempt: 'post', answers: { origin: 0 } }),
            });
            expect(res.status).toBe(201);
            expect(await res.json()).toMatchObject({
                attempt: 'post', score: 1, maxScore: 1, results: { origin: true },
                key: { origin: { correct: [0], feedback: 'CDX2 tukee suolistoperää.' } },
            });
            const state = await (await student(`/api/cases/${caseId}/course-state`)).json();
            const attempts = state.questionnaires.find((q) => q.id === 'prepost').attempts;
            expect(attempts.map((a) => [a.attempt, a.score, a.maxScore])).toEqual([['pre', 0, 1], ['post', 1, 1]]);
            expect(attempts[0]).not.toHaveProperty('key');
        });

        it('lists every answer for the educator, with usernames and no names', async () => {
            const res = await teacher(`/api/cases/${caseId}/questionnaire-responses`);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.responses.map((r) => [r.questionnaireId, r.attempt, r.username, r.score]))
                .toEqual([['prepost', 'pre', 'cg-student', 0], ['prepost', 'post', 'cg-student', 1], ['reflect', 'single', 'cg-student', null]]);
            expect(JSON.stringify(body)).not.toContain('@example.com');
        });

        it('keeps the answers from the learners', async () => {
            expect((await student(`/api/cases/${caseId}/questionnaire-responses`)).status).toBe(403);
        });

        it('stops locking a lesson whose lock is cleared', async () => {
            await teacher(`/api/cases/${caseId}/course-locks`, { method: 'PUT', body: JSON.stringify({ lessonIds: [] }) });
            expect((await lessons(peer)).find((l) => l.id === lockedLessonId).locked).toBeUndefined();
        });
    });

    describe('saving a case', () => {
        const save = (config) => teacher('/api/cases', {
            method: 'POST', body: JSON.stringify({ name: 'Saved', config: { patient_name: 'P', ...config } }),
        });

        it('refuses a gate the server cannot read', async () => {
            const res = await save({ courseGate: { afterMinutes: 'fifteen' } });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('invalid_course_gate');
        });

        it('refuses a malformed questionnaire', async () => {
            const res = await save({ questionnaires: [{ id: 'q', title: 'T', timing: 'never', questions: [] }] });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('invalid_questionnaires');
        });

        it('stores a valid gate and questionnaires as normalised, and drops a gate at its defaults', async () => {
            const res = await save({
                courseGate: { afterMinutes: 10 },
                questionnaires: [{ id: 'q', title: ' T ', timing: 'during', questions: [{ id: 'a', type: 'text', text: 'Why?' }] }],
            });
            expect(res.status).toBe(200);
            const { id } = await res.json();
            const stored = await withDb((db) => pGet(db, 'SELECT config FROM cases WHERE id = ?', [id]));
            const config = JSON.parse(stored.config);
            expect(config.courseGate).toEqual({ afterMinutes: 10, allSlidesOpened: false });
            expect(config.questionnaires[0]).toMatchObject({ title: 'T', graded: false, questions: [{ required: true }] });
            const plain = await save({ courseGate: { afterMinutes: 0, allSlidesOpened: false } });
            const plainId = (await plain.json()).id;
            const plainStored = await withDb((db) => pGet(db, 'SELECT config FROM cases WHERE id = ?', [plainId]));
            expect(JSON.parse(plainStored.config)).not.toHaveProperty('courseGate');
        });
    });
});
