// Integration tests for the ported lessons + surveys routes (/api/courses/*,
// /api/surveys/*). Spawns the real server, seeds users + a cohort, then drives
// the lesson/section/survey lifecycle over HTTP.
//
// The load-bearing assertion is the OWNERSHIP BOUNDARY: a second educator who
// does not own (and is not a teacher-member of) a cohort must NOT be able to
// read or manage its lessons/surveys — this is the regression lock for the
// canManageOwnedResource blocker (any-educator-edits-anything) caught in review.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'LessonTests1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
async function seedUser(db, { username, role, tenant = 1 }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenant]
    );
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}
function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}
const json = (res) => res.json();

describe('lessons + surveys routes', () => {
    let server;
    let teacherA, teacherB, student, stranger;
    let cohortId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'les-teacher-a', role: 'educator' });
            await seedUser(db, { username: 'les-teacher-b', role: 'educator' });
            await seedUser(db, { username: 'les-student', role: 'student' });
            await seedUser(db, { username: 'les-stranger', role: 'student' });
        } finally {
            await closeDb(db);
        }
        teacherA = authedFetch(server.baseUrl, await login(server.baseUrl, 'les-teacher-a'));
        teacherB = authedFetch(server.baseUrl, await login(server.baseUrl, 'les-teacher-b'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'les-student'));
        stranger = authedFetch(server.baseUrl, await login(server.baseUrl, 'les-stranger'));

        // teacherA owns a cohort with les-student enrolled.
        const c = await json(await teacherA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Histology 101' }),
        }));
        cohortId = c.cohort.id;
        await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'les-student' }),
        });
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    let lessonId, sectionId;

    it('educator creates a lesson in their cohort', async () => {
        const res = await teacherA(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title: 'Epithelium' }),
        });
        expect(res.status).toBe(201);
        const body = await json(res);
        expect(body.success).toBe(true);
        expect(body.data.title).toBe('Epithelium');
        expect(body.data.isPublished).toBe(false);
        lessonId = body.data.id;
    });

    it('student (educator-rank required) cannot create a lesson', async () => {
        const res = await student(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title: 'Nope' }),
        });
        expect(res.status).toBe(403);
    });

    // ---- THE OWNERSHIP BOUNDARY (regression lock) --------------------------
    it('a different educator cannot create a lesson in someone else\'s cohort', async () => {
        const res = await teacherB(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title: 'Intruder' }),
        });
        expect(res.status).toBe(404); // 404 not 403 — no existence leak
    });

    it('a different educator cannot edit another teacher\'s lesson', async () => {
        const res = await teacherB(`/api/courses/lectures/${lessonId}`, {
            method: 'PUT', body: JSON.stringify({ title: 'Hijacked' }),
        });
        expect(res.status).toBe(404);
    });

    it('adds a section and autosaves its content (sanitized)', async () => {
        const created = await json(await teacherA(`/api/courses/lectures/${lessonId}/sections`, {
            method: 'POST', body: JSON.stringify({ type: 'text', title: 'Intro' }),
        }));
        expect(created.success).toBe(true);
        sectionId = created.data.id;
        // Autosave PUT with a script payload — must be stripped server-side.
        const saved = await json(await teacherA(`/api/courses/sections/${sectionId}`, {
            method: 'PUT',
            body: JSON.stringify({ content: '<p>hi</p><script>alert(1)</script>' }),
        }));
        expect(saved.data.content).toContain('<p>hi</p>');
        expect(saved.data.content).not.toContain('<script>');
    });

    it('unpublished lesson is hidden from an enrolled student', async () => {
        const res = await student(`/api/courses/modules/${cohortId}/lectures`);
        const body = await json(res);
        expect(body.data.find((l) => l.id === lessonId)).toBeUndefined();
    });

    it('publishes, then the student sees it and can mark complete', async () => {
        await teacherA(`/api/courses/lectures/${lessonId}`, {
            method: 'PUT', body: JSON.stringify({ isPublished: true }),
        });
        const list = await json(await student(`/api/courses/modules/${cohortId}/lectures`));
        expect(list.data.some((l) => l.id === lessonId)).toBe(true);

        const full = await json(await student(`/api/courses/lectures/${lessonId}`));
        expect(full.data.sections.length).toBe(1);

        const done = await json(await student(`/api/courses/lectures/${lessonId}/complete`, { method: 'POST' }));
        expect(done.data.isCompleted).toBe(true);
    });

    it('a non-member student cannot see the cohort\'s lessons', async () => {
        const res = await stranger(`/api/courses/modules/${cohortId}/lectures`);
        expect(res.status).toBe(404);
    });

    // ---- Surveys -----------------------------------------------------------
    let surveyId;
    it('builds a survey, refuses to publish empty, then publishes with a question', async () => {
        const s = await json(await teacherA('/api/surveys', {
            method: 'POST', body: JSON.stringify({ title: 'Feedback' }),
        }));
        surveyId = s.data.id;

        const emptyPub = await teacherA(`/api/surveys/${surveyId}/publish`, { method: 'POST' });
        expect(emptyPub.status).toBe(400);

        const q = await teacherA(`/api/surveys/${surveyId}/questions`, {
            method: 'POST',
            body: JSON.stringify({
                questionText: 'Clear?', questionType: 'single_choice',
                options: ['Yes', 'No'], isRequired: true,
            }),
        });
        expect(q.status).toBe(201);

        const pub = await teacherA(`/api/surveys/${surveyId}/publish`, { method: 'POST' });
        expect(pub.status).toBe(200);
    });

    it('another educator cannot edit the survey', async () => {
        const res = await teacherB(`/api/surveys/${surveyId}`, {
            method: 'PUT', body: JSON.stringify({ title: 'Stolen' }),
        });
        expect(res.status).toBe(404);
    });

    it('attaches to the cohort; student submits once, second submit dedupes', async () => {
        const att = await teacherA(`/api/surveys/module/${cohortId}`, {
            method: 'POST', body: JSON.stringify({ surveyId }),
        });
        expect(att.status).toBe(201);

        const qList = await json(await student(`/api/surveys/${surveyId}`));
        const qid = qList.data.questions[0].id;

        const submit = await student(`/api/surveys/${surveyId}/submit`, {
            method: 'POST',
            body: JSON.stringify({ classroomId: cohortId, answers: [{ questionId: qid, answerValue: 'Yes' }] }),
        });
        expect(submit.status).toBe(201);

        const dupe = await student(`/api/surveys/${surveyId}/submit`, {
            method: 'POST',
            body: JSON.stringify({ classroomId: cohortId, answers: [{ questionId: qid, answerValue: 'No' }] }),
        });
        expect(dupe.status).toBe(409);
    });

    // ---- SURVEY READ LEAK (regression lock) --------------------------------
    it('a non-member student cannot list or read a published survey of a foreign cohort', async () => {
        // stranger is not a member of the cohort the survey is attached to.
        const list = await json(await stranger('/api/surveys'));
        expect(list.data.find((s) => s.id === surveyId)).toBeUndefined();

        const detail = await stranger(`/api/surveys/${surveyId}`);
        expect(detail.status).toBe(404);
    });

    it('a non-member cannot submit standalone (no classroomId) to a foreign survey', async () => {
        const res = await stranger(`/api/surveys/${surveyId}/submit`, {
            method: 'POST', body: JSON.stringify({ answers: [] }),
        });
        expect(res.status).toBe(403);
    });

    it('an enrolled student still lists and reads the attached survey', async () => {
        const list = await json(await student('/api/surveys'));
        expect(list.data.some((s) => s.id === surveyId)).toBe(true);

        const detail = await student(`/api/surveys/${surveyId}`);
        expect(detail.status).toBe(200);
    });

    // ---- Sanitize ----------------------------------------------------------
    it('strips script/tags from question text and options', async () => {
        const q = await json(await teacherA(`/api/surveys/${surveyId}/questions`, {
            method: 'POST',
            body: JSON.stringify({
                questionText: 'Safe?<script>alert(1)</script>',
                questionType: 'single_choice',
                options: ['<b>Yes</b>', 'No<script>x()</script>'],
                isRequired: false,
            }),
        }));
        expect(q.data.questionText).toBe('Safe?');
        expect(q.data.options).toEqual(['Yes', 'No']);
    });

    // ---- Batch sections ----------------------------------------------------
    it('?include=sections returns lessons with their sections attached', async () => {
        const list = await json(await teacherA(`/api/courses/modules/${cohortId}/lectures?include=sections`));
        const lesson = list.data.find((l) => l.id === lessonId);
        expect(Array.isArray(lesson.sections)).toBe(true);
        expect(lesson.sections.length).toBe(1);
        expect(lesson.sections[0].id).toBe(sectionId);
        // default (no param) behavior unchanged — no sections key
        const plain = await json(await teacherA(`/api/courses/modules/${cohortId}/lectures`));
        expect(plain.data.find((l) => l.id === lessonId).sections).toBeUndefined();
    });

    // ---- for-case priority -------------------------------------------------
    it('for-case prefers the cohort the caller is ENROLLED in over a lower-id one they own', async () => {
        // teacherB owns cohortOwn (lower id) and is a live MEMBER of cohortMem
        // (higher id, owned by teacherA); the case sits in both. Enrollment
        // must win over ownership — the old code returned the lowest-id owned
        // cohort.
        const own = await json(await teacherB('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'For-case — owned' }),
        }));
        const cohortOwn = own.cohort.id;
        const mem = await json(await teacherA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'For-case — member' }),
        }));
        const cohortMem = mem.cohort.id;
        expect(cohortMem).toBeGreaterThan(cohortOwn);
        await teacherA(`/api/cohorts/${cohortMem}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'les-teacher-b' }),
        });

        const db = await openDb(server.dbPath);
        let caseId;
        try {
            const c = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('For-case test', 1)`);
            caseId = c.lastID;
            await pRun(db, `INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)`, [cohortOwn, caseId]);
            await pRun(db, `INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)`, [cohortMem, caseId]);
        } finally {
            await closeDb(db);
        }

        const resolved = await json(await teacherB(`/api/courses/for-case/${caseId}`));
        expect(resolved.data.cohortId).toBe(cohortMem); // enrolled beats owned/min(id)
    });

    it('instructor sees aggregated responses and CSV export', async () => {
        const resp = await json(await teacherA(`/api/surveys/${surveyId}/responses?moduleId=${cohortId}`));
        expect(resp.data.totalResponses).toBe(1);
        expect(resp.data.questions[0].optionCounts.Yes).toBe(1);
        // SurveyResponses.jsx contract: questionStats + raw responses.
        expect(resp.data.questionStats[0].totalResponses).toBe(1);
        expect(resp.data.responses).toHaveLength(1);
        expect(resp.data.responses[0].answers[0].question.questionText).toBeTruthy();
        expect(resp.data.responses[0].completedAt).toBeTruthy();

        // Manager list contract: _count present on /surveys?courseId=.
        const list = await json(await teacherA(`/api/surveys?courseId=${cohortId}`));
        const row = list.data.find((s) => s.id === surveyId);
        expect(row._count.questions).toBeGreaterThanOrEqual(1);
        expect(row._count.responses).toBe(1);

        const csv = await teacherA(`/api/surveys/${surveyId}/export`);
        expect(csv.status).toBe(200);
        expect(csv.headers.get('content-type')).toContain('text/csv');
        const text = await csv.text();
        expect(text.split('\n').length).toBeGreaterThanOrEqual(2);
    });
});
