// Derived anxiety indicator (Bug 18, 18.5.2026).
//
// AffectNet 8-class emotion models have no "anxious" label — it is not a
// class they can emit, and `ALLOWED_EMOTIONS` is a frozen, import-asserted
// taxonomy. Instead of faking a 9th class we derive an indicator from the
// circumplex axes the MTL models DO emit: high arousal + negative valence,
// reinforced by fear.
//
// This is a deliberate hand-synced mirror of `anxiousIndex` in
// OyonR/src/aggregation/EmotionAggregator.js. The vendored OyonR tree is
// NOT in the SPA build graph, so it cannot be imported at runtime. The
// drift between the two copies is guarded by liveAnxiousIndex.test.js,
// which imports BOTH and asserts numerical equality across an input grid —
// any divergence fails CI rather than shipping two anxiety scales.

/** Clamp to [0,1]; non-finite → 0. */
function clamp01(x) {
    return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Derived anxiety score.
 * @param {{fear?: number}|null|undefined} probabilities per-label probs (fear in [0,1])
 * @param {number} valence circumplex valence in [-1,1]
 * @param {number} arousal circumplex arousal in [-1,1]
 * @returns {number|null} 0..1, or null when nothing is known (so callers
 *          can distinguish "not anxious" (0) from "unknown" (null)).
 */
export function liveAnxiousIndex(probabilities, valence, arousal) {
    const fear = probabilities && Number.isFinite(Number(probabilities.fear))
        ? Number(probabilities.fear)
        : 0;
    if (!Number.isFinite(valence) && !Number.isFinite(arousal) && !probabilities) return null;
    const v = Number.isFinite(valence) ? valence : 0;
    const a = Number.isFinite(arousal) ? arousal : 0;
    const quadrant = clamp01((a + 1) / 2) * clamp01((1 - v) / 2);
    return clamp01(0.6 * quadrant + 0.4 * fear);
}

// At/above this the learner is flagged as anxious in the live pill. 0.5 is
// the midpoint of the derived [0,1] scale (clearly negative-valence AND
// elevated arousal, or strong fear).
export const ANXIOUS_FLAG_THRESHOLD = 0.5;
