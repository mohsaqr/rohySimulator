/**
 * The learner's half of the same missing wire.
 *
 * A case entry says `baseline: { kind: 'archive', ref: 'normal/ct_chest' }` —
 * which is exactly what the editor's "Wire imaging" writes — and only the host
 * can turn that id into the series a viewer opens. Nothing ever put an archive
 * into the plugin context, so `resolveEntry()` was handed zero baseline series
 * and every archive-backed study rendered as an unclickable, unexplained
 * "Pending". Authoring and reading were broken at the same seam.
 *
 * These are regression locks: each fails against the un-fixed adapter, where
 * the descriptor exposed neither `needsArchive` nor `resolveWorklist` and the
 * room component never fetched anything.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import descriptor, { documentNeedsArchive } from '../../../src/plugins/pacs/index.jsx';

// The room itself is not under test here — what it is HANDED is. Stubbing it
// keeps this test off the DICOM pipeline (which pacs-room.test.jsx drives end
// to end) and makes the assertion the worklist, exactly.
const seen = { worklist: null };
vi.mock('../../../src/plugins/pacs/PacsRoom.jsx', () => ({
    PacsRoom: ({ worklist }) => { seen.worklist = worklist; return <div data-testid="room" />; },
}));

/** What the relay serves a LEARNER: ids and series, nothing else. */
const LEARNER_ARCHIVE = {
    version: 1,
    entries: [{
        id: 'normal/ct_chest_adult_m',
        studyId: 'ct_chest',
        series: [{
            key: 's2', description: 'AXIAL CHEST', plane: 'axial', instances: 240,
            ref: 'remote:dicom/normal/ct_chest_adult_m/s2/',
        }],
    }],
};

const ARCHIVE_BASELINE_CASE = {
    version: 1,
    worklist: [{
        id: 'w1',
        studyId: 'ct_chest',
        description: 'CT Chest',
        accession: 'RAD-000042',
        baseline: { kind: 'archive', ref: 'normal/ct_chest_adult_m' },
        substitutions: [],
        report: { findings: '', impression: '', released: false },
    }],
};

const REMOTE_BASELINE_CASE = {
    version: 1,
    worklist: [{
        id: 'w2',
        studyId: 'ct_head',
        description: 'CT Head',
        baseline: { kind: 'remote', ref: 'remote:dicom/case43/head/' },
        substitutions: [],
        report: { findings: '', impression: '', released: false },
    }],
};

function ctxFor(data) {
    return { pluginId: 'pacs', data, eventLogger: { log: vi.fn() }, t: (k, f) => f ?? k };
}

function stubCatalog(archive) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: archive !== null,
        status: archive !== null ? 200 : 503,
        headers: { get: () => 'application/json' },
        json: async () => (archive !== null
            ? { plugin: 'pacs', catalog: archive }
            : { error: 'no origin', code: 'plugin_remote_not_configured' }),
        text: async () => '',
    })));
}

afterEach(() => { vi.unstubAllGlobals(); seen.worklist = null; });

describe('documentNeedsArchive', () => {
    it('is true only when the document names an archive entry', () => {
        expect(documentNeedsArchive(ARCHIVE_BASELINE_CASE)).toBe(true);
        // A case built entirely from `remote:` references resolves from the
        // document alone; asking for a catalogue it will not read would put an
        // extra request in front of every learner opening the room.
        expect(documentNeedsArchive(REMOTE_BASELINE_CASE)).toBe(false);
        expect(documentNeedsArchive(null)).toBe(false);
        expect(() => documentNeedsArchive({ worklist: 'nonsense' })).not.toThrow();
    });
});

describe('PACS room — the archive is resolved before the learner sees the worklist', () => {
    const persist = { state: {}, save: vi.fn() };

    it('an archive baseline is unresolvable without the archive, and resolvable with it', () => {
        const props = descriptor.props(ctxFor(ARCHIVE_BASELINE_CASE), persist);
        // Before: nothing to open — the "Pending" study that was reported.
        expect(props.worklist[0].available).toBe(false);
        expect(props.needsArchive).toBe(true);

        // The descriptor hands over the RULE, not a second copy of it, so the
        // room and the editor cannot disagree about what a learner sees.
        const resolved = props.resolveWorklist(LEARNER_ARCHIVE);
        expect(resolved[0].available).toBe(true);
        expect(resolved[0].ref).toBe('/api/plugins/pacs/dicom/normal/ct_chest_adult_m/s2');
        expect(resolved[0].series[0].origin).toBe('baseline');
    });

    it('the room fetches the archive and re-resolves, so the study becomes openable', async () => {
        stubCatalog(LEARNER_ARCHIVE);
        const Room = descriptor.component;
        render(<Room {...descriptor.props(ctxFor(ARCHIVE_BASELINE_CASE), persist)} />);

        expect(seen.worklist[0].available).toBe(false);   // the first paint
        await waitFor(() => expect(seen.worklist[0].available).toBe(true));
        expect(global.fetch.mock.calls[0][0]).toContain('/api/plugins/pacs/catalog');
    });

    it('an unreachable archive leaves the worklist alone rather than emptying it', async () => {
        stubCatalog(null);
        const Room = descriptor.component;
        render(<Room {...descriptor.props(ctxFor(ARCHIVE_BASELINE_CASE), persist)} />);

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        // The study is still listed, still named, and still honestly marked
        // unavailable — the series loader says why when anyone opens it.
        expect(seen.worklist).toHaveLength(1);
        expect(seen.worklist[0].description).toBe('CT Chest');
        expect(seen.worklist[0].available).toBe(false);
    });

    it('a case with no archive baseline makes no request at all', async () => {
        stubCatalog(LEARNER_ARCHIVE);
        const Room = descriptor.component;
        render(<Room {...descriptor.props(ctxFor(REMOTE_BASELINE_CASE), persist)} />);

        await waitFor(() => expect(seen.worklist[0].available).toBe(true));
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
