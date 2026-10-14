// A course survey only stores answers its author offered. FI-0010 review F11:
// an enrolled student submitted `answerValue: 'NOT AN OPTION'` to a published
// single-choice survey, got 201, and the educator's results then counted an
// extra "NOT AN OPTION" option. The route checked only that required
// questions were present.
//
// Two layers: the validator itself (server/lib/surveyAnswers.js), and the real
// route over HTTP, including what the educator's results show afterwards.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { validateSurveyAnswers, SURVEY_ANSWER_MAX_CHARS } from '../../server/lib/surveyAnswers.js';

const PASSWORD = 'SurveyValid1!';

const Q = {
    single: { id: 1, question_type: 'single_choice', options: JSON.stringify(['Kyllä', 'Ei']), is_required: 1 },
    multi: { id: 2, question_type: 'multiple_choice', options: JSON.stringify(['Chat', 'Labs', 'Monitor']), is_required: 0 },
    text: { id: 3, question_type: 'free_text', options: null, is_required: 0 },
};
const QUESTIONS = [Q.single, Q.multi, Q.text];

describe('validateSurveyAnswers', () => {
    it('accepts authored options and bounded text, and stores choice lists as JSON', () => {
        const { answers, problem } = validateSurveyAnswers(QUESTIONS, [
            { questionId: 1, answerValue: 'Kyllä' },
            { questionId: 2, answerValue: ['Labs', 'Chat'] },
            { questionId: 3, answerValue: '  Selkeä <b>kurssi</b> ' },
        ]);
        expect(problem).toBeUndefined();
        expect(answers).toEqual([
            { questionId: 1, value: 'Kyllä' },
            { questionId: 2, value: JSON.stringify(['Labs', 'Chat']) },
            { questionId: 3, value: 'Selkeä kurssi' },
        ]);
    });

    it.each([
        ['an unlisted single choice', [{ questionId: 1, answerValue: 'NOT AN OPTION' }], 'survey_answer_not_an_option'],
        ['a list for a single choice', [{ questionId: 1, answerValue: ['Kyllä'] }], 'survey_answer_invalid'],
        ['an unlisted option in a multiple choice', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 2, answerValue: ['Chat', 'Nope'] }], 'survey_answer_not_an_option'],
        ['a repeated option', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 2, answerValue: ['Chat', 'Chat'] }], 'survey_answer_duplicate'],
        ['a scalar for a multiple choice', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 2, answerValue: 'Chat' }], 'survey_answer_invalid'],
        ['a question answered twice', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 1, answerValue: 'Kyllä' }], 'survey_answer_duplicate'],
        ['text that is too long', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 3, answerValue: 'x'.repeat(SURVEY_ANSWER_MAX_CHARS + 1) }], 'survey_answer_too_long'],
        ['a number for a text question', [{ questionId: 1, answerValue: 'Ei' }, { questionId: 3, answerValue: 42 }], 'survey_answer_invalid'],
        ['a missing required answer', [{ questionId: 2, answerValue: ['Chat'] }], 'survey_answer_required'],
        ['answers that are not a list', { 1: 'Kyllä' }, 'survey_answers_malformed'],
        ['an answer that is not an object', ['Kyllä'], 'survey_answers_malformed'],
    ])('refuses %s', (_label, raw, code) => {
        const { answers, problem } = validateSurveyAnswers(QUESTIONS, raw);
        expect(problem?.code).toBe(code);
        expect(answers).toEqual([]);
    });

    it('drops empty optional answers and ignores a question not in the survey', () => {
        const { answers, problem } = validateSurveyAnswers(QUESTIONS, [
            { questionId: 1, answerValue: 'Ei' },
            { questionId: 2, answerValue: [] },
            { questionId: 3, answerValue: '   ' },
            { questionId: 999, answerValue: 'anything' },
        ]);
        expect(problem).toBeUndefined();
        expect(answers).toEqual([{ questionId: 1, value: 'Ei' }]);
    });

    it('is independent of answer order (property)', () => {
        const given = [
            { questionId: 3, answerValue: 'ok' },
            { questionId: 2, answerValue: ['Monitor'] },
            { questionId: 1, answerValue: 'Kyllä' },
        ];
        const a = validateSurveyAnswers(QUESTIONS, given).answers;
        const b = validateSurveyAnswers(QUESTIONS, [...given].reverse()).answers;
        const byId = (x, y) => x.questionId - y.questionId;
        expect([...a].sort(byId)).toEqual([...b].sort(byId));
    });
});

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
const closeDb = (db) => new Promise((r) => db.close(() => r()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));

async function seedUser(db, username, role) {
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

describe('POST /api/surveys/:id/submit validates answers', () => {
    let server, teacher, student;
    let cohortId, surveyId, singleId, multiId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, 'sv-teacher', 'educator');
            await seedUser(db, 'sv-student', 'student');
        } finally {
            await closeDb(db);
        }
        teacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'sv-teacher'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'sv-student'));

        cohortId = (await (await teacher('/api/cohorts', { method: 'POST', body: JSON.stringify({ name: 'Kurssi' }) })).json()).cohort.id;
        await teacher(`/api/cohorts/${cohortId}/members`, { method: 'POST', body: JSON.stringify({ identifier: 'sv-student' }) });
        surveyId = (await (await teacher('/api/surveys', { method: 'POST', body: JSON.stringify({ title: 'Palaute' }) })).json()).data.id;
        const addQ = async (body) => (await (await teacher(`/api/surveys/${surveyId}/questions`, {
            method: 'POST', body: JSON.stringify(body),
        })).json()).data.id;
        singleId = await addQ({ questionText: 'Oliko selkeä?', questionType: 'single_choice', options: ['Kyllä', 'Ei'], isRequired: true });
        multiId = await addQ({ questionText: 'Mitä käytit?', questionType: 'multiple_choice', options: ['Chat', 'Labs'], isRequired: false });
        expect((await teacher(`/api/surveys/${surveyId}/publish`, { method: 'POST' })).status).toBe(200);
        expect((await teacher(`/api/surveys/module/${cohortId}`, { method: 'POST', body: JSON.stringify({ surveyId }) })).status).toBe(201);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const submit = (answers) => student(`/api/surveys/${surveyId}/submit`, {
        method: 'POST', body: JSON.stringify({ classroomId: cohortId, answers }),
    });

    it('refuses an answer that is not one of the options, with a code', async () => {
        // Regression lock: an unlisted single-choice answer was stored (201) and counted as an extra option in the results (FI-0010 F11)
        const res = await submit([{ questionId: singleId, answerValue: 'NOT AN OPTION' }]);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('survey_answer_not_an_option');
        expect(typeof body.error).toBe('string');
    });

    it('refuses a repeated or unlisted multiple-choice option', async () => {
        const dup = await submit([{ questionId: singleId, answerValue: 'Kyllä' }, { questionId: multiId, answerValue: ['Chat', 'Chat'] }]);
        expect(dup.status).toBe(400);
        expect((await dup.json()).code).toBe('survey_answer_duplicate');
        const bad = await submit([{ questionId: singleId, answerValue: 'Kyllä' }, { questionId: multiId, answerValue: ['Chat', 'Pizza'] }]);
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('survey_answer_not_an_option');
    });

    it('keeps the required-answer refusal, now with a code', async () => {
        const res = await submit([{ questionId: multiId, answerValue: ['Chat'] }]);
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('survey_answer_required');
    });

    it('accepts authored answers, and the results count only authored options', async () => {
        const ok = await submit([{ questionId: singleId, answerValue: 'Kyllä' }, { questionId: multiId, answerValue: ['Labs'] }]);
        expect(ok.status).toBe(201);
        const results = (await (await teacher(`/api/surveys/${surveyId}/responses?moduleId=${cohortId}`)).json()).data;
        const json = JSON.stringify(results);
        expect(json).not.toContain('NOT AN OPTION');
        expect(json).not.toContain('Pizza');
        const single = results.questions.find((q) => q.questionId === singleId);
        expect(single.optionCounts).toEqual({ Kyllä: 1, Ei: 0 });
    });
});
