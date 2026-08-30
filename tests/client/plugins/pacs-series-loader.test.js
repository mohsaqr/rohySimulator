/**
 * The host's series loader, against BOTH index shapes an archive ships.
 *
 * Regression lock, found by driving the real content origin: every study in
 * the archive failed to open with
 *
 *   "The series index for … contains an invalid instance name: [object Object]"
 *
 * because `index.json` v2 lists instance OBJECTS (`{name, instanceNumber,
 * position, orientation}` — the metadata the lazy path needs to build an
 * ordered, measurable stack without pixels) while this loader only ever
 * accepted v1's bare filenames. The package's own `fromIndex()` already read
 * either, so the two halves of the same contract disagreed and the reader was
 * shown a study that could not be opened.
 */
import { describe, it, expect, vi } from 'vitest';

import { createHostSeriesLoader, createHostLazyLoaders } from '../../../src/plugins/pacs/hostSeriesLoader.js';

const DICOM = new Uint8Array([1, 2, 3, 4]);

/** A fetch that serves one index and one instance, and records what was asked for. */
function fakeFetch(index) {
    const asked = [];
    const impl = vi.fn(async (url) => {
        asked.push(String(url));
        if (String(url).endsWith('/index.json')) {
            return { ok: true, status: 200, json: async () => index };
        }
        return { ok: true, status: 200, arrayBuffer: async () => DICOM.buffer.slice(0) };
    });
    return { impl, asked };
}

describe('createHostSeriesLoader — both index shapes', () => {
    it('reads a v1 index of bare filenames', async () => {
        const { impl, asked } = fakeFetch({ instances: ['000.dcm', '001.dcm'] });
        const load = createHostSeriesLoader({ pluginId: 'pacs', fetchImpl: impl });
        const files = await load('remote:dicom/normal/xr_chest/s3/');

        expect(files).toHaveLength(2);
        expect(asked).toContain('/api/plugins/pacs/dicom/normal/xr_chest/s3/index.json');
        expect(asked).toContain('/api/plugins/pacs/dicom/normal/xr_chest/s3/000.dcm');
    });

    it('reads a v2 index of instance objects — the shape the real archive ships', async () => {
        const { impl, asked } = fakeFetch({
            version: 2,
            seriesInstanceUid: '1.2.3',
            instances: [
                { name: '000.dcm', instanceNumber: 1, position: null, orientation: null },
                { name: '001.dcm', instanceNumber: 2, position: null, orientation: null },
            ],
        });
        const load = createHostSeriesLoader({ pluginId: 'pacs', fetchImpl: impl });
        const files = await load('remote:dicom/normal/xr_chest/s3/');

        expect(files).toHaveLength(2);
        expect(asked).toContain('/api/plugins/pacs/dicom/normal/xr_chest/s3/001.dcm');
    });

    it('still refuses an index that names a path rather than a file', async () => {
        // A broken archive must be reported as one, not turned into a wall of
        // 403s from the proxy — so the guard survives the shape change.
        const { impl } = fakeFetch({ instances: [{ name: '../secret.dcm' }] });
        const load = createHostSeriesLoader({ pluginId: 'pacs', fetchImpl: impl });
        await expect(load('remote:dicom/x/s1/')).rejects.toThrow(/invalid instance name/);
    });
});

describe('createHostLazyLoaders', () => {
    it('returns the index verbatim and one instance as bytes', async () => {
        const index = { version: 2, instances: [{ name: '000.dcm', instanceNumber: 1 }] };
        const { impl, asked } = fakeFetch(index);
        const { loadSeriesIndex, loadInstance } = createHostLazyLoaders({ pluginId: 'pacs', fetchImpl: impl });

        // Verbatim: the package's fromIndex() reads the geometry off it, and an
        // allowlist normaliser here would silently drop fields it did not know.
        expect(await loadSeriesIndex('remote:dicom/x/s1/')).toEqual(index);

        const bytes = await loadInstance('remote:dicom/x/s1/', '000.dcm');
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(asked).toContain('/api/plugins/pacs/dicom/x/s1/000.dcm');

        await expect(loadInstance('remote:dicom/x/s1/', '../secret')).rejects.toThrow(/Invalid instance name/);
    });
});
