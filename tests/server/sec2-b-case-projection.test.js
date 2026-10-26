// Regression lock: a learner's copy of a case carried plugin content paths that name the finding (`remote:dicom/abnormal/rul_nodule/…`, an archive baseline `abnormal/…`, a slide `remote:tiles/<finding>.dzi`); the learner projection now seals them (security audit 2026-10-26, F-25 — lane E1's helper, lane B's projection)

import { describe, expect, it } from 'vitest';
import { projectCaseConfigForRole, projectCaseSnapshotForRole } from '../../server/services/caseProjection.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

const config = () => ({
    patient_name: 'P',
    pacs: {
        baseline: { kind: 'archive', ref: 'abnormal/rul_nodule' },
        series: [{ src: 'remote:dicom/abnormal/rul_nodule/s1/' }],
    },
    pathology: { slides: [{ src: 'remote:tiles/finding-adenocarcinoma.dzi' }] },
});

describe('sec2 lane B — learner case documents use sealed content references', () => {
    it('a learner never receives a real remote path or archive id (Regression lock: F-25)', () => {
        const out = projectCaseConfigForRole(config(), PLUGIN_MANIFESTS, 'student');
        const text = JSON.stringify(out);
        expect(text).not.toContain('abnormal');
        expect(text).not.toContain('adenocarcinoma');
        const remotes = text.match(/remote:[^"]*/g) || [];
        expect(remotes.length).toBeGreaterThan(0);
        expect(remotes.every((r) => r.startsWith('remote:_o/'))).toBe(true);
        expect(out.patient_name).toBe('P');
    });

    it('the session snapshot is sealed the same way', () => {
        const snap = projectCaseSnapshotForRole({ config: config() }, PLUGIN_MANIFESTS, 'student');
        expect(JSON.stringify(snap)).not.toContain('abnormal');
    });

    it('authors and reviewers keep the real references', () => {
        for (const role of ['reviewer', 'educator', 'admin']) {
            const out = projectCaseConfigForRole(config(), PLUGIN_MANIFESTS, role);
            expect(out.pacs.series[0].src, role).toBe('remote:dicom/abnormal/rul_nodule/s1/');
            expect(out.pacs.baseline.ref, role).toBe('abnormal/rul_nodule');
        }
    });
});
