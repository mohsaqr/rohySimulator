import { describe, expect, it } from 'vitest';
import { DASH, fmtIqr, fmtMedian, fmtMedianIqr, fmtPct, fmtSeconds } from './signalFormat.js';
import { summarize } from './signalStats.js';

describe('signalFormat', () => {
    it('splits a summary into its median and its IQR', () => {
        const s = summarize([120, 200]); // median 160, q1 140, q3 180 (type 7)
        expect(fmtMedian(s)).toBe('160');
        expect(fmtIqr(s)).toBe('IQR 140–180');
        expect(fmtMedianIqr(s)).toBe('160 (140–180)');
    });

    it('shows no IQR when there is no spread, and a dash when there is no median', () => {
        expect(fmtIqr(summarize([5]))).toBeNull();
        expect(fmtIqr(summarize([3, 3]))).toBeNull();
        expect(fmtIqr(summarize([]))).toBeNull();
        expect(fmtMedian(summarize([]))).toBe(DASH);
    });

    it('carries units through the formatter', () => {
        const s = summarize([0.4, 0.7]);
        expect(fmtMedian(s, (v) => fmtPct(v))).toBe('55%');
        expect(fmtIqr(s, (v) => fmtPct(v))).toBe('IQR 48%–63%');
        expect(fmtSeconds(4200)).toBe('4.2 s');
    });
});
