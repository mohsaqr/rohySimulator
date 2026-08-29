// The slide library on a host (RPS-1 §7a.1): catalog relayed by rohy, handed to
// the editor RESOLVED; the case leaves the editor UN-resolved. Regression lock
// for "the slides library is empty" — the adapter passed no assetService.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/apiClient', () => ({
    apiFetch,
    apiGet,
    apiPost,
    ApiError: class ApiError extends Error { constructor(status) { super(`http ${status}`); this.status = status; } },
}));

const { resolveRemoteRefs, unresolveRemoteRefs, unresolveRemoteRef } = await import('../../src/plugins/context.js');
const { createHostAssetService } = await import('../../src/plugins/hostAssetService.js');
const { ApiError } = await import('../../src/services/apiClient');
const descriptor = (await import('../../src/plugins/pathology/index.jsx')).default;

const CATALOG = { version: 1, assets: [{ id: 'a', status: 'ready', preview: { url: 'remote:tiles/previews/a.jpg', widthPx: 1, heightPx: 1 },
    revisions: [{ id: 'r', status: 'ready', derivatives: { dzi: { url: 'remote:tiles/a.dzi' } } }] }] };

beforeEach(() => { apiFetch.mockReset(); apiGet.mockReset(); apiPost.mockReset(); });

describe('resolve / unresolve round-trip', () => {
    it('is exact, including encoded segments, and leaves foreign strings alone', () => {
        const doc = { a: 'remote:tiles/with space/x+y.dzi', b: ['remote:gross/p.jpg', 'plain'], c: { d: '/api/plugins/other/tiles/x.dzi' } };
        const resolved = resolveRemoteRefs(doc, 'pathology');
        expect(resolved.a).toBe('/api/plugins/pathology/tiles/with%20space/x%2By.dzi');
        expect(unresolveRemoteRefs(resolved, 'pathology')).toEqual(doc);
        expect(unresolveRemoteRef('/api/plugins/other/tiles/x.dzi', 'pathology')).toBe('/api/plugins/other/tiles/x.dzi');
        expect(unresolveRemoteRef(null, 'pathology')).toBeNull();
    });
});

describe('createHostAssetService', () => {
    it('lists the relayed catalog with every reference resolved for display', async () => {
        apiFetch.mockResolvedValue({ plugin: 'pathology', catalog: CATALOG });
        apiGet.mockResolvedValue({ assets: [] });
        const svc = createHostAssetService({ pluginId: 'pathology' });
        // False even though the service now WRITES: in the editor this flag
        // gates the scan/process panel specifically, and a host has neither.
        // The import panel is gated on `importUrl` being present instead.
        expect(svc.available).toBe(false);
        expect(typeof svc.importUrl).toBe('function');
        const out = await svc.list();
        expect(apiFetch).toHaveBeenCalledWith('/plugins/pathology/catalog');
        expect(out.assets[0].preview.url).toBe('/api/plugins/pathology/tiles/previews/a.jpg');
        expect(out.assets[0].revisions[0].derivatives.dzi.url).toBe('/api/plugins/pathology/tiles/a.dzi');
    });
    it('turns "no origin" (503) and "no catalog" (404) into an empty list with a reason, and rethrows the rest', async () => {
        const svc = createHostAssetService({ pluginId: 'pathology' });
        apiFetch.mockRejectedValueOnce(new ApiError(503));
        expect(await svc.list()).toMatchObject({ assets: [], unavailableReason: expect.stringMatching(/ROHY_PLUGIN_ORIGINS/) });
        apiFetch.mockRejectedValueOnce(new ApiError(404));
        expect(await svc.list()).toMatchObject({ assets: [], unavailableReason: expect.stringMatching(/catalog\.json/) });
        apiFetch.mockRejectedValueOnce(new ApiError(500));
        await expect(svc.list()).rejects.toThrow(/500/);
    });
});

describe('pathology adapter authorProps', () => {
    it('hands the editor a resolved document + an asset service, and stores the document un-resolved', async () => {
        // A canonical document built by the package's own model, with one slide
        // whose source is a remote: reference (as a host stores it).
        const { addStudioBlock, addStudioSlide, createStudioDocument, updateStudioEntity } =
            await import('../../src/components/pathology/caseStudioModel.js');
        const count = new Map(); const factory = (kind) => { const next = (count.get(kind) ?? 0) + 1; count.set(kind, next); return `${kind}-${next}`; };
        let stored = createStudioDocument({ idFactory: factory, now: () => '2026-08-29T00:00:00.000Z', createdBy: 't' });
        stored = updateStudioEntity(stored, 'specimen', 'specimen-1', { part: 'A', label: 'Breast' });
        stored = addStudioBlock(stored, 'specimen-1', { label: 'A1' }, factory);
        stored = addStudioSlide(stored, 'block-1', {
            id: 'a', label: 'A H&E', status: 'ready', currentRevisionId: 'r',
            revisions: [{ id: 'r', status: 'ready', createdAt: '2026-01-01T00:00:00.000Z', sourceChecksum: 'sha256:a',
                derivatives: { dzi: { url: 'remote:tiles/a.dzi' } },
                optics: { nativeObjective: 40, nativeMpp: 0.25, downsample: 4, slideWidthPx: 1000, slideHeightPx: 800, provenance: 'scanner' } }],
        }, { label: 'A1 — H&E', stainCode: 'HE', stainDisplay: 'H&E' }, factory);
        expect(JSON.stringify(stored)).toContain('remote:tiles/a.dzi');
        const save = vi.fn();
        const props = descriptor.authorProps({ pluginId: 'pathology' }, { value: stored, save });
        expect(JSON.stringify(props.initialCase)).toContain('/api/plugins/pathology/tiles/a.dzi');
        expect(JSON.stringify(props.initialCase)).not.toContain('remote:');
        expect(typeof props.assetService.list).toBe('function');
        props.onChange({ manifest: { slides: [{ dzi: '/api/plugins/pathology/tiles/b.dzi' }] } });
        expect(save).toHaveBeenCalledWith({ manifest: { slides: [{ dzi: 'remote:tiles/b.dzi' }] } });
        expect(descriptor.authorProps({ pluginId: 'pathology' }, { value: null, save }).initialCase).toBeUndefined();
    });
});

describe('the write half (RPS-1 1.4)', () => {
    it('shows slides that are still importing or failed, which the catalog omits', async () => {
        apiFetch.mockResolvedValue({ plugin: 'pathology', catalog: CATALOG });
        apiGet.mockResolvedValue({ assets: [
            { id: 'busy', status: 'importing', revisions: [] },
            { id: 'broke', status: 'failed', error: '404 from the source', revisions: [] },
            // Already in the catalog as a ready slide; must not appear twice.
            { id: 'a', status: 'ready', revisions: [] },
        ] });
        const out = await createHostAssetService({ pluginId: 'pathology' }).list();
        expect(out.assets.map((x) => x.id)).toEqual(['busy', 'broke', 'a']);
    });

    // A plugin with no server module (404) and a deployment with no library
    // directory (503) are OPERATOR states, not failures an author can act on.
    it.each([404, 503])('treats %i from /assets as "there is no managed half"', async (status) => {
        apiFetch.mockResolvedValue({ plugin: 'pathology', catalog: CATALOG });
        apiGet.mockRejectedValue(new ApiError(status));
        const out = await createHostAssetService({ pluginId: 'pathology' }).list();
        expect(out.assets.map((x) => x.id)).toEqual(['a']);
    });

    // ...but a 403 means something is wrong that the author should see.
    // Swallowing it would show an empty library and call it normal.
    it('rethrows any other failure from /assets', async () => {
        apiFetch.mockResolvedValue({ plugin: 'pathology', catalog: CATALOG });
        apiGet.mockRejectedValue(new ApiError(403));
        await expect(createHostAssetService({ pluginId: 'pathology' }).list()).rejects.toThrow(/403/);
    });

    it('starts an import and returns as soon as it is queued', async () => {
        apiPost.mockResolvedValue({ jobId: 'j1', assetId: 'asset-1', state: 'importing' });
        const svc = createHostAssetService({ pluginId: 'pathology' });
        expect(await svc.importUrl({ url: 'https://a.edu/s.svs', label: 'S' }))
            .toEqual({ jobId: 'j1', assetId: 'asset-1', state: 'importing' });
        expect(apiPost).toHaveBeenCalledWith('/plugins/pathology/imports', { url: 'https://a.edu/s.svs', label: 'S' });
    });

    it('polls a job to completion, reporting each phase on the way', async () => {
        apiGet
            .mockResolvedValueOnce({ state: 'running', phase: 'downloading', progress: 10 })
            .mockResolvedValueOnce({ state: 'running', phase: 'tiling', progress: 60 })
            .mockResolvedValueOnce({ state: 'done', phase: null, progress: 100 });
        const seen = [];
        const svc = createHostAssetService({ pluginId: 'pathology' });
        const { promise } = svc.pollJob('j1', { intervalMs: 0, onProgress: (s) => seen.push(s.phase) });
        expect((await promise).state).toBe('done');
        expect(seen).toEqual(['downloading', 'tiling', null]);
    });

    // A failed import is an ERROR to the caller, not a resolved promise
    // carrying a sad object: the editor's catch is what puts the reason in
    // front of the author.
    it('rejects with the server reason when an import fails', async () => {
        apiGet.mockResolvedValue({ state: 'failed', error: 'libvips could not read the slide' });
        const { promise } = createHostAssetService({ pluginId: 'pathology' }).pollJob('j1', { intervalMs: 0 });
        await expect(promise).rejects.toThrow(/libvips could not read the slide/);
    });

    it('can be told to stop polling', async () => {
        apiGet.mockResolvedValue({ state: 'running', phase: 'tiling' });
        const { promise, cancel } = createHostAssetService({ pluginId: 'pathology' }).pollJob('j1', { intervalMs: 0 });
        cancel();
        expect((await promise).state).toBe('cancelled');
    });

    it('removes and calibrates through the plugin\'s own routes', async () => {
        apiFetch.mockResolvedValue({ ok: true });
        const svc = createHostAssetService({ pluginId: 'pathology' });
        await svc.remove('asset 1');
        expect(apiFetch).toHaveBeenCalledWith('/plugins/pathology/assets/asset%201', { method: 'DELETE' });
        await svc.calibrate('a1', { nativeObjective: 20, nativeMpp: 0.5 });
        expect(apiFetch).toHaveBeenCalledWith('/plugins/pathology/assets/a1/calibration', {
            method: 'PUT', body: JSON.stringify({ nativeObjective: 20, nativeMpp: 0.5 }),
        });
    });
});
