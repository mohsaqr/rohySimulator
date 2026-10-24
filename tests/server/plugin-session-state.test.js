// A plugin room's learner work, stored on the server (F06, migration 0069).
//
// Before this, a pathology report and its annotations lived only in the
// browser's localStorage: lost on another device, overwritten last-writer-wins
// by a second tab, invisible to the educator. These tests pin the server half:
// revisioned compare-and-swap, owner-only writes, staff read, tenant scoping,
// the educator's per-session export, and erasure with the user.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'PluginState1!';

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
const pAll = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

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

const REPORT_DRAFT = { reports: [{ id: 'r1', title: 'Colon', body: 'Gland forming tumour.', status: 'draft', submittedAtMs: null }] };
const REPORT_SUBMITTED = {
    reports: [{ id: 'r1', title: 'Colon', body: 'Gland forming tumour.', status: 'submitted', submittedAtMs: Date.UTC(2026, 9, 14, 10, 0, 0) }],
    annotations: { 'slide-1': [{ id: 'a1' }] },
};

describe('plugin session state: the server copy of a learner\'s room work', () => {
    let server;
    let learner, peer, educator, otherTenantEducator, admin;
    let learnerId, sessionId, peerSessionId, purgeUserId, purgeSessionId;

    async function withDb(work) {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    }
    const path = (sid = sessionId, plugin = 'pathology', name = 'state') => `/api/sessions/${sid}/plugin-state/${plugin}/${name}`;
    const put = (as, body, sid, plugin, name) => as(path(sid, plugin, name), { method: 'PUT', body: JSON.stringify(body) });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await withDb(async (db) => {
            await pRun(db, "INSERT INTO tenants (id, slug, name) VALUES (2, 'plugin-state-t2', 'Plugin state tenant 2')");
            const users = [
                ['ps-learner', 'student', 1], ['ps-peer', 'student', 1], ['ps-educator', 'educator', 1],
                ['ps-educator-t2', 'educator', 2], ['ps-admin', 'admin', 1], ['ps-purged', 'student', 1],
            ];
            for (const [username, role, tenant] of users) {
                await pRun(db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
                    [username, username, `${username}@example.com`, hash, role, tenant]);
            }
            const id = async (u) => (await pGet(db, 'SELECT id FROM users WHERE username = ?', [u])).id;
            learnerId = await id('ps-learner');
            purgeUserId = await id('ps-purged');
            const caseId = (await pRun(db, "INSERT INTO cases (name, config, tenant_id, is_available) VALUES ('PS case', '{}', 1, 1)")).lastID;
            const start = new Date().toISOString();
            const newSession = async (userId) => (await pRun(db,
                'INSERT INTO sessions (case_id, user_id, tenant_id, start_time) VALUES (?, ?, 1, ?)', [caseId, userId, start])).lastID;
            sessionId = await newSession(learnerId);
            peerSessionId = await newSession(await id('ps-peer'));
            purgeSessionId = await newSession(purgeUserId);
        });
        learner = authedFetch(server.baseUrl, await login(server.baseUrl, 'ps-learner'));
        peer = authedFetch(server.baseUrl, await login(server.baseUrl, 'ps-peer'));
        educator = authedFetch(server.baseUrl, await login(server.baseUrl, 'ps-educator'));
        otherTenantEducator = authedFetch(server.baseUrl, await login(server.baseUrl, 'ps-educator-t2'));
        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'ps-admin'));
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('reads nothing before anything was saved', async () => {
        const res = await learner(path());
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ document: null, revision: 0 });
    });

    it('saves with a revision, and the next read returns it', async () => {
        const first = await put(learner, { document: REPORT_DRAFT, expectedRevision: 0 });
        expect(first.status).toBe(200);
        expect((await first.json()).revision).toBe(1);
        const second = await put(learner, { document: REPORT_SUBMITTED, expectedRevision: 1 });
        expect((await second.json()).revision).toBe(2);
        const read = await (await learner(path())).json();
        expect(read).toMatchObject({ document: REPORT_SUBMITTED, revision: 2 });
    });

    it('refuses a write based on a stale revision and returns the server copy', async () => {
        // Regression lock: two tabs of one session overwrote each other's work last-writer-wins
        const stale = await put(learner, { document: { reports: [] }, expectedRevision: 1 });
        expect(stale.status).toBe(409);
        const body = await stale.json();
        expect(body).toMatchObject({ code: 'plugin_state_conflict', revision: 2, document: REPORT_SUBMITTED });
        // And it really was not written.
        expect((await (await learner(path())).json()).document).toEqual(REPORT_SUBMITTED);
        // A second "first save" (revision 0) of an existing document is a conflict too.
        expect((await put(learner, { document: {}, expectedRevision: 0 })).status).toBe(409);
    });

    it('never lets another learner read or write the document', async () => {
        // Regression lock: a learner must never receive another learner's room work
        const read = await peer(path());
        expect(read.status).toBe(403);
        expect(JSON.stringify(await read.json())).not.toContain('Gland forming');
        const write = await put(peer, { document: { reports: [] }, expectedRevision: 2 });
        expect(write.status).toBe(403);
        expect((await (await learner(path())).json()).revision).toBe(2);
        // Nor the educator list.
        expect((await peer(`/api/sessions/${sessionId}/plugin-state`)).status).toBe(403);
    });

    it('lets staff of the same tenant read but not write', async () => {
        const read = await educator(path());
        expect(read.status).toBe(200);
        expect((await read.json()).document).toEqual(REPORT_SUBMITTED);
        const write = await put(educator, { document: { reports: [] }, expectedRevision: 2 });
        expect(write.status).toBe(403);
        expect((await write.json()).code).toBe('plugin_state_read_only');
    });

    it('lists every plugin document of a session for the educator', async () => {
        const res = await educator(`/api/sessions/${sessionId}/plugin-state`);
        expect(res.status).toBe(200);
        const { documents } = await res.json();
        expect(documents).toHaveLength(1);
        expect(documents[0]).toMatchObject({ pluginId: 'pathology', name: 'state', revision: 2, userId: learnerId, document: REPORT_SUBMITTED });
    });

    it('is invisible to another tenant', async () => {
        expect((await otherTenantEducator(path())).status).toBe(404);
        expect((await otherTenantEducator(`/api/sessions/${sessionId}/plugin-state`)).status).toBe(404);
        expect((await put(otherTenantEducator, { document: {}, expectedRevision: 2 })).status).toBe(404);
    });

    it('rejects an unknown plugin, a bad name, a bad revision, a non-object and an oversized document', async () => {
        const unknown = await put(learner, { document: {}, expectedRevision: 0 }, sessionId, 'not-a-plugin');
        expect(unknown.status).toBe(404);
        expect((await unknown.json()).code).toBe('plugin_state_unknown_plugin');
        const badName = await learner(path(sessionId, 'pathology', '..%2Fx'));
        expect(badName.status).toBe(400);
        expect((await badName.json()).code).toBe('plugin_state_bad_name');
        const badRev = await put(learner, { document: {}, expectedRevision: -1 });
        expect((await badRev.json()).code).toBe('plugin_state_bad_revision');
        const notObject = await put(learner, { document: [1, 2], expectedRevision: 2 });
        expect((await notObject.json()).code).toBe('plugin_state_bad_document');
        const big = await put(learner, { document: { blob: 'x'.repeat(200 * 1024) }, expectedRevision: 2 });
        expect(big.status).toBe(413);
        expect((await big.json()).code).toBe('plugin_state_too_large');
        expect((await (await learner(path())).json()).revision).toBe(2);
    });

    it('audits creation and submission, not every save', async () => {
        const rows = await withDb((db) => pAll(db,
            "SELECT action FROM system_audit_log WHERE resource_type = 'session' AND resource_id = ? AND action LIKE 'plugin_%' ORDER BY id",
            [String(sessionId)]));
        expect(rows.map((r) => r.action)).toEqual(['plugin_state_created', 'plugin_report_submitted']);
    });

    it('puts submitted reports in the educator\'s per-session export', async () => {
        const res = await educator(`/api/export/complete-session/${sessionId}`);
        expect(res.status).toBe(200);
        const csv = await res.text();
        expect(csv).toContain('=== SUBMITTED REPORTS ===');
        expect(csv).toContain('Gland forming tumour.');
        expect(csv).toContain('2026-10-14T10:00:00.000Z');
        // A session without room work has no such section.
        const empty = await (await educator(`/api/export/complete-session/${peerSessionId}`)).text();
        expect(empty).not.toContain('SUBMITTED REPORTS');
    });

    it('caps the distinct documents one plugin may keep for a session, never an update', async () => {
        // Regression lock: a learner's client could create unlimited 192 KB documents per session by looping over names
        const peerPath = (name) => path(peerSessionId, 'pathology', name);
        // Sequential on purpose: each save is its own BEGIN IMMEDIATE connection.
        const statuses = await Array.from({ length: 32 }, (_, i) => i).reduce(async (acc, i) => [
            ...(await acc),
            (await put(peer, { document: { n: i }, expectedRevision: 0 }, peerSessionId, 'pathology', `doc${i}`)).status,
        ], Promise.resolve([]));
        expect(statuses).toEqual(Array(32).fill(200));

        const over = await put(peer, { document: { n: 32 }, expectedRevision: 0 }, peerSessionId, 'pathology', 'doc32');
        expect(over.status).toBe(413);
        expect((await over.json()).code).toBe('plugin_state_quota');
        expect((await (await peer(peerPath('doc32'))).json()).document).toBeNull();

        // An existing name still saves.
        const update = await put(peer, { document: { n: 'again' }, expectedRevision: 1 }, peerSessionId, 'pathology', 'doc0');
        expect(update.status).toBe(200);
        expect((await update.json()).revision).toBe(2);
        const count = await withDb((db) => pGet(db,
            'SELECT COUNT(*) AS n FROM plugin_session_documents WHERE session_id = ?', [peerSessionId]));
        expect(count.n).toBe(32);
    });

    it('is erased with the user', async () => {
        const purgedToken = await login(server.baseUrl, 'ps-purged');
        const purged = authedFetch(server.baseUrl, purgedToken);
        expect((await put(purged, { document: REPORT_DRAFT, expectedRevision: 0 }, purgeSessionId)).status).toBe(200);
        const res = await admin(`/api/users/${purgeUserId}/purge`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
        expect([200, 202]).toContain(res.status);
        const left = await withDb((db) => pAll(db, 'SELECT id FROM plugin_session_documents WHERE user_id = ?', [purgeUserId]));
        expect(left).toEqual([]);
    });
});
