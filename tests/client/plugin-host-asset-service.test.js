// The slide library on a host (RPS-1 §7a.1): catalog relayed by rohy, handed to
// the editor RESOLVED; the case leaves the editor UN-resolved. Regression lock
// for "the slides library is empty" — the adapter passed no assetService.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/apiClient', () => ({
    apiFetch,
    ApiError: class ApiError extends Error { constructor(status) { super(`http ${status}`); this.status = status; } },
}));

const { resolveRemoteRefs, unresolveRemoteRefs, unresolveRemoteRef } = await import('../../src/plugins/context.js');
const { createHostAssetService } = await import('../../src/plugins/hostAssetService.js');
const { ApiError } = await import('../../src/services/apiClient');
const descriptor = (await import('../../src/plugins/pathology/index.jsx')).default;

const CATALOG = { version: 1, assets: [{ id: 'a', status: 'ready', preview: { url: 'remote:tiles/previews/a.jpg', widthPx: 1, heightPx: 1 },
    revisions: [{ id: 'r', status: 'ready', derivatives: { dzi: { url: 'remote:tiles/a.dzi' } } }] }] };

beforeEach(() => apiFetch.mockReset());

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
        const svc = createHostAssetService({ pluginId: 'pathology' });
        expect(svc.available).toBe(false);
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
