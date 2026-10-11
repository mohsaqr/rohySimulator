// Files of a lesson locked behind a case are held back like the lesson.
//
// Uploads are served from /uploads without a sign-in. A file attached to a
// locked lesson (often the material that explains the case) could therefore be
// opened by anyone who had its address before doing the case. lessonFileGuard
// serves such a file only to a signed-in reader for whom one of the lessons
// using it is open; every other upload is served as before.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'LessonFile1!';
const UPLOADS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads');
const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const FILES = {
    locked: `${stamp}-answer.pdf`,
    shared: `${stamp}-shared.png`,
    loose: `${stamp}-loose.png`,
};

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
        const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

describe('files of a lesson locked behind a case', () => {
    let server;
    let teacher, student, outsider, anonymous;
    let studentId, caseId;

    async function withDb(work) {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    }

    beforeAll(async () => {
        mkdirSync(UPLOADS, { recursive: true });
        for (const name of Object.values(FILES)) writeFileSync(join(UPLOADS, name), 'file body');

        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await withDb(async (db) => {
            for (const [username, role] of [['lf-teacher', 'educator'], ['lf-student', 'student'], ['lf-outsider', 'student']]) {
                await pRun(db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES (?, ?, ?, ?, ?, 1, 'active')`,
                    [username, username, `${username}@example.com`, hash, role]);
            }
            studentId = (await pGet(db, "SELECT id FROM users WHERE username = 'lf-student'")).id;
            caseId = (await pRun(db,
                'INSERT INTO cases (name, config, tenant_id, is_available) VALUES (?, ?, 1, 1)',
                ['File case', JSON.stringify({ courseGate: { afterMinutes: 15 } })])).lastID;
        });
        teacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'lf-teacher'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'lf-student'));
        outsider = authedFetch(server.baseUrl, await login(server.baseUrl, 'lf-outsider'));
        anonymous = authedFetch(server.baseUrl, null);

        const cohortId = (await (await teacher('/api/cohorts', { method: 'POST', body: JSON.stringify({ name: 'Patologia' }) })).json()).cohort.id;
        await teacher(`/api/cohorts/${cohortId}/members`, { method: 'POST', body: JSON.stringify({ identifier: 'lf-student' }) });
        expect((await teacher(`/api/cases/${caseId}/course`, { method: 'PUT', body: JSON.stringify({ cohortId }) })).status).toBe(200);
        const create = async (title, content) => (await (await teacher(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', body: JSON.stringify({ title, content, isPublished: true }),
        })).json()).data.id;
        const lockedLesson = await create('Vastaus', `<p><img src="/uploads/${FILES.shared}"></p>`);
        await create('Johdanto', `<p><img src="/uploads/${FILES.shared}"></p>`);
        await teacher(`/api/courses/lectures/${lockedLesson}/sections`, {
            method: 'POST', body: JSON.stringify({ title: 'Liite', type: 'file', fileName: 'answer.pdf', fileUrl: `/uploads/${FILES.locked}` }),
        });
        expect((await teacher(`/api/cases/${caseId}/course-locks`, { method: 'PUT', body: JSON.stringify({ lessonIds: [lockedLesson] }) })).status).toBe(200);
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        for (const name of Object.values(FILES)) rmSync(join(UPLOADS, name), { force: true });
    });

    it('refuses a locked lesson\'s file before the case', async () => {
        // Regression lock: a locked lesson's attachment was served from /uploads to anyone with its address
        expect((await anonymous(`/uploads/${FILES.locked}`)).status).toBe(401);
        expect((await student(`/uploads/${FILES.locked}`)).status).toBe(404);
        expect((await outsider(`/uploads/${FILES.locked}`)).status).toBe(404);
    });

    it('serves it to the educator, and never to a shared cache', async () => {
        const res = await teacher(`/uploads/${FILES.locked}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('file body');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
    });

    it('serves files no locked lesson holds back, as before', async () => {
        expect((await anonymous(`/uploads/${FILES.loose}`)).status).toBe(200);
        // Also used by a published open lesson: already shown, so not held back.
        expect((await anonymous(`/uploads/${FILES.shared}`)).status).toBe(200);
    });

    it('serves it to the learner once the case\'s gate is met', async () => {
        await withDb((db) => pRun(db,
            'INSERT INTO sessions (case_id, user_id, tenant_id, start_time) VALUES (?, ?, 1, ?)',
            [caseId, studentId, new Date(Date.now() - 20 * 60_000).toISOString()]));
        expect((await student(`/uploads/${FILES.locked}`)).status).toBe(200);
        expect((await outsider(`/uploads/${FILES.locked}`)).status).toBe(404);
    });
});
