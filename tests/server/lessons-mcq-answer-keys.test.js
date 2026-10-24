// Regression lock: lesson MCQ answer keys reached students in the <lecture-mcq data-questions> attribute
//
// The section HTML was served verbatim, so every `correctIndex` and
// `explanation` of a self-check sat in the learner's browser before they
// answered. A learner's copy is now scrubbed server-side and grading moved to
// POST /courses/lectures/:id/mcq/check; the educator keeps the full attribute.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, login } from '../utils/authHttp.js';

function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}
const json = (res) => res.json();
const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const QUESTIONS = [
    { question: 'Which layer is avascular? (a > b & "c")', options: ['Epidermis', 'Dermis', 'Hypodermis'], correctIndex: 0, explanation: 'SECRET-EXPLANATION-ONE' },
    { question: 'Second?', options: ['No', 'Yes'], correctIndex: 1, explanation: 'SECRET-EXPLANATION-TWO' },
];
const LEGACY = { question: 'Legacy?', options: ['A', 'B', 'C'], correctIndex: 2, explanation: 'SECRET-LEGACY' };

const SECTION_HTML =
    '<p>Intro</p>'
    + `<lecture-mcq data-questions="${attr(JSON.stringify(QUESTIONS))}"></lecture-mcq>`
    + '<p>Between</p>'
    + `<lecture-mcq data-question="${attr(LEGACY.question)}" data-options="${attr(JSON.stringify(LEGACY.options))}" data-correct="2" data-explanation="${LEGACY.explanation}"></lecture-mcq>`;

describe('lesson self-check answer keys', () => {
    let server, teacher, student, outsider;
    let lessonId, sectionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'mcq-teacher', role: 'educator' });
            await seedUser(db, { username: 'mcq-student', role: 'student' });
            await seedUser(db, { username: 'mcq-outsider', role: 'student' });
        } finally {
            await closeDb(db);
        }
        teacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'mcq-teacher'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'mcq-student'));
        outsider = authedFetch(server.baseUrl, await login(server.baseUrl, 'mcq-outsider'));

        const cohort = await json(await teacher('/api/cohorts', { method: 'POST', body: JSON.stringify({ name: 'MCQ course' }) }));
        const cohortId = cohort.cohort.id;
        await teacher(`/api/cohorts/${cohortId}/members`, { method: 'POST', body: JSON.stringify({ identifier: 'mcq-student' }) });
        lessonId = (await json(await teacher(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title: 'Skin' }),
        }))).data.id;
        sectionId = (await json(await teacher(`/api/courses/lectures/${lessonId}/sections`, {
            method: 'POST', body: JSON.stringify({ type: 'text', title: 'Check yourself' }),
        }))).data.id;
        const saved = await teacher(`/api/courses/sections/${sectionId}`, { method: 'PUT', body: JSON.stringify({ content: SECTION_HTML }) });
        expect(saved.status).toBe(200);
        await teacher(`/api/courses/lectures/${lessonId}`, { method: 'PUT', body: JSON.stringify({ isPublished: true }) });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const check = (as, body) => as(`/api/courses/lectures/${lessonId}/mcq/check`, { method: 'POST', body: JSON.stringify({ sectionId, ...body }) });

    it('the educator still gets the whole attribute', async () => {
        const body = await json(await teacher(`/api/courses/lectures/${lessonId}`));
        const html = body.data.sections[0].content;
        expect(html).toContain('SECRET-EXPLANATION-ONE');
        expect(html).toContain('correctIndex');
        expect(html).toContain('SECRET-LEGACY');
    });

    it('a student\'s copy has no correctIndex and no explanation, on every read path', async () => {
        const detail = await json(await student(`/api/courses/lectures/${lessonId}`));
        const list = await json(await student(`/api/courses/lectures/${lessonId}/sections`));
        const module = await json(await student(`/api/courses/modules/${detail.data.cohortId}/lectures?include=sections`));
        const htmls = [
            detail.data.sections[0].content,
            list.data[0].content,
            module.data.find((l) => l.id === lessonId).sections[0].content,
        ];
        htmls.forEach((html) => {
            expect(html).not.toContain('correctIndex');
            expect(html).not.toMatch(/SECRET/);
            expect(html).not.toContain('data-correct');
            expect(html).not.toContain('data-explanation');
            // The questions and options are still there, and the rest of the HTML untouched.
            expect(html).toContain('<p>Intro</p>');
            expect(html).toContain('<p>Between</p>');
        });
        // The attribute is still valid, entity-escaped JSON the editor can parse.
        const blocks = [...htmls[0].matchAll(/data-questions="([^"]*)"/g)].map((m) => JSON.parse(m[1]
            .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')));
        expect(blocks).toEqual([
            QUESTIONS.map(({ question, options }) => ({ question, options })),
            [{ question: LEGACY.question, options: LEGACY.options }],
        ]);
    });

    it('grades an answer through the check route', async () => {
        const right = await check(student, { blockIndex: 0, questionIndex: 1, answerIndex: 1 });
        expect(right.status).toBe(200);
        expect((await json(right)).data).toEqual({ correct: true, correctIndex: 1, explanation: 'SECRET-EXPLANATION-TWO' });
        const wrong = await json(await check(student, { questionIndex: 0, answerIndex: 2 }));
        expect(wrong.data).toEqual({ correct: false, correctIndex: 0, explanation: 'SECRET-EXPLANATION-ONE' });
        const legacy = await json(await check(student, { blockIndex: 1, questionIndex: 0, answerIndex: 2 }));
        expect(legacy.data).toEqual({ correct: true, correctIndex: 2, explanation: 'SECRET-LEGACY' });
    });

    it('refuses bad indices, a missing question, and a reader without access', async () => {
        expect((await check(student, { questionIndex: -1, answerIndex: 0 })).status).toBe(400);
        expect((await check(student, { questionIndex: 0, answerIndex: 9 })).status).toBe(400);
        expect((await check(student, { blockIndex: 5, questionIndex: 0, answerIndex: 0 })).status).toBe(404);
        expect((await check(student, { sectionId: sectionId + 999, questionIndex: 0, answerIndex: 0 })).status).toBe(404);
        expect((await check(outsider, { questionIndex: 0, answerIndex: 0 })).status).toBe(404);
        expect((await fetch(`${server.baseUrl}/api/courses/lectures/${lessonId}/mcq/check`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })).status).toBe(401);
    });
});
