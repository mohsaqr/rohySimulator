// PRV-61 — "The student cannot see the survey assigned to a course".
//
// Regression lock: PRV-61 — a case put in a teacher's course (POST /cohorts/:id/cases) stays in the Basic course too, its students are members of both, and GET /courses/for-case sent them to the lowest-id course — the Basic one — so the teacher's course surveys (and lessons) never reached them.
//
// The educator's real path, over HTTP: make a course, enrol a student, put the
// default case in it, build a survey from the course's Surveys tab (create →
// attach → question → publish). The student reaches course content only through
// the ACTIVE CASE's course (App.openCourseForCase → GET /courses/for-case → the
// lessons room → GET /surveys/module/:id), so that whole path is asserted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, seedUser, mintToken, authed, login } from '../utils/authHttp.js';

const SECRET = 'course-survey-visibility-secret';

describe('PRV-61: a survey attached to a course reaches its enrolled students', () => {
    let server, edu, stu, outsider, otherTenant;
    let defaultCaseId, basicCourseId, courseId, surveyId, questionId;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
    const courseOfCase = async (who) => (await json(await who(`/api/courses/for-case/${defaultCaseId}`))).body?.data;
    const courseSurveys = (who, id = courseId) => who(`/api/surveys/module/${id}`).then(json);
    const submit = (who) => who(`/api/surveys/${surveyId}/submit`, {
        method: 'POST', json: { classroomId: courseId, answers: [{ questionId, answerValue: 'good' }] },
    });

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET } });
        let eduId, otherTenantId;
        await withDb(async (db) => {
            eduId = await seedUser(db, { username: 'prv61_edu', role: 'educator' });
            await seedUser(db, { username: 'prv61_stu' });
            await seedUser(db, { username: 'prv61_out' });
            await run(db, "INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'prv61-t2', 'Tenant 2')");
            otherTenantId = await seedUser(db, { username: 'prv61_t2', tenantId: 2 });
            const basic = await get(db, 'SELECT id FROM cohorts WHERE tenant_id = 1 AND is_default = 1 AND deleted_at IS NULL');
            basicCourseId = basic.id;
            const link = await get(db,
                `SELECT cc.case_id FROM cohort_cases cc JOIN cases c ON c.id = cc.case_id
                  WHERE cc.cohort_id = ? AND cc.deleted_at IS NULL AND c.is_default = 1`, [basicCourseId]);
            defaultCaseId = link.case_id;
        });
        edu = authed(server.baseUrl, await mintToken(server.dbPath,
            { id: eduId, username: 'prv61_edu', role: 'educator', tenant_id: 1 }, SECRET));
        // Real logins: a student in no other course is put in the Basic course
        // at login, as on vprohy.
        stu = authed(server.baseUrl, await login(server.baseUrl, 'prv61_stu'));
        outsider = authed(server.baseUrl, await login(server.baseUrl, 'prv61_out'));
        otherTenant = authed(server.baseUrl, await mintToken(server.dbPath,
            { id: otherTenantId, username: 'prv61_t2', role: 'student', tenant_id: 2 }, SECRET));

        // The teacher's course, its student, the default case.
        const created = await json(await edu('/api/cohorts', { method: 'POST', json: { name: 'PRV61 course' } }));
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        courseId = created.body.cohort?.id ?? created.body.id;
        expect(Number.isInteger(courseId)).toBe(true);
        expect([200, 201]).toContain((await edu(`/api/cohorts/${courseId}/members`, {
            method: 'POST', json: { identifier: 'prv61_stu' },
        })).status);
        expect((await edu(`/api/cohorts/${courseId}/cases`, {
            method: 'POST', json: { case_ids: [defaultCaseId] },
        })).status).toBe(201);

        // The Surveys tab: create, attach to this course, one question.
        const survey = await json(await edu('/api/surveys', { method: 'POST', json: { title: 'End of course survey' } }));
        expect(survey.status).toBe(201);
        surveyId = survey.body.data.id;
        expect((await edu(`/api/surveys/module/${courseId}`, { method: 'POST', json: { surveyId } })).status).toBe(201);
        const q = await json(await edu(`/api/surveys/${surveyId}/questions`, {
            method: 'POST', json: { questionText: 'How was it?', questionType: 'free_text', isRequired: true },
        }));
        expect(q.status).toBe(201);
        questionId = q.body.data.id;
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('fixture: the case is in both courses and the student is a member of both', async () => {
        const rows = await withDb((db) => get(db,
            `SELECT (SELECT COUNT(*) FROM cohort_cases WHERE case_id = ? AND cohort_id IN (?, ?) AND deleted_at IS NULL) AS links,
                    (SELECT COUNT(*) FROM cohort_members cm JOIN users u ON u.id = cm.user_id
                      WHERE u.username = 'prv61_stu' AND cm.cohort_id IN (?, ?) AND cm.deleted_at IS NULL) AS memberships`,
            [defaultCaseId, basicCourseId, courseId, basicCourseId, courseId]));
        expect(rows).toEqual({ links: 2, memberships: 2 });
    });

    it('the case opens the teacher\'s course, not the Basic course', async () => {
        expect(await courseOfCase(stu)).toMatchObject({ cohortId: courseId, cohortName: 'PRV61 course' });
        // A student of the Basic course only still gets the Basic course.
        expect(await courseOfCase(outsider)).toMatchObject({ cohortId: basicCourseId });
    });

    it('a draft is the teacher\'s alone: not listed, read or answerable by the student', async () => {
        const list = await courseSurveys(stu);
        expect(list.status).toBe(200);
        expect(list.body.data.map((s) => s.surveyId)).not.toContain(surveyId);
        expect((await stu(`/api/surveys/${surveyId}`)).status).toBe(404);
        expect((await submit(stu)).status).toBe(404);
        // The teacher sees it, marked unpublished (the room's "Not published" badge).
        const mine = await courseSurveys(edu);
        expect(mine.body.data.find((s) => s.surveyId === surveyId)?.survey.isPublished).toBe(false);
    });

    it('once published, the student finds it in the case\'s course, opens it and answers it once', async () => {
        expect((await edu(`/api/surveys/${surveyId}/publish`, { method: 'POST' })).status).toBe(200);
        const { cohortId } = await courseOfCase(stu);
        const list = await courseSurveys(stu, cohortId);
        expect(list.status).toBe(200);
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0]).toMatchObject({ surveyId, completed: false, survey: { title: 'End of course survey', isPublished: true } });

        const read = await json(await stu(`/api/surveys/${surveyId}`));
        expect(read.status).toBe(200);
        expect(read.body.data.questions).toHaveLength(1);

        expect((await submit(stu)).status).toBe(201);
        expect((await submit(stu)).status).toBe(409);
        const mine = await json(await stu(`/api/surveys/${surveyId}/my-response?moduleId=${courseId}`));
        expect(mine.body.data.completed).toBe(true);
        expect((await courseSurveys(stu)).body.data[0]).toMatchObject({ surveyId, completed: true });
    });

    it('a student of another course or another tenant sees none of it and cannot answer', async () => {
        expect((await courseSurveys(outsider)).status).toBe(404);
        expect((await outsider(`/api/surveys/${surveyId}`)).status).toBe(404);
        const listed = await json(await outsider('/api/surveys'));
        expect(listed.body.data.map((s) => s.id)).not.toContain(surveyId);
        expect((await submit(outsider)).status).toBe(403);

        expect((await courseSurveys(otherTenant)).status).toBe(404);
        expect((await otherTenant(`/api/surveys/${surveyId}`)).status).toBe(404);
        expect((await submit(otherTenant)).status).toBe(404);
        expect(await courseOfCase(otherTenant)).toMatchObject({ cohortId: null });

        const stored = await withDb((db) => get(db, 'SELECT COUNT(*) AS n FROM survey_responses WHERE survey_id = ?', [surveyId]));
        expect(stored.n).toBe(1);
    });

    it('an anonymous course survey is marked answered in the listing too', async () => {
        const anon = await json(await edu('/api/surveys', { method: 'POST', json: { title: 'Anonymous one', isAnonymous: true } }));
        const anonId = anon.body.data.id;
        await edu(`/api/surveys/module/${courseId}`, { method: 'POST', json: { surveyId: anonId } });
        const q = await json(await edu(`/api/surveys/${anonId}/questions`, {
            method: 'POST', json: { questionText: 'Anything?', questionType: 'free_text', isRequired: true },
        }));
        await edu(`/api/surveys/${anonId}/publish`, { method: 'POST' });
        const entry = async () => (await courseSurveys(stu)).body.data.find((s) => s.surveyId === anonId);
        expect(await entry()).toMatchObject({ completed: false });
        expect((await stu(`/api/surveys/${anonId}/submit`, {
            method: 'POST', json: { classroomId: courseId, answers: [{ questionId: q.body.data.id, answerValue: 'no' }] },
        })).status).toBe(201);
        expect(await entry()).toMatchObject({ completed: true });
        // Still no user id on the row.
        const row = await withDb((db) => get(db, 'SELECT user_id FROM survey_responses WHERE survey_id = ?', [anonId]));
        expect(row.user_id).toBeNull();
    });
});
