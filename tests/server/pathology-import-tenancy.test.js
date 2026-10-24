// Regression lock: an imported slide's identity is per TENANT.
//
// `stableAssetId('import', url)` had no tenant component and the plugin_assets
// upsert keyed on that id alone, so tenant B importing the URL tenant A had
// already imported renamed and re-tiled A's row — and the job-completion
// UPDATE, with no tenant in its WHERE, finished whichever row carried the id.
//
// Exercised against the plugin module directly with a recording db: what the
// router does is a handful of SQL statements, and those are the contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/plugins/pathology/importSlide.js', () => ({
    importSlide: vi.fn(async (job) => ({
        assetId: job.asset_id, state: 'ready', sourceSha256: 'sha', sourceBytes: 1,
        nativeObjective: 40, nativeMppX: 0.25, nativeMppY: 0.25, tiledObjective: 40,
        width: 100, height: 100, diskBytes: 10,
    })),
    ImportRefused: class ImportRefused extends Error {},
}));

const { default: pathology } = await import('../../server/plugins/pathology/index.js');

function fakeRouter() {
    const routes = {};
    const register = (method) => (path, ...handlers) => { routes[`${method} ${path}`] = handlers.at(-1); };
    return { routes, get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') };
}

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

function fakeCtx(db) {
    return {
        db,
        libraryDir: '/srv/lib/pathology',
        now: () => '2026-10-24T00:00:00.000Z',
        settings: async () => ({ 'imports.enabled': true, 'imports.allowedOrigins': ['https://slides.example'] }),
        enqueue: vi.fn(async () => 'job-1'),
        cancel: vi.fn(),
        removeAssetDirectory: vi.fn(),
        log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        guards: { authenticated: (req, res, next) => next(), educator: (req, res, next) => next() },
        helpers: { tenantId: (req) => req.user.tenant_id, auditSuccess: vi.fn() },
    };
}

async function importAs(tenant, url) {
    const db = { run: vi.fn(async () => ({ changes: 1 })), get: vi.fn(), all: vi.fn() };
    const router = fakeRouter();
    pathology.routes(router, fakeCtx(db));
    const res = fakeRes();
    await router.routes['POST /imports']({ user: { id: 7, tenant_id: tenant }, body: { url, label: 'Same slide' } }, res);
    return { res, db };
}

const URL = 'https://slides.example/case-7.svs';

describe('pathology slide imports are tenant-scoped', () => {
    beforeEach(() => vi.clearAllMocks());

    it('gives the same URL a different asset id in a different tenant, and writes the row under that tenant', async () => {
        const a = await importAs(1, URL);
        const b = await importAs(2, URL);
        expect(a.res.statusCode).toBe(202);
        expect(b.res.statusCode).toBe(202);
        expect(a.res.body.assetId).toMatch(/^asset-[0-9a-f]{24}$/);
        expect(a.res.body.assetId).not.toBe(b.res.body.assetId);
        // The INSERT carries the tenant the asset id was derived for.
        const [sql, params] = a.db.run.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO plugin_assets/);
        expect(params[0]).toBe(a.res.body.assetId);
        expect(params[1]).toBe(1);
        expect(b.db.run.mock.calls[0][1][1]).toBe(2);
    });

    it('is still deterministic within one tenant, so a re-import reuses the row', async () => {
        const first = await importAs(1, URL);
        const again = await importAs(1, URL);
        expect(again.res.body.assetId).toBe(first.res.body.assetId);
    });

    it('finishes and fails a job only in the job\'s own tenant', async () => {
        const db = { run: vi.fn(async () => ({ changes: 1 })) };
        const ctx = fakeCtx(db);
        const job = { id: 'job-1', tenant_id: 2, asset_id: 'asset-abc', payload: { url: URL } };
        await pathology.jobs.import_slide(job, {}, ctx);
        const [doneSql, doneParams] = db.run.mock.calls[0];
        expect(doneSql).toMatch(/WHERE id = \? AND tenant_id = \? AND plugin_id = 'pathology'/);
        expect(doneParams.slice(-2)).toEqual(['asset-abc', 2]);

        const { importSlide } = await import('../../server/plugins/pathology/importSlide.js');
        importSlide.mockRejectedValueOnce(new Error('tiling failed'));
        await expect(pathology.jobs.import_slide(job, {}, ctx)).rejects.toThrow('tiling failed');
        const [failSql, failParams] = db.run.mock.calls[1];
        expect(failSql).toMatch(/SET state = 'failed'[\s\S]*WHERE id = \? AND tenant_id = \?/);
        expect(failParams.slice(-2)).toEqual(['asset-abc', 2]);
    });
});
