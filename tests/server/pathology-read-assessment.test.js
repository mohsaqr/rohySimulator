// "How this slide was read", scored on the server (FI-0010 F03, migration 0070).
//
// Regression lock: the learner's pathology room never received a rubric (it is
// the answer key and is stripped from the learner projection), no recorder ran,
// and the reading feedback the course catalogue promises could never appear.
// The room now records the read rubric-free and posts it here on report
// submission; the server scores it against the session's case snapshot with
// the vendored package's own scorer and returns only the learner-safe summary.
//
// These tests pin: the score equals the package's (same scorer, same tail);
// the summary carries no geometry or read score; one assessment per session
// and task (a later submission cannot probe); owner-only submission; educator
// review with the full result; tenant scoping; the snapshot (not the live
// case) is what is scored; a long read over the global 256 KB body cap; and
// erasure with the user.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { assessPackedRead, packReadSamples } from '../../src/components/pathology/readFeedback.js';
import { CASE_SCHEMA_URI, CASE_SCHEMA_VERSION, RUBRIC_SCHEMA_URI } from '../../src/components/pathology/caseCore/constants.js';

const PASSWORD = 'PathologyRead1!';

const openDb = (dbPath) => new Promise((resolve, reject) => {
    const db = new (sqlite3.verbose().Database)(dbPath, (err) => (err ? reject(err) : resolve(db)));
});
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
function as(baseUrl, token) {
    return (path, init = {}) => fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
    });
}

/** A two-slide canonical case with a protected rubric (shape of pathoyon's own test fixture). */
function pathologyDocument({ dwellMs = 1000 } = {}) {
    const manifest = {
        $schema: CASE_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: 'case-1',
        revision: {
            id: 'revision-1', number: 1, status: 'draft', parentRevisionId: null,
            createdAt: '2026-10-14T10:00:00.000Z', createdBy: 'author-1',
        },
        title: 'Two-slide synthetic case',
        clinical: { accession: 'S-1', specimenSummary: 'Synthetic tissue' },
        specimens: [{ id: 'specimen-1', part: 'A', label: 'Part A', description: 'Synthetic', grossImageAssetIds: [] }],
        blocks: [
            { id: 'block-1', specimenId: 'specimen-1', label: 'A1' },
            { id: 'block-2', specimenId: 'specimen-1', label: 'A2' },
        ],
        assets: [
            {
                id: 'asset-1', kind: 'wsi',
                source: { kind: 'catalog', catalogAssetId: 'catalog-1', revision: 'sha256:source-1', checksum: null },
                metadata: { widthPx: 100, heightPx: 100, nativeObjective: 10, nativeMpp: 1, downsample: 1 },
                renditions: [{ kind: 'dzi', uri: 'https://cdn.test/s1.dzi', checksum: 'sha256:d1' }],
            },
            {
                id: 'asset-2', kind: 'wsi',
                source: { kind: 'catalog', catalogAssetId: 'catalog-2', revision: 'sha256:source-2', checksum: null },
                metadata: { widthPx: 1000, heightPx: 1000, nativeObjective: 40, nativeMpp: 0.25, downsample: 2 },
                renditions: [{ kind: 'dzi', uri: 'https://cdn.test/s2.dzi', checksum: 'sha256:d2' }],
            },
        ],
        slides: [
            { id: 'slide-1', blockId: 'block-1', assetId: 'asset-1', label: 'A1 — H&E', stain: { code: 'HE', display: 'H&E' } },
            { id: 'slide-2', blockId: 'block-2', assetId: 'asset-2', label: 'A2 — IHC', stain: { code: 'IHC', display: 'IHC' } },
        ],
        activities: [{ id: 'activity-1', kind: 'diagnostic-report', prompt: 'Report both slides.', instructions: 'Screen.' }],
        provenance: {},
    };
    const rubric = {
        $schema: RUBRIC_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: 'rubric-1',
        caseId: 'case-1',
        caseRevisionId: 'revision-1',
        activities: [{
            activityId: 'activity-1',
            hints: ['Protected hint'],
            slideCriteria: [
                {
                    slideId: 'slide-1', weight: 1, screeningObjective: 5, coverageObjective: 2, coverageGrid: 10,
                    tissueBounds: { x: 0, y: 0, w: 100, h: 100 },
                    rois: [{ id: 'roi-1', label: 'SECRET small focus', x: 10, y: 10, w: 10, h: 10, minObjective: 10, dwellMs, critical: true }],
                },
                {
                    slideId: 'slide-2', weight: 3, screeningObjective: 5, coverageObjective: 2, coverageGrid: 10,
                    tissueBounds: { x: 0, y: 0, w: 1000, h: 1000 },
                    rois: [{ id: 'roi-2', label: 'SECRET large focus', x: 800, y: 800, w: 50, h: 50, minObjective: 10, dwellMs, critical: true }],
                },
            ],
        }],
    };
    return { manifest, rubric };
}

const sample = (slideId, t, x, y, objective = 20) => ({ slideId, t, x, y, w: 40, h: 40, objective, settled: true });
// Reaches roi-2 (slide 2, 20x, 1.5 s on it); never visits roi-1.
const READ = packReadSamples([
    sample('slide-1', 0, 50, 50, 4),
    sample('slide-2', 500, 790, 790),
    sample('slide-2', 1000, 795, 795),
    sample('slide-2', 1500, 800, 800),
]);
// Reaches both: what a learner would send after "learning" from feedback.
const PROBE = packReadSamples([
    sample('slide-1', 0, -5, -5, 20), sample('slide-1', 600, -5, -5, 20), sample('slide-1', 1200, -5, -5, 20),
    sample('slide-2', 1800, 790, 790), sample('slide-2', 2400, 790, 790), sample('slide-2', 3000, 790, 790),
]);

describe('pathology reads: scored on the server, never with the rubric in the browser', () => {
    let server;
    let learner, peer, educator, otherTenantEducator, admin;
    let learnerId, sessionId, liveCaseSessionId, noRubricSessionId, offRoomSessionId, purgeUserId, purgeSessionId;
    let caseId;
    let purgeToken;

    const url = (sid = sessionId) => `/api/sessions/${sid}/pathology-reads`;
    const post = (who, body, sid) => who(url(sid), { method: 'POST', body: JSON.stringify(body) });
    async function withDb(work) {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    }

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await withDb(async (db) => {
            await pRun(db, "INSERT INTO tenants (id, slug, name) VALUES (2, 'pr-t2', 'Pathology read tenant 2')");
            for (const [username, role, tenant] of [
                ['pr-learner', 'student', 1], ['pr-peer', 'student', 1], ['pr-educator', 'educator', 1],
                ['pr-educator-t2', 'educator', 2], ['pr-purged', 'student', 1], ['pr-admin', 'admin', 1],
            ]) {
                await pRun(db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
                    [username, username, `${username}@example.com`, hash, role, tenant]);
            }
            const id = async (u) => (await pGet(db, 'SELECT id FROM users WHERE username = ?', [u])).id;
            learnerId = await id('pr-learner');
            purgeUserId = await id('pr-purged');
            const config = { pathology: pathologyDocument() };
            caseId = (await pRun(db, 'INSERT INTO cases (name, config, tenant_id, is_available) VALUES (?, ?, 1, 1)',
                ['PR case', JSON.stringify(config)])).lastID;
            const start = new Date().toISOString();
            const session = async (userId, snapshotConfig, sessionCaseId = caseId) => (await pRun(db,
                'INSERT INTO sessions (case_id, user_id, tenant_id, start_time, case_snapshot) VALUES (?, ?, 1, ?, ?)',
                [sessionCaseId, userId, start, snapshotConfig === undefined ? null : JSON.stringify({ config: snapshotConfig })])).lastID;
            sessionId = await session(learnerId, config);
            liveCaseSessionId = await session(learnerId, undefined);   // pre-snapshot session: live case
            noRubricSessionId = await session(learnerId, { pathology: { manifest: pathologyDocument().manifest } });
            offRoomSessionId = await session(learnerId, { ...config, rooms: { disabled: ['pathology'] } });
            purgeSessionId = await session(purgeUserId, config);
        });
        learner = as(server.baseUrl, await login(server.baseUrl, 'pr-learner'));
        peer = as(server.baseUrl, await login(server.baseUrl, 'pr-peer'));
        educator = as(server.baseUrl, await login(server.baseUrl, 'pr-educator'));
        otherTenantEducator = as(server.baseUrl, await login(server.baseUrl, 'pr-educator-t2'));
        purgeToken = await login(server.baseUrl, 'pr-purged');
        admin = as(server.baseUrl, await login(server.baseUrl, 'pr-admin'));
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('scores the submitted read exactly as the package does, returning only the learner summary', async () => {
        const res = await post(learner, { reportId: 'case-1-report-1', activityId: 'activity-1', read: READ });
        expect(res.status).toBe(201);
        const body = await res.json();
        const expected = assessPackedRead(READ, pathologyDocument().rubric, { activityId: 'activity-1' }).feedback;
        expect(body.feedback).toEqual(expected);
        expect(body.feedback).toMatchObject({ roiReached: 1, roiTotal: 2, criticalReached: 1, criticalTotal: 2 });
        expect(body.feedback.missed.map((m) => [m.slideId, m.id, m.missReason])).toEqual([['slide-1', 'roi-1', 'never_on_screen']]);
        // No geometry, no thresholds, no read score.
        const text = JSON.stringify(body);
        for (const key of ['"x"', '"y"', '"w"', '"h"', 'minObjective', 'dwellMs', 'tissueBounds', 'readScore', 'Protected hint']) {
            expect(text).not.toContain(key);
        }
    });

    it('keeps the first read of a task: a later submission gets the same feedback, not a re-score', async () => {
        const res = await post(learner, { reportId: 'case-1-report-2', activityId: 'activity-1', read: PROBE });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ assessed: 'earlier', reportId: 'case-1-report-1' });
        expect(body.feedback.roiReached).toBe(1);
        const rows = await withDb((db) => pAll(db, 'SELECT report_id, read_score FROM pathology_read_assessments WHERE session_id = ?', [sessionId]));
        expect(rows).toHaveLength(1);
        expect(typeof rows[0].read_score).toBe('number');
    });

    it('lets only the session\'s own learner submit', async () => {
        expect((await post(peer, { reportId: 'r-1', activityId: 'activity-1', read: READ })).status).toBe(403);
        const staff = await post(educator, { reportId: 'r-1', activityId: 'activity-1', read: READ });
        expect(staff.status).toBe(403);
        expect((await staff.json()).code).toBe('pathology_read_not_owner');
        expect((await post(otherTenantEducator, { reportId: 'r-1', read: READ })).status).toBe(404);
    });

    it('refuses a malformed read or report id with a code, and scores nothing', async () => {
        const bad = await post(learner, { reportId: 'r-1', activityId: 'activity-1', read: { v: 1, slides: ['slide-1'], samples: [[0, 0, 1]] } }, liveCaseSessionId);
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('pathology_read_invalid');
        const badId = await post(learner, { reportId: '../etc', read: READ }, liveCaseSessionId);
        expect(badId.status).toBe(400);
        expect((await badId.json()).code).toBe('pathology_read_bad_report');
        const unknown = await post(learner, { reportId: 'r-1', activityId: 'activity-x', read: READ }, liveCaseSessionId);
        expect(unknown.status).toBe(422);
        const rows = await withDb((db) => pAll(db, 'SELECT id FROM pathology_read_assessments WHERE session_id = ?', [liveCaseSessionId]));
        expect(rows).toHaveLength(0);
    });

    it('answers "no feedback" for a case with no rubric, and refuses a room switched off', async () => {
        const none = await post(learner, { reportId: 'r-1', activityId: null, read: READ }, noRubricSessionId);
        expect(none.status).toBe(200);
        expect((await none.json()).feedback).toBeNull();
        const off = await post(learner, { reportId: 'r-1', activityId: 'activity-1', read: READ }, offRoomSessionId);
        expect(off.status).toBe(403);
        expect((await off.json()).code).toBe('room_disabled');
    });

    it('scores against the snapshot the session started with, and the live case only for an old session', async () => {
        // The educator tightens the dwell to 10 s after the sessions began.
        await withDb((db) => pRun(db, 'UPDATE cases SET config = ? WHERE id = ?',
            [JSON.stringify({ pathology: pathologyDocument({ dwellMs: 10000 }) }), caseId]));
        const live = await post(learner, { reportId: 'r-1', activityId: 'activity-1', read: READ }, liveCaseSessionId);
        expect(live.status).toBe(201);
        expect((await live.json()).feedback.roiReached).toBe(0);   // no snapshot → the live (stricter) case
        // The snapshotted session was scored at 1 s dwell, before and regardless.
        const kept = await withDb((db) => pGet(db, 'SELECT feedback FROM pathology_read_assessments WHERE session_id = ?', [sessionId]));
        expect(JSON.parse(kept.feedback).roiReached).toBe(1);
    });

    it('accepts a long read beyond the global 256 KB body cap', async () => {
        const long = packReadSamples(Array.from({ length: 6000 }, (_, i) => sample('slide-2', i * 400, 100000.5 + i, 200000.5 + i, 12.345)));
        expect(JSON.stringify(long).length).toBeGreaterThan(256 * 1024);
        const res = await post(as(server.baseUrl, purgeToken), { reportId: 'r-long', activityId: 'activity-1', read: long }, purgeSessionId);
        expect(res.status).toBe(201);
    });

    it('shows the educator the full result, and nothing to a learner', async () => {
        const res = await educator(url());
        expect(res.status).toBe(200);
        const { assessments } = await res.json();
        expect(assessments).toHaveLength(1);
        expect(assessments[0]).toMatchObject({ activityId: 'activity-1', reportId: 'case-1-report-1', userId: learnerId });
        expect(typeof assessments[0].readScore).toBe('number');
        expect(assessments[0].result.perSlide).toHaveLength(2);
        expect((await learner(url())).status).toBe(403);
        expect((await otherTenantEducator(url())).status).toBe(404);
    });

    it('is erased with the user', async () => {
        const before = await withDb((db) => pAll(db, 'SELECT id FROM pathology_read_assessments WHERE user_id = ?', [purgeUserId]));
        expect(before).toHaveLength(1);
        const res = await admin(`/api/users/${purgeUserId}/purge`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
        expect([200, 202]).toContain(res.status);
        const left = await withDb((db) => pAll(db, 'SELECT id FROM pathology_read_assessments WHERE user_id = ?', [purgeUserId]));
        expect(left).toEqual([]);
    });
});
