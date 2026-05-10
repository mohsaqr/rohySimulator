// Pre-merge schema contract test.
//
// Why this exists: on 2026-05-10 the aggregator defaulted to a 7-emotion
// label set while every shipped model emitted 8 emotions. The aggregator
// silently dropped the 8th channel, every window summed to ~0.875, and
// the server validator's sum-close-to-1 check rejected the entire batch
// — zero rows reached oyon_emotion_records. No existing test would have
// caught it because aggregation tests used hand-picked label sets,
// validation tests used hand-picked event shapes, and the two were
// never composed.
//
// This test composes them: for each shipped multi-task model config, it
// builds an aggregator with that model's labels, feeds it synthetic
// classifier output shaped exactly like OnnxEmotionClassifier emits,
// flushes a window, decorates it the way EmotionRuntime.sendWindows
// does, then runs the result through validateEmotionBatch. If any
// model profile's window can't pass the validator, this test fails and
// the regression never reaches deploy.

import assert from 'node:assert/strict';
import { EmotionAggregator } from '../src/aggregation/EmotionAggregator.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';
import { ALLOWED_EMOTIONS } from '../src/config/emotionLabels.js';
import { HSE_EMOTION_MTL_CONFIG } from '../src/config/hseEmotionMtl.js';
import { EMOTIEFF_MOBILEVIT_MTL_CONFIG } from '../src/config/emotiEffMobileVitMtl.js';
import { EMOTIEFF_MBF_MTL_CONFIG } from '../src/config/emotiEffMbfMtl.js';
import { createOyonSettings, settingsSnapshot } from '../src/settings/OyonSettings.js';

const PROFILES = [
  { name: 'HSE', config: HSE_EMOTION_MTL_CONFIG },
  { name: 'EmotiEff MobileViT', config: EMOTIEFF_MOBILEVIT_MTL_CONFIG },
  { name: 'EmotiEff MBF', config: EMOTIEFF_MBF_MTL_CONFIG },
];

function syntheticSample(labels, dominantIndex, timestamp) {
  // Match OnnxEmotionClassifier output exactly: dense object keyed by
  // every label, summing to 1, plus valence/arousal/confidence/entropy.
  const total = labels.length;
  const remainder = (1 - 0.6) / (total - 1);
  const probabilities = Object.fromEntries(
    labels.map((label, index) => [label, index === dominantIndex ? 0.6 : remainder])
  );
  return {
    timestamp,
    facePresent: true,
    probabilities,
    valence: 0.1,
    arousal: 0.05,
    confidence: 0.6,
    entropy: 1.4,
    quality: { faceAreaRatio: 0.32 },
    model: { name: 'contract-test', version: 'v1' },
  };
}

for (const { name, config } of PROFILES) {
  const labels = config.labels;

  // The aggregator gets its labels from classifier.options.labels at
  // runtime construction (EmotionRuntime.js:46). Replicate that wiring
  // here — if it ever drifts, the runtime constructor changes too and
  // this test catches the divergence.
  const aggregator = new EmotionAggregator({
    windowMs: 5000,
    minValidFrames: 3,
    sampleIntervalMs: 1000,
    labels,
  });

  // Feed N-1 samples then explicitly flush. addSample auto-flushes
  // when the next sample's timestamp crosses windowMs, which would
  // race with the explicit flush below. Driving flush manually keeps
  // the test deterministic.
  const start = 1_700_000_000_000;
  const N = 4;
  for (let i = 0; i < N; i += 1) {
    aggregator.addSample(syntheticSample(labels, i % labels.length, start + i * 1000));
  }
  const windowEnd = start + (N + 1) * 1000;
  const window = aggregator.flush(windowEnd);

  assert.ok(window, `[${name}] aggregator must emit a window`);
  assert.ok(window.dominant_emotion, `[${name}] dominant_emotion must not be null`);
  assert.ok(window.probabilities, `[${name}] probabilities must not be null`);

  // Every label in the emitted window must be in the canonical set.
  // (A model can be a permutation; it cannot smuggle a new label.)
  for (const label of Object.keys(window.probabilities)) {
    assert.ok(
      ALLOWED_EMOTIONS.includes(label),
      `[${name}] window label '${label}' not in canonical ALLOWED_EMOTIONS`,
    );
  }
  assert.ok(
    ALLOWED_EMOTIONS.includes(window.dominant_emotion),
    `[${name}] dominant_emotion '${window.dominant_emotion}' not in canonical ALLOWED_EMOTIONS`,
  );

  // Sum-of-probabilities must satisfy the server validator's tolerance.
  // The May-2026 bug landed exactly here — sums of ~0.875 were rejected.
  const sum = Object.values(window.probabilities).reduce((acc, value) => acc + value, 0);
  assert.ok(
    sum >= 0.99 && sum <= 1.01,
    `[${name}] probabilities sum ${sum.toFixed(4)} not within 1.0 ± 0.01`,
  );

  // Decorate the window the way EmotionRuntime.sendWindows does, then
  // run the entire shape through validateEmotionBatch. This is the same
  // validator the server runs at oyon-routes.js:218.
  const settings = createOyonSettings({ model_profile: config.id });
  const snapshot = settingsSnapshot(settings);
  const event = {
    ...window,
    capture_mode: 'local-browser',
    consent_version: 'fer-consent-v1',
    settings_snapshot: snapshot,
    settings_hash: snapshot.settings_hash,
  };
  const result = validateEmotionBatch({ events: [event] });
  assert.ok(
    result.ok,
    `[${name}] validateEmotionBatch rejected the runtime-shaped window: ${JSON.stringify(result.errors)}`,
  );
}

// Negative control: reproduce the May-2026 regression shape exactly.
// The aggregator was constructed with a 7-label default while the
// classifier emitted 8-label probabilities (with 'contempt'). The
// aggregator iterated over its 7 labels, missed the contempt channel,
// and produced windows summing to ~0.875 — below the validator's
// [0.95, 1.05] tolerance. If this passes (sum < 0.95 and validator
// rejects), the structural guard is intact.
{
  const aggregatorLabels = ['neutral', 'happy', 'sad', 'surprise', 'anger', 'fear', 'disgust'];
  const classifierLabels = [...aggregatorLabels, 'contempt'];
  const aggregator = new EmotionAggregator({
    windowMs: 5000,
    minValidFrames: 3,
    sampleIntervalMs: 1000,
    labels: aggregatorLabels,
  });
  const start = 1_700_000_000_000;
  for (let i = 0; i < 4; i += 1) {
    // Sample emits 8-label probabilities; aggregator only sums 7.
    aggregator.addSample(syntheticSample(classifierLabels, i % classifierLabels.length, start + i * 1000));
  }
  const window = aggregator.flush(start + 5000);
  const sum = Object.values(window.probabilities).reduce((acc, value) => acc + value, 0);
  assert.ok(
    sum < 0.95,
    `negative control: 7-of-8 sum ${sum.toFixed(4)} should be below 0.95 — if it isn't, the test is no longer reproducing the May-2026 regression shape`,
  );

  const event = {
    ...window,
    capture_mode: 'local-browser',
    consent_version: 'fer-consent-v1',
  };
  const result = validateEmotionBatch({ events: [event] });
  assert.ok(
    !result.ok,
    'negative control: validator must reject 7-of-8 label window (sum < 0.95)',
  );
}

console.log('contract.test.js passed');
