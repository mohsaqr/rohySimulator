// Unit test for the turnaround resolver. Server-side regression lock for
// the 1–5 minute clamp + the single priority chain shared by both the
// lab and radiology endpoints.

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_TURNAROUND_MINUTES,
    resolveTurnaroundMinutes,
} from '../../server/lib/turnaround.js';

describe('resolveTurnaroundMinutes', () => {
    it('exposes DEFAULT_TURNAROUND_MINUTES inside the 1–5 minute clamp', () => {
        expect(DEFAULT_TURNAROUND_MINUTES).toBeGreaterThanOrEqual(1);
        expect(DEFAULT_TURNAROUND_MINUTES).toBeLessThanOrEqual(5);
    });

    it('requestOverride === 0 beats every other source (student Instant button)', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 0,
            caseConfig: { investigations: { instantResults: false, defaultTurnaround: 4 } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('case-level instantResults beats request override > 0 and per-test default', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 3,
            caseConfig: { investigations: { instantResults: true } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('student instantly STILL beats case-level instantResults (learner-side convenience wins)', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 0,
            caseConfig: { investigations: { instantResults: true } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('positive request override beats per-test default', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 2,
            testDefault: 5,
        });
        expect(got).toBe(2);
    });

    it('per-test default beats case-level default', () => {
        const got = resolveTurnaroundMinutes({
            testDefault: 1,
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(1);
    });

    it('case-level default applied when there is no per-test value', () => {
        const got = resolveTurnaroundMinutes({
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(4);
    });

    it('falls back to DEFAULT_TURNAROUND_MINUTES when nothing is supplied', () => {
        expect(resolveTurnaroundMinutes({})).toBe(DEFAULT_TURNAROUND_MINUTES);
        expect(resolveTurnaroundMinutes()).toBe(DEFAULT_TURNAROUND_MINUTES);
    });

    it('non-numeric / NaN / negative request overrides are ignored', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: null,
            testDefault: 3,
        });
        expect(got).toBe(3);

        const got2 = resolveTurnaroundMinutes({
            requestOverride: undefined,
            testDefault: 3,
        });
        expect(got2).toBe(3);

        const got3 = resolveTurnaroundMinutes({
            requestOverride: -1,
            testDefault: 3,
        });
        expect(got3).toBe(3);
    });

    it('zero per-test default is ignored (treated as "no per-test value")', () => {
        // Older seed rows may carry 0 from a misconfigured author; we
        // should not treat that as "instant" for the test — only an
        // explicit instant override (request or case) means instant.
        const got = resolveTurnaroundMinutes({
            testDefault: 0,
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(4);
    });
});
