// The course gate's "every slide opened" condition, measured by the server.
//
// A slide reaches a learner only through rohy's content proxy
// (GET /api/plugins/pathology/*), so the proxy records the first time it
// serves a learner a slide's descriptor (`.dzi`) and the gate counts those
// reads. It used to count OPENED_SLIDE learning events, which the learner's
// own browser posts, so a learner could open the course materials without
// opening a slide. Also locked here: guests are refused the course routes.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer } from '../utils/startTestServer.js';
import { putInDefaultCourse } from '../utils/defaultCourse.js';

const PASSWORD = 'SlideReads1!';
const DZI = '<?xml version="1.0"?>\n<Image TileSize="512" Overlap="1" Format="jpeg" xmlns="http://schemas.microsoft.com/deepzoom/2008"><Size Width="1024" Height="768"/></Image>';

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
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

// Two slides served by the proxy (a library asset and a legacy slide naming
// its own descriptor) and one an author linked by a full address, which the
// proxy never sees.
const PATHOLOGY = {
    manifest: {
        assets: [{ id: 'asset-a1', kind: 'wsi', renditions: [{ kind: 'dzi', uri: 'remote:library/asset-a1/slide.dzi' }] }],
        slides: [
            { id: 'slide-a1', assetId: 'asset-a1', label: 'A1 — HE' },
            { id: 'slide-b1', label: 'B1 — HE', dzi: 'remote:tiles/b1.dzi' },
        ],
    },
};
const PATHOLOGY_EXTERNAL = {
    manifest: { slides: [{ id: 'slide-x', label: 'X — HE', dzi: 'https://slides.example.edu/x.dzi' }] },
};

describe('course gate: slides opened, as the server saw it', () => {
    let server;
    let contentRoot;
    let student, peer, guest;
    let studentId;
    let caseId, externalCaseId;

    async function withDb(work) {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    }
    const reportOpened = (userId, onCase, slideId) => withDb((db) => pRun(db,
        `INSERT INTO learning_events (user_id, case_id, tenant_id, verb, object_type, object_id)
         VALUES (?, ?, 1, 'OPENED_SLIDE', 'slide', ?)`,
        [userId, onCase, slideId]));
    const gate = async (as, onCase = caseId) => (await (await as(`/api/cases/${onCase}/course-state`)).json()).gate;

    beforeAll(async () => {
        contentRoot = mkdtempSync(join(tmpdir(), 'rohy-slide-reads-'));
        const pathology = join(contentRoot, 'pathology');
        mkdirSync(join(pathology, 'library', 'asset-a1'), { recursive: true });
        mkdirSync(join(pathology, 'tiles'), { recursive: true });
        writeFileSync(join(pathology, 'library', 'asset-a1', 'slide.dzi'), DZI);
        writeFileSync(join(pathology, 'tiles', 'b1.dzi'), DZI);
        // A starter bundle is recognised by its content.json.
        writeFileSync(join(pathology, 'content.json'), '{}');

        server = await startTestServer({ seed: false, env: { ROHY_STARTER_CONTENT_DIR: contentRoot } });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await withDb(async (db) => {
            for (const [username, role] of [['sr-student', 'student'], ['sr-peer', 'student'], ['sr-guest', 'guest']]) {
                await pRun(db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES (?, ?, ?, ?, ?, 1, 'active')`,
                    [username, username, `${username}@example.com`, hash, role]);
            }
            studentId = (await pGet(db, "SELECT id FROM users WHERE username = 'sr-student'")).id;
            const insertCase = async (name, pathology) => (await pRun(db,
                'INSERT INTO cases (name, config, tenant_id, is_available) VALUES (?, ?, 1, 1)',
                [name, JSON.stringify({ courseGate: { afterMinutes: 0, allSlidesOpened: true }, pathology })])).lastID;
            caseId = await insertCase('Slide case', PATHOLOGY);
            externalCaseId = await insertCase('External slide case', PATHOLOGY_EXTERNAL);
            const started = new Date(Date.now() - 60_000).toISOString();
            for (const onCase of [caseId, externalCaseId]) {
                await pRun(db, 'INSERT INTO sessions (case_id, user_id, tenant_id, start_time) VALUES (?, ?, 1, ?)',
                    [onCase, studentId, started]);
            }
        });
        // With course access on by default, a student reaches a case through a course.
        await putInDefaultCourse(server.dbPath, caseId);
        await putInDefaultCourse(server.dbPath, externalCaseId);
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'sr-student'));
        peer = authedFetch(server.baseUrl, await login(server.baseUrl, 'sr-peer'));
        guest = authedFetch(server.baseUrl, await login(server.baseUrl, 'sr-guest'));
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        if (contentRoot) rmSync(contentRoot, { recursive: true, force: true });
    });

    it('does not count slides the browser only reports as opened', async () => {
        // Regression lock: OPENED_SLIDE events posted by the learner's browser met the slide condition without a slide being opened
        await reportOpened(studentId, caseId, 'slide-a1');
        await reportOpened(studentId, caseId, 'slide-b1');
        const state = await gate(student);
        expect(state.unlocked).toBe(false);
        expect(state.slides.map((slide) => slide.opened)).toEqual([false, false]);
    });

    it('counts a slide once the proxy has served its descriptor to the learner', async () => {
        const first = await student('/api/plugins/pathology/library/asset-a1/slide.dzi');
        expect(first.status).toBe(200);
        expect(first.headers.get('cache-control')).toBe('private, no-cache');
        expect((await gate(student)).slides.map((slide) => slide.opened)).toEqual([true, false]);

        expect((await student('/api/plugins/pathology/tiles/b1.dzi')).status).toBe(200);
        const state = await gate(student);
        expect(state.slides.map((slide) => slide.opened)).toEqual([true, true]);
        expect(state.unlocked).toBe(true);
    });

    it('counts only the learner\'s own reads, and only a descriptor that was served', async () => {
        expect((await peer('/api/plugins/pathology/tiles/missing.dzi')).status).toBe(404);
        expect((await peer('/api/plugins/pathology/tiles/b1.dzi')).status).toBe(200);
        // The read is recorded just after the descriptor is served (fire-and-forget in
        // plugins-routes.js), so the peer's row can land a moment after the 200: wait for it
        // rather than read once (CI 2026-10-14 read the table before it arrived).
        const readRows = () => withDb((db) => new Promise((resolve, reject) => db.all(
            `SELECT u.username, r.path FROM plugin_content_reads r JOIN users u ON u.id = r.user_id ORDER BY u.username, r.path`,
            [], (err, all) => (err ? reject(err) : resolve(all)))));
        const rows = await vi.waitFor(async () => {
            const all = await readRows();
            if (all.length < 3) throw new Error(`only ${all.length} reads recorded yet`);
            return all;
        }, { timeout: 5_000, interval: 50 });
        expect(rows).toEqual([
            { username: 'sr-peer', path: 'tiles/b1.dzi' },
            { username: 'sr-student', path: 'library/asset-a1/slide.dzi' },
            { username: 'sr-student', path: 'tiles/b1.dzi' },
        ]);
    });

    it('falls back to the browser\'s report for a slide the proxy never serves', async () => {
        expect((await gate(student, externalCaseId)).unlocked).toBe(false);
        await reportOpened(studentId, externalCaseId, 'slide-x');
        expect((await gate(student, externalCaseId)).unlocked).toBe(true);
    });

    it('refuses guests the course state and the questionnaire answers', async () => {
        // Regression lock: a guest could read a case's course state and store questionnaire answers
        expect((await guest(`/api/cases/${caseId}/course-state`)).status).toBe(403);
        const submit = await guest(`/api/cases/${caseId}/questionnaires/any/responses`, {
            method: 'POST', body: JSON.stringify({ attempt: 'single', answers: {} }),
        });
        expect(submit.status).toBe(403);
    });
});
