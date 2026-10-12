// A plugin's `remote:` references become addresses the browser loads directly
// (<img src>, tile sources), so they must carry the base path the app is
// served under, exactly as apiFetch's do.
import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadUnder(base) {
    vi.resetModules();
    vi.stubEnv('BASE_URL', base);
    return import('./context.js');
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('remote references under a base path', () => {
    it('carries the base path an install is served under', async () => {
        // Regression lock: a host served at /rohy/ handed out /api/plugins/... and every slide was a 404
        const { resolveRemoteRef } = await loadUnder('/rohy/');
        expect(resolveRemoteRef('remote:library/asset-1/slide.dzi', 'pathology'))
            .toBe('/rohy/api/plugins/pathology/library/asset-1/slide.dzi');
    });

    it('is unchanged at the root', async () => {
        const { resolveRemoteRef } = await loadUnder('/');
        expect(resolveRemoteRef('remote:tiles/a b.dzi', 'pathology')).toBe('/api/plugins/pathology/tiles/a%20b.dzi');
    });

    it('round-trips, and reads back an address saved without the base path', async () => {
        const { resolveRemoteRef, unresolveRemoteRef } = await loadUnder('/rohy/');
        const ref = 'remote:tiles/case 42/slide+1.dzi';
        expect(unresolveRemoteRef(resolveRemoteRef(ref, 'pathology'), 'pathology')).toBe(ref);
        expect(unresolveRemoteRef('/api/plugins/pathology/tiles/x.dzi', 'pathology')).toBe('remote:tiles/x.dzi');
        expect(unresolveRemoteRef('/rohy/api/plugins/pacs/x', 'pathology'), 'another plugin is left alone')
            .toBe('/rohy/api/plugins/pacs/x');
    });
});
