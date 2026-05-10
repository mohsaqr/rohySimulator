// Canonical emotion label set — the single source of truth used by the
// aggregator default, the payload validator, and every shipped multi-task
// model config. Three subsystems used to define this list independently;
// when we shipped 8-emotion models against a 7-emotion aggregator default
// every window summed to ~0.875 and got rejected by the validator with
// zero rows landing in oyon_emotion_records (see commit b24cb90 + the
// 2026-05-10 handoff). One constant prevents that drift.
//
// Ordering matches the AffectNet alphabetical convention used by the
// HSEmotion / EmotiEffLib model families. Aggregator output uses the
// same order; the validator only checks set membership and sum-to-one,
// so order is informational, not load-bearing.
export const ALLOWED_EMOTIONS = Object.freeze([
  'anger',
  'contempt',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise',
]);

const ALLOWED_EMOTIONS_SET = new Set(ALLOWED_EMOTIONS);

export function isAllowedEmotion(label) {
  return ALLOWED_EMOTIONS_SET.has(label);
}

// Assert that a model-config `labels` array is a permutation of the
// canonical set. Used by every multi-task model config at import time so
// a typo in a fork (e.g. 'angry' vs 'anger', or dropping 'contempt')
// crashes early rather than producing 7-of-8 windows that quietly fail
// validation. Subset-only models (the 5-label OpenVINO baseline) should
// NOT call this — they use `assertSubsetOfAllowed` instead.
export function assertCanonicalLabels(labels, modelId) {
  if (!Array.isArray(labels) || labels.length !== ALLOWED_EMOTIONS.length) {
    throw new Error(
      `[${modelId}] labels must be a length-${ALLOWED_EMOTIONS.length} permutation of ALLOWED_EMOTIONS, got ${JSON.stringify(labels)}`
    );
  }
  const set = new Set(labels);
  for (const required of ALLOWED_EMOTIONS) {
    if (!set.has(required)) {
      throw new Error(`[${modelId}] labels missing canonical emotion '${required}': ${JSON.stringify(labels)}`);
    }
  }
  for (const label of labels) {
    if (!ALLOWED_EMOTIONS_SET.has(label)) {
      throw new Error(`[${modelId}] labels contains unknown emotion '${label}': ${JSON.stringify(labels)}`);
    }
  }
  return labels;
}

// Looser variant for partial-coverage models (e.g. OpenVINO retail-0003,
// 5 labels). Asserts every label exists in the canonical set; allows
// missing canonical labels. The aggregator will still emit zeros for
// missing labels, which means the validator's sum-close-to-1 check will
// fail for these models — that's the deliberate signal that this profile
// is incompatible with the persistence path.
export function assertSubsetOfAllowed(labels, modelId) {
  if (!Array.isArray(labels) || !labels.length) {
    throw new Error(`[${modelId}] labels must be a non-empty array, got ${JSON.stringify(labels)}`);
  }
  for (const label of labels) {
    if (!ALLOWED_EMOTIONS_SET.has(label)) {
      throw new Error(`[${modelId}] labels contains unknown emotion '${label}': ${JSON.stringify(labels)}`);
    }
  }
  return labels;
}
