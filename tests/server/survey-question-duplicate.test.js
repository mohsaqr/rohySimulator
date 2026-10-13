// POST /api/surveys/:id/questions/:questionId/duplicate — an educator building
// a 10-question perception survey asked for "duplicate question" so a Likert
// item need not be retyped option by option. The copy must land directly after
// its original, carry the same text/type/options/required flag, and the rest
// of the survey must shift down. Spawns the real server.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'SurveyDup1!';

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

const AGREE = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

describe('POST /api/surveys/:id/questions/:questionId/duplicate', () => {
    let server;
    let owner, otherEducator, student, foreignAdmin;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await pRun(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'dup-t2', 'Survey dup tenant 2')`);
            await seedUser(db, { username: 'dup-owner', role: 'educator' });
            await seedUser(db, { username: 'dup-other', role: 'educator' });
            await seedUser(db, { username: 'dup-student', role: 'student' });
            await seedUser(db, { username: 'dup-admin-t2', role: 'admin', tenant: 2 });
        } finally {
            await closeDb(db);
        }
        owner = authedFetch(server.baseUrl, await login(server.baseUrl, 'dup-owner'));
        otherEducator = authedFetch(server.baseUrl, await login(server.baseUrl, 'dup-other'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'dup-student'));
        foreignAdmin = authedFetch(server.baseUrl, await login(server.baseUrl, 'dup-admin-t2'));
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    // A survey with questions A (Likert), B (free text), C (multiple choice).
    async function buildSurvey(title) {
        const s = await (await owner('/api/surveys', {
            method: 'POST', body: JSON.stringify({ title }),
        })).json();
        const surveyId = s.data.id;
        const add = async (body) => (await (await owner(`/api/surveys/${surveyId}/questions`, {
            method: 'POST', body: JSON.stringify(body),
        })).json()).data;
        const a = await add({ questionText: 'The case felt realistic', questionType: 'single_choice', options: AGREE, isRequired: false });
        const b = await add({ questionText: 'What would you change?', questionType: 'free_text' });
        const c = await add({ questionText: 'Which rooms did you use?', questionType: 'multiple_choice', options: ['Chat', 'Lab'] });
        return { surveyId, a, b, c };
    }
    const listQuestions = async (surveyId) =>
        (await (await owner(`/api/surveys/${surveyId}`)).json()).data.questions;
    const duplicate = (as, surveyId, questionId) =>
        as(`/api/surveys/${surveyId}/questions/${questionId}/duplicate`, { method: 'POST' });

    it('places the copy directly after the original and shifts the rest', async () => {
        const { surveyId, a, b, c } = await buildSurvey('Perception');
        const res = await duplicate(owner, surveyId, a.id);
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        const copy = body.data;
        expect(copy.id).not.toBe(a.id);

        const questions = await listQuestions(surveyId);
        expect(questions.map((q) => q.id)).toEqual([a.id, copy.id, b.id, c.id]);
        expect(questions.map((q) => q.orderIndex)).toEqual([0, 1, 2, 3]);
        expect(copy.orderIndex).toBe(1);
    });

    it('copies text, type, options and the required flag', async () => {
        const { surveyId, a, c } = await buildSurvey('Copy fields');
        const likert = (await (await duplicate(owner, surveyId, a.id)).json()).data;
        expect(likert).toMatchObject({
            surveyId,
            questionText: 'The case felt realistic',
            questionType: 'single_choice',
            options: AGREE,
            isRequired: false,
        });
        const multi = (await (await duplicate(owner, surveyId, c.id)).json()).data;
        expect(multi).toMatchObject({
            questionText: 'Which rooms did you use?',
            questionType: 'multiple_choice',
            options: ['Chat', 'Lab'],
            isRequired: true,
        });
        // Duplicating the LAST question appends it.
        const ids = (await listQuestions(surveyId)).map((q) => q.id);
        expect(ids.at(-1)).toBe(multi.id);
        expect(ids.at(-2)).toBe(c.id);
    });

    it('keeps the copy next to its original when order_index values are tied', async () => {
        // Adding with an explicit orderIndex can leave two questions on the
        // same index; ordering then falls back to id.
        const s = await (await owner('/api/surveys', { method: 'POST', body: JSON.stringify({ title: 'Ties' }) })).json();
        const surveyId = s.data.id;
        const add = async (questionText) => (await (await owner(`/api/surveys/${surveyId}/questions`, {
            method: 'POST', body: JSON.stringify({ questionText, questionType: 'free_text', orderIndex: 0 }),
        })).json()).data;
        const first = await add('First');
        const second = await add('Second');
        const copy = (await (await duplicate(owner, surveyId, first.id)).json()).data;
        expect((await listQuestions(surveyId)).map((q) => q.id)).toEqual([first.id, copy.id, second.id]);
    });

    it('a student is refused by the educator guard', async () => {
        const { surveyId, a } = await buildSurvey('Student refusal');
        expect((await duplicate(student, surveyId, a.id)).status).toBe(403);
        expect((await listQuestions(surveyId))).toHaveLength(3);
    });

    it('another educator who does not own the survey gets 404', async () => {
        const { surveyId, a } = await buildSurvey('Other educator');
        const res = await duplicate(otherEducator, surveyId, a.id);
        expect(res.status).toBe(404);
        expect((await listQuestions(surveyId))).toHaveLength(3);
    });

    it('an admin of another tenant gets 404', async () => {
        const { surveyId, a } = await buildSurvey('Other tenant');
        expect((await duplicate(foreignAdmin, surveyId, a.id)).status).toBe(404);
        expect((await listQuestions(surveyId))).toHaveLength(3);
    });

    it('404 for a question of another survey or a deleted question', async () => {
        const one = await buildSurvey('One');
        const two = await buildSurvey('Two');
        expect((await duplicate(owner, one.surveyId, two.a.id)).status).toBe(404);
        await owner(`/api/surveys/${one.surveyId}/questions/${one.b.id}`, { method: 'DELETE' });
        expect((await duplicate(owner, one.surveyId, one.b.id)).status).toBe(404);
    });

    it('like adding a question, works on a published survey that already has responses', async () => {
        const { surveyId, a, b, c } = await buildSurvey('Answered');
        expect((await owner(`/api/surveys/${surveyId}/publish`, { method: 'POST' })).status).toBe(200);
        // The owner may respond to their own survey standalone.
        const submit = await owner(`/api/surveys/${surveyId}/submit`, {
            method: 'POST',
            body: JSON.stringify({
                answers: [
                    { questionId: a.id, answerValue: 'Agree' },
                    { questionId: b.id, answerValue: 'More time' },
                    { questionId: c.id, answerValue: ['Chat'] },
                ],
            }),
        });
        expect(submit.status).toBe(201);
        // The rule add-question follows: no lock once published / answered.
        const added = await owner(`/api/surveys/${surveyId}/questions`, {
            method: 'POST', body: JSON.stringify({ questionText: 'Extra', questionType: 'free_text' }),
        });
        expect(added.status).toBe(201);
        const res = await duplicate(owner, surveyId, b.id);
        expect(res.status).toBe(201);
        const copy = (await res.json()).data;
        expect((await listQuestions(surveyId)).map((q) => q.id))
            .toEqual([a.id, b.id, copy.id, c.id, (await added.json()).data.id]);
        // Existing responses are untouched.
        const stats = (await (await owner(`/api/surveys/${surveyId}/responses`)).json()).data;
        expect(stats.totalResponses).toBe(1);
    });
});
