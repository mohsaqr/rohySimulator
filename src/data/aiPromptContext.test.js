// Lock the AI prompt context formatters. These formatters feed three new
// sections into the patient AI's system prompt:
//   - ### Radiology Studies (gated by aiAccess.radiology)
//   - ## CURRENT PATIENT STATE (live vitals, always sent if any vital is set)
//   - ## SESSION ACTIVITY SO FAR (recent PatientRecord events, capped at 10)
//
// Each test below pins one observable behaviour. Regression-lock comments
// flag the prompt-shape contract that downstream LLM behaviour depends on.

import { describe, expect, it } from 'vitest';
import {
    formatRadiologyAsMarkdown,
    formatVitalsAsMarkdown,
    formatRecentActivityAsMarkdown,
} from './aiPromptContext.js';

describe('formatRadiologyAsMarkdown', () => {
    it('renders study type, name, and date in the header line', () => {
        const md = formatRadiologyAsMarkdown([
            { type: 'CXR', name: 'PA + Lateral', date: '2026-05-01' },
        ]);
        expect(md).toBe('- CXR · PA + Lateral · 2026-05-01');
    });

    it('appends findings and interpretation under the header', () => {
        const md = formatRadiologyAsMarkdown([
            { type: 'CT chest', findings: 'No PE', interpretation: 'Negative for embolism' },
        ]);
        expect(md).toContain('- CT chest');
        expect(md).toContain('Findings: No PE');
        expect(md).toContain('Interpretation: Negative for embolism');
    });

    it('omits the imageUrl entirely (binary asset, useless to a text model)', () => {
        const md = formatRadiologyAsMarkdown([
            { type: 'CXR', imageUrl: 'https://example.com/cxr-1.png' },
        ]);
        expect(md).not.toContain('imageUrl');
        expect(md).not.toContain('example.com');
    });

    it('returns empty string for missing/empty/non-array input', () => {
        expect(formatRadiologyAsMarkdown(null)).toBe('');
        expect(formatRadiologyAsMarkdown(undefined)).toBe('');
        expect(formatRadiologyAsMarkdown([])).toBe('');
        expect(formatRadiologyAsMarkdown('not an array')).toBe('');
    });

    it('falls back to "Imaging study" when type is missing', () => {
        const md = formatRadiologyAsMarkdown([{ findings: 'Mass at L3' }]);
        expect(md).toContain('Imaging study');
    });
});

describe('formatVitalsAsMarkdown', () => {
    it('renders BP as sys/dia mmHg when both are finite', () => {
        const md = formatVitalsAsMarkdown({ bp_sys: 120, bp_dia: 80 });
        expect(md).toContain('- Blood pressure: 120/80 mmHg');
    });

    it('skips BP when only one of sys/dia is set (avoids "120/null")', () => {
        const md = formatVitalsAsMarkdown({ bp_sys: 120 });
        expect(md).not.toContain('Blood pressure');
    });

    it('renders each populated vital with its unit', () => {
        const md = formatVitalsAsMarkdown({
            hr: 92, rr: 18, spo2: 96, temp: 37.5, pain: 7,
        });
        expect(md).toContain('Heart rate: 92 bpm');
        expect(md).toContain('Respiratory rate: 18 /min');
        expect(md).toContain('SpO₂: 96 %');
        expect(md).toContain('Temperature: 37.5 °C');
        expect(md).toContain('Pain: 7 /10');
    });

    it('skips null/undefined vital slots without crashing', () => {
        const md = formatVitalsAsMarkdown({ hr: 92, rr: null, spo2: undefined, temp: 36.6, pain: null });
        expect(md).toContain('Heart rate: 92 bpm');
        expect(md).toContain('Temperature: 36.6 °C');
        expect(md).not.toContain('Respiratory rate');
        expect(md).not.toContain('SpO₂');
        expect(md).not.toContain('Pain:');
    });

    it('returns empty string for null/non-object input or all-null vitals', () => {
        expect(formatVitalsAsMarkdown(null)).toBe('');
        expect(formatVitalsAsMarkdown(undefined)).toBe('');
        expect(formatVitalsAsMarkdown({})).toBe('');
        expect(formatVitalsAsMarkdown({ hr: null, bp_sys: null, bp_dia: null })).toBe('');
    });
});

describe('formatRecentActivityAsMarkdown', () => {
    it('caps output at the last `limit` events to bound prompt size', () => {
        const events = Array.from({ length: 25 }, (_, i) => ({
            verb: 'OBTAINED', category: 'hpi', content: `evt-${i}`, time: i,
        }));
        const md = formatRecentActivityAsMarkdown(events, 5);
        expect(md.split('\n')).toHaveLength(5);
        // The last 5, in order — should include evt-24 and not evt-19.
        expect(md).toContain('evt-24');
        expect(md).not.toContain('evt-19');
    });

    it('renders OBTAINED with category and truncated content', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'OBTAINED', category: 'hpi', content: 'sudden chest pain radiating to left arm', time: 3 },
        ]);
        expect(md).toContain('[t+3m]');
        expect(md).toContain('obtained history (hpi)');
        expect(md).toContain('sudden chest pain');
    });

    it('renders EXAMINED with region and technique', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'EXAMINED', region: 'cardiac', technique: 'auscultation', time: 5 },
        ]);
        expect(md).toContain('examined cardiac via auscultation');
    });

    it('renders ELICITED with test name and value+unit', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'ELICITED', test_name: 'troponin', value: 0.45, unit: 'ng/mL', time: 12 },
        ]);
        expect(md).toContain('elicited troponin = 0.45 ng/mL');
    });

    it('renders ORDERED and ADMINISTERED with item and dose/route', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'ORDERED', category: 'medication', item: 'aspirin 325mg PO', time: 4 },
            { verb: 'ADMINISTERED', item: 'aspirin', dose: '325mg', route: 'PO', time: 6 },
        ]);
        expect(md).toContain('ordered medication: aspirin 325mg PO');
        expect(md).toContain('administered aspirin 325mg PO');
    });

    it('falls back to verb name when verb is unknown', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'TELEPORTED', time: 1 },
        ]);
        expect(md).toContain('TELEPORTED');
    });

    it('uses em-dash when event has no time field', () => {
        const md = formatRecentActivityAsMarkdown([
            { verb: 'OBTAINED', category: 'hpi' },
        ]);
        expect(md).toContain('[—]');
    });

    it('returns empty string for empty/non-array input', () => {
        expect(formatRecentActivityAsMarkdown(null)).toBe('');
        expect(formatRecentActivityAsMarkdown([])).toBe('');
        expect(formatRecentActivityAsMarkdown('nope')).toBe('');
    });
});
