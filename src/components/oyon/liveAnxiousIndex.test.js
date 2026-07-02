// Behavioural contract for the derived anxiety indicator (Bug 18).
//
// History: this used to be a DRIFT GUARD comparing the SPA copy against
// `anxiousIndex` in the vendored OyonR EmotionAggregator — the two were
// hand-synced duplicates. The Oyon v2 sync retired the vendored copy
// (upstream never adopted it; windows no longer carry `anxious_index`), so
// `anxiousIndex.js` here is now the SINGLE implementation, computed live in
// the capture widget from the element's `oyon:sample` stream (probabilities
// + valence + arousal — all present on every sample event). These tests pin
// its behavioural contract directly.

import { describe, it, expect } from 'vitest';
import { liveAnxiousIndex, ANXIOUS_FLAG_THRESHOLD } from './anxiousIndex.js';

describe('liveAnxiousIndex — the single anxiety-indicator implementation', () => {
    it('is bounded to [0,1] across the full input grid', () => {
        const vals = [-1, -0.9, -0.5, -0.1, 0, 0.3, 0.7, 1];
        const ars = [-1, -0.6, -0.2, 0, 0.4, 0.8, 1];
        const fears = [0, 0.05, 0.25, 0.5, 0.8, 1];
        for (const v of vals) {
            for (const a of ars) {
                for (const f of fears) {
                    const x = liveAnxiousIndex({ fear: f }, v, a);
                    expect(x, `out of range at v=${v} a=${a} fear=${f}`).toBeGreaterThanOrEqual(0);
                    expect(x, `out of range at v=${v} a=${a} fear=${f}`).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    it('is monotonically non-decreasing in fear (all else equal)', () => {
        let prev = -Infinity;
        for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
            const x = liveAnxiousIndex({ fear: f }, -0.3, 0.3);
            expect(x).toBeGreaterThanOrEqual(prev);
            prev = x;
        }
    });

    it('scores the anxious quadrant high and the calm quadrant low', () => {
        // High arousal + negative valence + strong fear → clearly flagged.
        expect(liveAnxiousIndex({ fear: 0.8 }, -0.9, 0.9)).toBeGreaterThan(0.7);
        // Positive valence + low arousal + no fear → clearly not.
        expect(liveAnxiousIndex({ fear: 0.0 }, 0.8, -0.6)).toBeLessThan(0.2);
    });

    it('distinguishes "unknown" (null) from "not anxious" (0)', () => {
        expect(liveAnxiousIndex(null, NaN, NaN)).toBeNull();
        // The fully-calm corner (max positive valence, min arousal, no fear)
        // is exactly 0 — a known value, not an unknown one.
        expect(liveAnxiousIndex({ fear: 0 }, 1, -1)).toBe(0);
    });

    it('tolerates missing axes: falls back to 0 for whichever is non-finite', () => {
        // probabilities present ⇒ never null, even with unusable axes.
        const fearOnly = liveAnxiousIndex({ fear: 1 }, NaN, NaN);
        expect(fearOnly).toBeCloseTo(0.4 * 1 + 0.6 * 0.25, 12); // v=0,a=0 quadrant = 0.25
    });

    it('threshold is the midpoint of the [0,1] scale', () => {
        expect(ANXIOUS_FLAG_THRESHOLD).toBe(0.5);
    });
});
