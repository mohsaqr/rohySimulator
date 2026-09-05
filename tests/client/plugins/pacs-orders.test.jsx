/**
 * Regression lock: ordering a study in Radiology must produce IMAGES in PACS.
 *
 * The reported gap (v2.9.128): "pacs is nowhere accessible, you don't see its
 * results in the case". Two failures, one seam. A learner ordered a chest X-ray
 * in the Radiology room and (a) the PACS room did not appear at all unless an
 * educator had authored a pacs document into the case, and (b) even when it did
 * appear it never showed the ordered study — its worklist was built purely from
 * the authored document and knew nothing about what the learner had ordered.
 *
 * Radoyon's model already answered this: a case is *the catalogue, minus what
 * changed*, and `studyForOrder(doc, studyId, {archive})` is the rule. What was
 * missing was the host half — the session's imaging orders reaching the plugin,
 * and the name → catalogue-id join only rohy can do.
 *
 * Every test below fails against the un-fixed adapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import descriptor from '../../../src/plugins/pacs/index.jsx';
import { manifest } from '../../../src/plugins/pacs/manifest.js';
import { mergeOrderedStudies, imagingOrders } from '../../../src/plugins/pacs/hostImagingOrders.js';
import { createPluginContext } from '../../../src/plugins/context.js';
import { SOURCE_KIND, SUBSTITUTION_SCOPE } from '../../../src/components/pacs/caseDocument.js';

vi.mock('../../../src/plugins/pacs/hostArchive.js', () => ({
    fetchArchive: vi.fn(),
    fetchThumbnails: vi.fn(async () => () => null),
}));
vi.mock('../../../src/plugins/pacs/hostStudyCatalogue.js', () => ({
    fetchStudyCatalogue: vi.fn(),
}));

import { fetchArchive } from '../../../src/plugins/pacs/hostArchive.js';
import { fetchStudyCatalogue } from '../../../src/plugins/pacs/hostStudyCatalogue.js';

// --- fixtures ---------------------------------------------------------------

/** rohy's radiology catalogue, in the shape hostStudyCatalogue.js maps it to. */
const CATALOGUE = [
    { id: 'xray_chest_pa', name: 'Chest X-Ray (PA/Lateral)', modality: 'X-Ray', bodyRegion: 'Chest' },
    { id: 'ct_chest_noncon', name: 'CT Chest without Contrast', modality: 'CT', bodyRegion: 'Chest' },
    { id: 'mri_knee', name: 'MRI Knee', modality: 'MRI', bodyRegion: 'Knee' },
];

/**
 * The LEARNER projection of the archive — exactly the keys the manifest allows
 * a role below the authoring role to receive (`catalog.learnerKeys`). The
 * abnormal entry shares `xray_chest_pa` with the normal one on purpose: it is
 * the spoiler this join must never serve to a case that did not reference it.
 */
const ARCHIVE = {
    version: 1,
    entries: [
        {
            id: 'normal/xr_chest',
            studyId: 'xray_chest_pa',
            series: [{ key: 's3', description: 'PA', plane: 'frontal', instances: 2, ref: 'remote:dicom/normal/xr_chest/s3/' }],
        },
        {
            id: 'abnormal/xr_chest_pneumonia',
            studyId: 'xray_chest_pa',
            series: [{ key: 's1', description: 'PA', plane: 'frontal', instances: 2, ref: 'remote:dicom/abnormal/xr_chest_pneumonia/s1/' }],
        },
        {
            id: 'normal/ct_chest',
            studyId: 'ct_chest_noncon',
            series: [{ key: 's2', description: 'axial', plane: 'axial', instances: 6, ref: 'remote:dicom/normal/ct_chest/s2/' }],
        },
    ],
};

const order = (over = {}) => ({
    id: 101,
    studyName: 'Chest X-Ray (PA/Lateral)',
    modality: 'X-Ray',
    orderedAt: '2026-08-30T10:00:00Z',
    availableAt: '2026-08-30T10:01:00Z',
    ready: true,
    minutesRemaining: 0,
    ...over,
});

/** A case the author DID change: the chest CT carries a substituted series and
 *  a rubric. Nothing is said about the chest X-ray. */
const CHANGED_CT = {
    version: 1,
    worklist: [{
        id: 'w1',
        studyId: 'ct_chest_noncon',
        description: 'CT Chest',
        accession: 'RAD-000042',
        baseline: { kind: SOURCE_KIND.ARCHIVE, ref: 'normal/ct_chest' },
        substitutions: [{
            id: 'sub1',
            label: 'RUL nodule',
            scope: SUBSTITUTION_SCOPE.SERIES,
            targetSeriesKey: 's2',
            source: { kind: SOURCE_KIND.REMOTE, ref: 'remote:dicom/case42/nodule/' },
        }],
        report: { findings: '', impression: '', released: false },
        rubric: { expectedFindings: ['right upper lobe nodule'], keyImages: [3] },
    }],
};

const ctxFor = (over = {}) => ({
    pluginId: 'pacs',
    data: null,
    archive: ARCHIVE,
    studyCatalogue: CATALOGUE,
    orders: { imaging: [], loaded: true },
    log: vi.fn(),
    t: (key, fallback) => fallback ?? key,
    session: { examMode: false },
    ...over,
});

const persist = { state: {}, save: vi.fn() };

// --- 1. the join ------------------------------------------------------------

describe('PACS — the ordering join', () => {
    it('an ordered study the case says nothing about resolves to the archive NORMAL', () => {
        const { worklist } = descriptor.props(
            ctxFor({ orders: { imaging: [order()], loaded: true } }), persist,
        );

        expect(worklist).toHaveLength(1);
        const [study] = worklist;
        expect(study.studyId).toBe('xray_chest_pa');
        expect(study.description).toBe('Chest X-Ray (PA/Lateral)');
        expect(study.available).toBe(true);
        // Resolved onto THIS plugin's proxy mount, not left as a `remote:` name
        // the browser cannot fetch.
        expect(study.ref).toBe('/api/plugins/pacs/dicom/normal/xr_chest/s3');
        // The catalogue's department name became the DICOM code the worklist
        // badges — 'X-Ray' is not a modality any viewer knows.
        expect(study.modality).toBe('XR');
    });

    it('an order before its turnaround is pending, honestly labelled, and its images are withheld', () => {
        const { worklist } = descriptor.props(
            ctxFor({ orders: { imaging: [order({ ready: false, minutesRemaining: 4 })], loaded: true } }), persist,
        );

        expect(worklist).toHaveLength(1);
        const [study] = worklist;
        expect(study.available).toBe(false);
        expect(study.detail).toBe('Reporting — images not released yet');
        // Not merely un-clickable: nothing to fetch is in the props at all.
        expect(study.series).toEqual([]);
        expect(study.ref).toBeNull();
    });

    it('an ordered study with no archive backing is an honest row, not a dead one', () => {
        const { worklist } = descriptor.props(ctxFor({
            orders: { imaging: [order({ id: 7, studyName: 'MRI Knee', modality: 'MRI' })], loaded: true },
        }), persist);

        expect(worklist).toHaveLength(1);
        const [study] = worklist;
        expect(study.studyId).toBe('mri_knee');
        expect(study.available).toBe(false);
        expect(study.error).toBe(true);
        expect(study.detail).toBe('No images for this study');
    });

    it('an order for an educator’s custom study still gets a row', () => {
        const { worklist } = descriptor.props(ctxFor({
            orders: { imaging: [order({ id: 9, studyName: 'Departmental protocol view', modality: 'X-Ray' })], loaded: true },
        }), persist);

        expect(worklist).toHaveLength(1);
        expect(worklist[0].description).toBe('Departmental protocol view');
        expect(worklist[0].available).toBe(false);
        expect(worklist[0].detail).toBe('No images for this study');
    });

    it('a study that is both authored and ordered is ONE row, and it is the authored one', () => {
        const { worklist } = descriptor.props(ctxFor({
            data: CHANGED_CT,
            orders: { imaging: [order({ id: 5, studyName: 'CT Chest without Contrast', modality: 'CT' })], loaded: true },
        }), persist);

        expect(worklist).toHaveLength(1);
        const [study] = worklist;
        expect(study.id).toBe('w1');
        expect(study.studyId).toBe('ct_chest_noncon');
        // The author's substitution, not the archive's normal — the case wins.
        expect(study.ref).toBe('/api/plugins/pacs/dicom/case42/nodule');
        expect(study.series[0].origin).toBe('substitution');
    });

    it('an authored study the learner ordered but has not waited for is gated by the order', () => {
        const { worklist } = descriptor.props(ctxFor({
            data: CHANGED_CT,
            orders: { imaging: [order({ id: 5, studyName: 'CT Chest without Contrast', ready: false })], loaded: true },
        }), persist);

        expect(worklist).toHaveLength(1);
        expect(worklist[0].available).toBe(false);
        expect(worklist[0].series).toEqual([]);
    });

    it('authored studies nobody ordered are untouched', () => {
        const before = descriptor.props(ctxFor({ data: CHANGED_CT }), persist).worklist;
        expect(before).toHaveLength(1);
        expect(before[0].available).toBe(true);
        expect(before[0].detail).toBeUndefined();
    });

    it('two orders for the same study never make two rows', () => {
        const { worklist } = descriptor.props(ctxFor({
            orders: { imaging: [order({ id: 1 }), order({ id: 2 })], loaded: true },
        }), persist);
        expect(worklist).toHaveLength(1);
    });
});

// --- 2. availability --------------------------------------------------------

describe('PACS — availability', () => {
    it('the room is available on an ORDER alone, with no authored document', () => {
        expect(descriptor.available({ data: null, orders: { imaging: [order()], loaded: true } })).toBe(true);
    });

    it('a case with neither a document nor an order still declines', () => {
        expect(descriptor.available({ data: null, orders: { imaging: [], loaded: true } })).toBe(false);
        expect(descriptor.available({ data: null })).toBe(false);
        expect(descriptor.available({ data: { version: 1, worklist: [] } })).toBe(false);
    });

    it('is total: a malformed document or a malformed orders grant cannot throw', () => {
        expect(() => descriptor.available({ data: { worklist: 'nonsense' }, orders: 'nonsense' })).not.toThrow();
        expect(() => descriptor.available({ orders: { imaging: null } })).not.toThrow();
        expect(imagingOrders(undefined)).toEqual([]);
    });

    it('the fetches are gated on there being something to resolve', () => {
        const idle = descriptor.props(ctxFor(), persist);
        expect(idle.needsArchive).toBe(false);
        expect(idle.needsCatalogue).toBe(false);

        const ordered = descriptor.props(ctxFor({ orders: { imaging: [order()], loaded: true } }), persist);
        expect(ordered.needsArchive).toBe(true);
        expect(ordered.needsCatalogue).toBe(true);
    });
});

// --- 3. the answer key ------------------------------------------------------

describe('PACS — an order cannot reach the answer key', () => {
    it('an ordered study resolves to the NORMAL example even when the archive holds an abnormal one for it', () => {
        const { worklist } = descriptor.props(
            ctxFor({ orders: { imaging: [order()], loaded: true } }), persist,
        );
        const serialised = JSON.stringify(worklist);
        expect(worklist[0].ref).toContain('/normal/xr_chest');
        expect(serialised).not.toContain('abnormal');
        expect(serialised).not.toContain('pneumonia');
    });

    it('the rubric of a changed-and-ordered study never leaves the host', () => {
        const props = descriptor.props(ctxFor({
            data: CHANGED_CT,
            orders: { imaging: [order({ id: 5, studyName: 'CT Chest without Contrast' })], loaded: true },
        }), persist);
        const serialised = JSON.stringify(props);
        expect(serialised).not.toContain('rubric');
        expect(serialised).not.toContain('right upper lobe nodule');
    });

    it('the host grant carries no report text — only identity and turnaround', () => {
        // What a plugin requesting 'orders' is handed is built by the host; the
        // shape below is the whole of it. `result_data` (the case author's
        // configured findings) and `image_url` ride on the order row server-side
        // and must never be part of the grant.
        const ctx = createPluginContext({
            manifest,
            session: { id: 's1', role: 'student' },
            caseConfig: {},
            grants: { orders: { imaging: [order()], loaded: true } },
        });
        expect(Object.keys(ctx.orders.imaging[0]).sort()).toEqual([
            'availableAt', 'id', 'minutesRemaining', 'modality', 'orderedAt', 'ready', 'studyName',
        ]);
    });

    it('a plugin that never requested orders is given none', () => {
        const ctx = createPluginContext({
            manifest: { ...manifest, capabilities: ['persist'] },
            session: { id: 's1', role: 'student' },
            caseConfig: {},
            grants: { orders: { imaging: [order()], loaded: true } },
        });
        expect(ctx.orders).toBeNull();
    });
});

// --- 4. the wrapper ---------------------------------------------------------

describe('PacsRoomHost — the archive and catalogue land, then the worklist resolves', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.ResizeObserver = class { observe() {} disconnect() {} };
        fetchArchive.mockResolvedValue({ archive: ARCHIVE, unavailableReason: null });
        fetchStudyCatalogue.mockResolvedValue(CATALOGUE);
    });

    it('an ordered study appears once the two libraries have been fetched', async () => {
        // The context the descriptor is given at mount has NEITHER — exactly as
        // App.jsx builds it, synchronously — so the study can only appear if the
        // wrapper fetched them and re-ran the rule.
        const ctx = ctxFor({ archive: undefined, studyCatalogue: undefined, orders: { imaging: [order()], loaded: true } });
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;

        render(<Room {...props} />);
        await waitFor(() => {
            expect(fetchArchive).toHaveBeenCalledWith({ pluginId: 'pacs' });
            expect(fetchStudyCatalogue).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(screen.getAllByText('Chest X-Ray (PA/Lateral)').length).toBeGreaterThan(0);
        });
    });

    it('a case with no orders and no archive baseline fetches nothing', () => {
        const props = descriptor.props(ctxFor({ archive: undefined, studyCatalogue: undefined }), persist);
        const Room = descriptor.component;
        render(<Room {...props} />);
        expect(fetchArchive).not.toHaveBeenCalled();
        expect(fetchStudyCatalogue).not.toHaveBeenCalled();
    });
});

// --- 5. the merge in isolation ---------------------------------------------

describe('mergeOrderedStudies', () => {
    it('is a no-op when nothing was ordered', () => {
        const authored = [{ id: 'w1', studyId: 'ct_chest_noncon', available: true }];
        expect(mergeOrderedStudies({ authored, doc: { worklist: [] }, archive: ARCHIVE, orders: [] }))
            .toEqual(authored);
    });
});
