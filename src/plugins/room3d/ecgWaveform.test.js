import { describe, it, expect } from 'vitest';
import {
    SAMPLE_INTERVAL_MS,
    SAMPLE_RATE_HZ,
    GenerateECGRaw,
    cardiacIntervals,
    createEcgSampler,
} from './ecgWaveform.js';

// Count separated runs of samples above a threshold (R-wave clusters).
function countClusters(samples, threshold) {
    let clusters = 0;
    let inside = false;
    samples.forEach((value) => {
        if (value > threshold && !inside) {
            clusters += 1;
            inside = true;
        } else if (value <= threshold) {
            inside = false;
        }
    });
    return clusters;
}

describe('cardiacIntervals', () => {
    it('derives physiologic, bounded intervals from heart rate', () => {
        const at60 = cardiacIntervals(60);
        expect(at60.RR).toBe(1000);
        expect(at60.PR).toBeCloseTo(176.7 - 0.351 * 60, 5);
        expect(at60.QRS).toBe(90);
        expect(at60.QT).toBeCloseTo(400, 5); // Fridericia at RR = 1 s

        const at180 = cardiacIntervals(180);
        expect(at180.PR).toBeGreaterThanOrEqual(110);
        expect(at180.PR).toBeLessThanOrEqual(at180.RR * 0.4);
        expect(at180.QT).toBeGreaterThanOrEqual(at180.QRS + 80);

        // Clamping guards nonsense input
        expect(cardiacIntervals(0).RR).toBe(1000); // falls back to HR 60
        expect(cardiacIntervals(1000).RR).toBe(60000 / 220);
    });
});

describe('GenerateECGRaw', () => {
    it('places the dominant R peak at PR+30 ms in sinus rhythm', () => {
        const { RR, PR } = cardiacIntervals(60);
        const at_r = GenerateECGRaw((PR + 30) / RR, { hr: 60 });
        const diastole = GenerateECGRaw(0.95, { hr: 60 });
        expect(at_r).toBeGreaterThan(0.9);
        expect(Math.abs(diastole)).toBeLessThan(0.05);
    });

    it('renders asystole as a near-flat line', () => {
        const samples = Array.from({ length: 200 }, () => GenerateECGRaw(0, { isAsystole: true }));
        samples.forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(0.01));
    });

    it('renders VT with a taller, wider complex than sinus', () => {
        const { RR, PR } = cardiacIntervals(160);
        const vt_r = GenerateECGRaw((PR + 30) / RR, { hr: 160, isVtach: true });
        expect(vt_r).toBeGreaterThan(1.1);
    });
});

describe('createEcgSampler', () => {
    const runSeconds = (sampler, seconds) => {
        return Array.from(
            { length: Math.round(seconds * SAMPLE_RATE_HZ) },
            () => sampler.step(SAMPLE_INTERVAL_MS),
        );
    };

    it('produces twice as many R waves at HR 120 as at HR 60', () => {
        const slow = countClusters(runSeconds(createEcgSampler(() => ({ hr: 60, rhythm: 'NSR' })), 4), 0.8);
        const fast = countClusters(runSeconds(createEcgSampler(() => ({ hr: 120, rhythm: 'NSR' })), 4), 0.8);
        // The first beat always runs at the 750 ms warm-up duration, so allow +1.
        expect(slow).toBeGreaterThanOrEqual(4);
        expect(slow).toBeLessThanOrEqual(5);
        expect(fast).toBeGreaterThanOrEqual(8);
        expect(fast).toBeLessThanOrEqual(9);
    });

    it('flatlines in asystole and when the feed reports no heart rate', () => {
        runSeconds(createEcgSampler(() => ({ hr: 0, rhythm: 'Asystole' })), 1)
            .forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(0.01));
        runSeconds(createEcgSampler(() => ({ hr: '?', rhythm: 'NSR' })), 1)
            .forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(0.01));
    });

    it('produces continuous coarse activity in VFib with no organised R waves', () => {
        const samples = runSeconds(createEcgSampler(() => ({ hr: 0, rhythm: 'VFib' })), 1);
        const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
        expect(variance).toBeGreaterThan(0.02);
        expect(countClusters(samples, 0.9)).toBe(0);
    });

    it('survives a feed that returns nothing', () => {
        const sampler = createEcgSampler(() => null);
        expect(() => sampler.step(SAMPLE_INTERVAL_MS)).not.toThrow();
    });
});
