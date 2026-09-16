import { describe, expect, it } from 'vitest';
import { formatTick, niceAxis, niceStep, stepDecimals } from './chartAxis.js';

describe('niceStep', () => {
    it('rounds to 1, 2 or 5 times a power of ten', () => {
        expect(niceStep(100, 4)).toBe(50);
        expect(niceStep(80, 4)).toBe(20);
        expect(niceStep(1.3, 4)).toBe(0.5);
        expect(niceStep(34, 3)).toBe(20);
        expect(niceStep(10, 10)).toBe(1);
    });
    it('falls back to 1 for a zero or non-finite span', () => {
        expect(niceStep(0)).toBe(1);
        expect(niceStep(Number.NaN)).toBe(1);
    });
});

describe('stepDecimals', () => {
    it('uses only the decimals the step needs', () => {
        expect(stepDecimals(20)).toBe(0);
        expect(stepDecimals(0.5)).toBe(1);
        expect(stepDecimals(0.25)).toBe(2);
        expect(stepDecimals(0.1 + 0.2 - 0.1)).toBe(1); // float noise does not add digits
    });
});

describe('niceAxis', () => {
    it('widens to round bounds and ticks every step', () => {
        const axis = niceAxis(12, 87, { count: 4 });
        expect(axis.step).toBe(20);
        expect(axis.domain).toEqual([0, 100]);
        expect(axis.ticks).toEqual([0, 20, 40, 60, 80, 100]);
        expect(axis.decimals).toBe(0);
    });

    it('pads a flat series so it sits inside the plot', () => {
        const axis = niceAxis(170, 170, { count: 3 });
        expect(axis.domain[0]).toBeLessThan(170);
        expect(axis.domain[1]).toBeGreaterThan(170);
        expect(axis.ticks.every((t) => Number.isInteger(t))).toBe(true);
    });

    it('clamps to a floor and ceiling (a percent axis stays in 0–100)', () => {
        const axis = niceAxis(0, 100, { count: 4, floor: 0, ceil: 100 });
        expect(axis.domain).toEqual([0, 100]);
        expect(Math.min(...axis.ticks)).toBe(0);
        expect(Math.max(...axis.ticks)).toBe(100);
        const flat = niceAxis(0, 0, { floor: 0 });
        expect(flat.domain[0]).toBe(0);
    });

    it('ticks are strictly increasing and inside the domain (invariant)', () => {
        [[0.3, 0.9], [-4, 17], [1234, 5678], [0.001, 0.004]].forEach(([lo, hi]) => {
            const { domain, ticks } = niceAxis(lo, hi);
            expect(domain[0]).toBeLessThanOrEqual(lo);
            expect(domain[1]).toBeGreaterThanOrEqual(hi);
            ticks.forEach((t, i) => {
                expect(t).toBeGreaterThanOrEqual(domain[0]);
                expect(t).toBeLessThanOrEqual(domain[1]);
                if (i > 0) expect(t).toBeGreaterThan(ticks[i - 1]);
            });
        });
    });
});

describe('niceAxis minStep', () => {
    it('keeps a small count axis on whole numbers', () => {
        const axis = niceAxis(0, 3, { count: 4, floor: 0, minStep: 1 });
        expect(axis.step).toBe(1);
        expect(axis.ticks).toEqual([0, 1, 2, 3]);
    });
});

describe('formatTick', () => {
    it('prints the axis decimals and the unit', () => {
        expect(formatTick(50, 0, '%')).toBe('50%');
        expect(formatTick(0.5, 1, ' s')).toBe('0.5 s');
        expect(formatTick(1, 1, ' s')).toBe('1.0 s');
        expect(formatTick(-0, 0)).toBe('0');
        expect(formatTick(Number.NaN)).toBe('');
    });
});
