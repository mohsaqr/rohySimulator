// Regression lock: the default STEMI case had no ECG document, so the ECG room was empty and the on-call cardiologist had nothing to report; the server seeds a precompiled literal (it may not import src/), and this test rebuilds it from the engine and fails on drift (Phase 4, 2026-10-04)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildStemiEcgDocument, renderStemiEcgModule, OUTPUT } from '../../scripts/generate-stemi-ecg.mjs';
import { STEMI_V2_ECG } from '../../server/seeders/stemiV2Ecg.js';
import { case_document_issues } from '../../src/components/ecg/caseDocument.js';
import { FINDING_IDS } from '../../src/components/ecg/constants.js';

describe('the default case ECG', () => {
    it('is exactly what the generator builds from the engine (run node scripts/generate-stemi-ecg.mjs)', () => {
        expect(readFileSync(OUTPUT, 'utf8')).toBe(renderStemiEcgModule(buildStemiEcgDocument()));
    });

    it('passes the ECG engine validator', () => {
        expect(case_document_issues(STEMI_V2_ECG)).toEqual([]);
    });

    it('has reciprocal inferior change and no Q waves yet', () => {
        const { channels } = STEMI_V2_ECG.manifest.recordings[0].render_spec.morphology;
        // III = II - I and aVF = II - I/2 are derived by the engine.
        expect(channels.II.st - channels.I.st).toBeLessThan(-0.15);
        expect(channels.II.st - channels.I.st / 2).toBeLessThan(-0.1);
        expect(channels.V2.st).toBeGreaterThan(0.2);
        expect(Math.abs(channels.V2.q)).toBeLessThan(0.05);
        expect(Math.abs(channels.V3.q)).toBeLessThan(0.05);
    });

    it('rubric findings are known ids, and the cardiologist has text to give', () => {
        const activity = STEMI_V2_ECG.rubric.activities[0];
        for (const id of activity.expected.finding_ids) expect(FINDING_IDS, id).toContain(id);
        expect(activity.findings.length).toBeGreaterThan(0);
        expect(activity.findings.every((f) => typeof f.text === 'string' && f.text.length > 10)).toBe(true);
    });

    it('names nothing in what the learner receives (the manifest)', () => {
        expect(JSON.stringify(STEMI_V2_ECG.manifest)).not.toMatch(/STEMI|infarct|LAD|injury|elevation/i);
    });
});
