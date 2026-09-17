// Regression lock: the server now strips `worklist[].rubric` and the text of
// every report with `released: false` from the PACS document a learner
// receives (manifest.document.learnerOmit / learnerOmitWhen). That is only
// safe if the room renders exactly the same thing from the stripped document
// as from the stored one — i.e. release is decided by the authored flag in
// `learnerDocument()`, never at run time from text the browser holds.
import { describe, it, expect } from 'vitest';
import { learnerDocument, readDocument } from '../../../src/components/pacs/caseDocument.js';
import { worklistProps } from '../../../src/plugins/pacs/index.jsx';
import { projectPluginDocumentsForRole } from '../../../server/shared/pluginDocument.js';
import { PLUGIN_MANIFESTS } from '../../../server/shared/plugins/manifests.generated.js';

const stored = () => ({
    version: 1,
    worklist: [
        {
            id: 'w1', studyId: 'ct_chest', description: 'CTPA', accession: 'RAD-1', availableAtMinutes: 30,
            baseline: { kind: 'remote', ref: 'remote:dicom/case42/base/' },
            substitutions: [],
            report: { findings: 'Filling defect.', impression: 'Acute PE.', reportedBy: 'Dr A', released: false },
            rubric: { expectedFindings: ['saddle embolus'] },
        },
        {
            id: 'w2', studyId: 'cxr', description: 'CXR',
            baseline: { kind: 'remote', ref: 'remote:dicom/case42/cxr/' },
            substitutions: [],
            report: { findings: 'Clear lungs.', impression: 'Normal.', reportedBy: 'Dr B', released: true },
        },
        {
            // Absent `released` means released (readEntry) — must NOT be withheld.
            id: 'w3', studyId: 'us', description: 'US',
            baseline: { kind: 'remote', ref: 'remote:dicom/case42/us/' },
            substitutions: [],
            report: { findings: 'Legacy report.', impression: 'Legacy.' },
        },
    ],
});

const forStudent = (doc) => projectPluginDocumentsForRole({ pacs: doc }, PLUGIN_MANIFESTS, 'student').pacs;

describe('PACS — the server-projected document renders the same room', () => {
    it('learnerDocument() is identical on the stored and the projected document', () => {
        const doc = stored();
        const projected = forStudent(doc);
        expect(JSON.stringify(projected)).not.toMatch(/saddle embolus|Filling defect|Acute PE|Dr A/);
        expect(projected.worklist[2].report.findings).toBe('Legacy report.');
        expect(learnerDocument(projected)).toEqual(learnerDocument(doc));
    });

    it('the worklist the room is handed is identical', () => {
        const ctx = (data) => ({ pluginId: 'pacs', data, archive: { entries: [] }, t: (k, f) => f ?? k });
        expect(worklistProps(ctx(forStudent(stored())))).toEqual(worklistProps(ctx(stored())));
    });

    it('the projected document still normalises (validate/summary paths stay total)', () => {
        const projected = readDocument(forStudent(stored()));
        expect(projected.worklist).toHaveLength(3);
        expect(projected.worklist[0].report).toEqual({ findings: '', impression: '', reportedBy: null, released: false });
    });
});
