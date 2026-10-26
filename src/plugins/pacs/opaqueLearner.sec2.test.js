// The PACS room still works on SEALED references (security audit 2026-10-26, F-25).
//
// Regression lock: a learner's archive and case document named the finding
// (`abnormal/rul_nodule`, `remote:dicom/abnormal/…`). The server now seals
// both (server/lib/pluginOpaqueRefs.js); this pins that the room resolves a
// sealed baseline, loads sealed series through the proxy, and still serves a
// plain order the NORMAL example — never an abnormal one the case did not pick.
import { describe, it, expect, vi } from 'vitest';
import { worklistProps } from './index.jsx';
import { SOURCE_KIND } from '../../components/pacs/caseDocument.js';

process.env.JWT_SECRET = 'sec2-e1-client';
const { opaqueArchiveId, opaqueRemoteRef, opaqueLearnerDocument } = await import('../../../server/lib/pluginOpaqueRefs.js');

/** What GET /api/plugins/pacs/catalog hands a learner (routes/plugins-routes.js learnerCatalogItem). */
const learnerEntry = (id, studyId, seriesRef) => ({
    id: opaqueArchiveId('pacs', id),
    ...(id.startsWith('abnormal/') ? {} : { studyId }),
    label: '',
    series: [{ key: 's1', plane: 'axial', instances: 2, frames: 2, ref: opaqueRemoteRef('pacs', seriesRef) }],
});

const ARCHIVE = {
    version: 1,
    entries: [
        learnerEntry('normal/ct_chest', 'ct_chest_noncon', 'remote:dicom/normal/ct_chest/s1/'),
        learnerEntry('abnormal/rul_nodule', 'ct_chest_noncon', 'remote:dicom/abnormal/rul_nodule/s1/'),
        learnerEntry('abnormal/xr_portable_covid', 'xray_chest_portable', 'remote:dicom/abnormal/xr_portable_covid/s1/'),
    ],
};

const CATALOGUE = [
    { id: 'ct_chest_noncon', name: 'CT Chest without Contrast', modality: 'CT' },
    { id: 'xray_chest_portable', name: 'Chest X-Ray (Portable)', modality: 'X-Ray' },
];

const DOC = opaqueLearnerDocument('pacs', {
    version: 1,
    worklist: [{
        id: 'w1', studyId: 'ct_chest_noncon', description: 'CT Chest', accession: 'RAD-1',
        baseline: { kind: SOURCE_KIND.ARCHIVE, ref: 'abnormal/rul_nodule' },
        substitutions: [],
        report: { findings: '', impression: '', released: false },
    }],
});

const order = (studyName) => ({
    id: 7, studyName, modality: 'X-Ray', orderedAt: '2026-10-26T10:00:00Z',
    availableAt: '2026-10-26T10:01:00Z', ready: true, minutesRemaining: 0,
});

const ctx = (over = {}) => ({
    pluginId: 'pacs', data: DOC, archive: ARCHIVE, studyCatalogue: CATALOGUE,
    orders: { imaging: [], loaded: true }, log: vi.fn(), t: (k, f) => f ?? k, session: { examMode: false },
    ...over,
});

describe('PACS on sealed references', () => {
    it('resolves a sealed archive baseline to sealed, loadable series — naming nothing', () => {
        const { worklist } = worklistProps(ctx());
        expect(worklist).toHaveLength(1);
        const [study] = worklist;
        expect(study.available).toBe(true);
        expect(study.ref).toMatch(/^\/api\/plugins\/pacs\/_o\/[0-9a-f]+$/);
        expect(study.description).toBe('CT Chest');
        expect(JSON.stringify(worklist)).not.toMatch(/abnormal|rul_nodule|dicom\//);
    });

    it('a plain order never opens an abnormal example the case did not choose', () => {
        const { worklist } = worklistProps(ctx({ data: null, orders: { imaging: [order('Chest X-Ray (Portable)')], loaded: true } }));
        expect(worklist).toHaveLength(1);
        // Only an abnormal entry exists for this study: it must not be served.
        expect(worklist[0].available).toBe(false);
    });
});
