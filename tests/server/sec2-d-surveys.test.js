// Security fix pass 2026-10-26, lane D — survey submissions.
//
// Regression lock: a non-anonymous submit was check-then-insert on the shared handle with no unique index, so concurrent submits all landed; an anonymous survey accepted unlimited submissions from one person (F-37 / F-39 / L8-16).
// Regression lock: anonymous responses carried a to-the-second completion time an author could match against activity they can read (L7-15).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, all, seedUser, mintToken } from '../utils/authHttp.js';

const SECRET = 'sec2-d-surveys-secret';

describe('survey submissions (lane D)', () => {
    let server, stuId, eduId, stuTok, eduTok, cohortId, namedSurvey, anonSurvey, questionOf;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const submit = (surveyId, tok = stuTok) => fetch(`${server.baseUrl}/api/surveys/${surveyId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ classroomId: cohortId, answers: [{ questionId: questionOf[surveyId], answerValue: 'fine' }] }),
    });
    const responses = (surveyId) => withDb((db) => all(db, 'SELECT * FROM survey_responses WHERE survey_id = ?', [surveyId]));

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET } });
        questionOf = {};
        await withDb(async (db) => {
            stuId = await seedUser(db, { username: 'd_sv_stu' });
            eduId = await seedUser(db, { username: 'd_sv_edu', role: 'educator' });
            cohortId = (await run(db, `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('SV', ?, 1)`, [eduId])).lastID;
            await run(db, 'INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)', [cohortId, stuId]);
            for (const anon of [0, 1]) {
                const id = (await run(db, `INSERT INTO surveys (title, created_by_id, is_published, is_anonymous, tenant_id) VALUES (?, ?, 1, ?, 1)`,
                    [anon ? 'Anon' : 'Named', eduId, anon])).lastID;
                questionOf[id] = (await run(db, `INSERT INTO survey_questions (survey_id, question_text, question_type, is_required) VALUES (?, 'How?', 'free_text', 1)`, [id])).lastID;
                await run(db, 'INSERT INTO cohort_surveys (cohort_id, survey_id) VALUES (?, ?)', [cohortId, id]);
                if (anon) anonSurvey = id; else namedSurvey = id;
            }
        });
        stuTok = await mintToken(server.dbPath, { id: stuId, username: 'd_sv_stu', role: 'student', tenant_id: 1 }, SECRET);
        eduTok = await mintToken(server.dbPath, { id: eduId, username: 'd_sv_edu', role: 'educator', tenant_id: 1 }, SECRET);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('concurrent submits of a named survey store exactly one response', async () => {
        const results = await Promise.all(Array.from({ length: 6 }, () => submit(namedSurvey)));
        const statuses = results.map((r) => r.status).sort();
        const bodies = await Promise.all(results.map((r) => r.text()));
        expect(statuses.every((s) => s === 201 || s === 409), JSON.stringify(bodies)).toBe(true);
        expect(statuses.filter((s) => s === 201).length).toBe(1);
        expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
        const rows = await responses(namedSurvey);
        expect(rows.length).toBe(1);
        expect(rows[0].dedupe_key).toBe(`u:${stuId}:c:${cohortId}`);
        const answers = await withDb((db) => get(db, 'SELECT COUNT(*) AS n FROM survey_answers WHERE response_id = ?', [rows[0].id]));
        expect(answers.n).toBe(1);
    });

    it('one person cannot submit an anonymous survey twice, and the row carries no user id', async () => {
        expect((await submit(anonSurvey)).status).toBe(201);
        expect((await submit(anonSurvey)).status).toBe(409);
        const rows = await responses(anonSurvey);
        expect(rows.length).toBe(1);
        expect(rows[0].user_id).toBeNull();
        expect(rows[0].dedupe_key).toMatch(/^a:[0-9a-f]{40}$/);
        expect(rows[0].dedupe_key.startsWith('u:')).toBe(false);
    });

    it('an anonymous response is stamped to the hour, and so shown', async () => {
        const [row] = await responses(anonSurvey);
        expect(row.completed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00:00$/);
        const res = await fetch(`${server.baseUrl}/api/surveys/${anonSurvey}/responses`, { headers: { authorization: `Bearer ${eduTok}` } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.responses[0].completedAt).toMatch(/:00:00$/);
        expect(body.data.responses[0].user).toBeNull();
    });

    it('my-response knows an anonymous survey was answered', async () => {
        const res = await fetch(`${server.baseUrl}/api/surveys/${anonSurvey}/my-response?moduleId=${cohortId}`, { headers: { authorization: `Bearer ${stuTok}` } });
        expect((await res.json()).data.completed).toBe(true);
    });
});
