// Usage bars with "no limit" (lane C handoff, F-24).
import { describe, expect, it } from 'vitest';
import { usagePercent } from './usagePercent.js';

describe('usagePercent', () => {
    // Regression lock: used / 0 = Infinity rendered the bar full for an install with no limit.
    it('is 0 when there is no limit', () => {
        expect(usagePercent(500, 0)).toBe(0);
        expect(usagePercent(500, null)).toBe(0);
        expect(usagePercent(500, undefined)).toBe(0);
    });
    it('is the capped share otherwise', () => {
        expect(usagePercent(25, 100)).toBe(25);
        expect(usagePercent(250, 100)).toBe(100);
        expect(usagePercent(undefined, 100)).toBe(0);
    });
});
