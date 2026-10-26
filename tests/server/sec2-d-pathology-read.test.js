// Security fix pass 2026-10-26, lane D — pathology read verification.
//
// Regression lock: the pathology read score is computed from the viewport track the learner's browser packs, and the server kept it with no check at all (L8-17). The server now records how far it can vouch for the read: every slide the read dwells on that goes through rohy's content proxy must have been served to this learner (plugin_content_reads), and the read cannot span more than the session's age. The verdict is stored with the result and shown to educators.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, seedUser, mintToken } from '../utils/authHttp.js';
import { packReadSamples } from '../../src/components/pathology/readFeedback.js';
import { CASE_SCHEMA_URI, CASE_SCHEMA_VERSION, RUBRIC_SCHEMA_URI } from '../../src/components/pathology/caseCore/constants.js';

const SECRET = 'sec2-d-pathology-secret';

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
                renditions: [{ kind: 'dzi', uri: 'remote:slides/s1.dzi', checksum: 'sha256:d1' }],
            },
            {
                id: 'asset-2', kind: 'wsi',
                source: { kind: 'catalog', catalogAssetId: 'catalog-2', revision: 'sha256:source-2', checksum: null },
                metadata: { widthPx: 1000, heightPx: 1000, nativeObjective: 40, nativeMpp: 0.25, downsample: 2 },
                renditions: [{ kind: 'dzi', uri: 'remote:slides/s2.dzi', checksum: 'sha256:d2' }],
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
const READ = packReadSamples([
    sample('slide-1', 0, 50, 50, 4),
    sample('slide-2', 500, 790, 790),
    sample('slide-2', 1500, 800, 800),
]);

describe('pathology read verification (lane D)', () => {
    let server, learnerId, eduTok, learnerTok, unservedSession, servedSession, tooLongSession;
    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const submit = (sid, read = READ) => fetch(`${server.baseUrl}/api/sessions/${sid}/pathology-reads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${learnerTok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reportId: `r-${sid}`, activityId: 'activity-1', read }),
    });
    const verification = async (sid) => {
        const res = await fetch(`${server.baseUrl}/api/sessions/${sid}/pathology-reads`, { headers: { authorization: `Bearer ${eduTok}` } });
        expect(res.status).toBe(200);
        return (await res.json()).assessments[0].verification;
    };

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET } });
        await withDb(async (db) => {
            learnerId = await seedUser(db, { username: 'd_pr_learner' });
            const edu = await seedUser(db, { username: 'd_pr_edu', role: 'educator' });
            const config = { pathology: pathologyDocument() };
            const caseId = (await run(db, 'INSERT INTO cases (name, config, tenant_id, is_available) VALUES (?, ?, 1, 1)', ['D PR', JSON.stringify(config)])).lastID;
            const session = async (start) => (await run(db,
                'INSERT INTO sessions (case_id, user_id, tenant_id, start_time, case_snapshot) VALUES (?, ?, 1, ?, ?)',
                [caseId, learnerId, start, JSON.stringify({ config })])).lastID;
            const anHourAgo = new Date(Date.now() - 3600_000).toISOString();
            unservedSession = await session(anHourAgo);
            servedSession = await session(anHourAgo);
            tooLongSession = await session(new Date().toISOString());
            // Only slide-2's descriptor was ever served to this learner.
            await run(db, `INSERT INTO plugin_content_reads (tenant_id, user_id, plugin_id, path) VALUES (1, ?, 'pathology', 'slides/s2.dzi')`, [learnerId]);
            eduTok = await mintToken(db, { id: edu, username: 'd_pr_edu', role: 'educator', tenant_id: 1 }, SECRET);
            learnerTok = await mintToken(db, { id: learnerId, username: 'd_pr_learner', role: 'student', tenant_id: 1 }, SECRET);
        });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('a read dwelling on a slide the server never served is stored as unverified', async () => {
        expect((await submit(unservedSession)).status).toBe(201);
        const v = await verification(unservedSession);
        expect(v).toMatchObject({ basis: 'client_track', verified: false, unserved_slides: ['slide-1'] });
    });

    it('once every dwelt slide was served, the read verifies — and an earlier attempt in another session is counted', async () => {
        await withDb((db) => run(db, `INSERT INTO plugin_content_reads (tenant_id, user_id, plugin_id, path) VALUES (1, ?, 'pathology', 'slides/s1.dzi')`, [learnerId]));
        expect((await submit(servedSession)).status).toBe(201);
        const v = await verification(servedSession);
        expect(v).toMatchObject({ verified: true, unserved_slides: [], earlier_attempts: 1 });
    });

    it('a read longer than the session has existed is unverified', async () => {
        const long = packReadSamples([sample('slide-2', 0, 790, 790), sample('slide-2', 2 * 3600_000, 800, 800)]);
        expect((await submit(tooLongSession, long)).status).toBe(201);
        const v = await verification(tooLongSession);
        expect(v.verified).toBe(false);
        expect(v.span_ms).toBe(2 * 3600_000);
    });
});
