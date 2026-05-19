// Drift guard for the derived anxiety indicator (Bug 18, 18.5.2026 review
// Finding #2). `liveAnxiousIndex` in OyonCaptureWidget.jsx is a deliberate
// hand-synced copy of `anxiousIndex` in OyonR (the vendored emotion
// runtime is not in the SPA build graph, so it cannot be imported at
// runtime). Hand-synced copies drift silently. This test imports BOTH and
// asserts they are numerically identical across a grid of inputs, so any
// future divergence — a tweaked weight, a different clamp, a moved
// threshold — fails CI instead of shipping two different anxiety scales.

import { describe, it, expect } from 'vitest';
import { liveAnxiousIndex, ANXIOUS_FLAG_THRESHOLD } from './anxiousIndex.js';
import { anxiousIndex } from '../../../OyonR/src/aggregation/EmotionAggregator.js';

const vals = [-1, -0.9, -0.5, -0.1, 0, 0.3, 0.7, 1];
const ars = [-1, -0.6, -0.2, 0, 0.4, 0.8, 1];
const fears = [0, 0.05, 0.25, 0.5, 0.8, 1];

describe('liveAnxiousIndex (SPA copy) ↔ anxiousIndex (OyonR) drift guard', () => {
    it('produces byte-identical results across the full input grid', () => {
        for (const v of vals) {
            for (const a of ars) {
                for (const f of fears) {
                    const probs = { fear: f };
                    const spa = liveAnxiousIndex(probs, v, a);
                    const oyon = anxiousIndex(probs, v, a);
                    expect(spa, `mismatch at v=${v} a=${a} fear=${f}`).toBeCloseTo(oyon, 12);
                }
            }
        }
    });

    it('matches the OyonR behavioural contract (anxious high, calm low, unknown→null)', () => {
        expect(liveAnxiousIndex({ fear: 0.8 }, -0.9, 0.9)).toBeGreaterThan(0.7);
        expect(liveAnxiousIndex({ fear: 0.0 }, 0.8, -0.6)).toBeLessThan(0.2);
        expect(liveAnxiousIndex(null, NaN, NaN)).toBeNull();
        const x = liveAnxiousIndex({ fear: 0.5 }, -0.5, 0.5);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
    });

    it('threshold is the midpoint of the [0,1] scale', () => {
        expect(ANXIOUS_FLAG_THRESHOLD).toBe(0.5);
    });
});
