import assert from 'node:assert/strict';
import { EmotionAggregator, anxiousIndex } from '../src/aggregation/EmotionAggregator.js';

const labels = ['neutral', 'happy', 'sad', 'surprise', 'anger', 'fear', 'disgust'];

function probs(label, value = 0.7) {
  const rest = (1 - value) / (labels.length - 1);
  return Object.fromEntries(labels.map(item => [item, item === label ? value : rest]));
}

{
  const agg = new EmotionAggregator({ windowMs: 1000, minValidFrames: 2, labels });
  assert.equal(agg.addSample({
    timestamp: 0,
    facePresent: true,
    probabilities: probs('happy', 0.8),
    confidence: 0.8,
    entropy: 1,
    quality: { faceAreaRatio: 0.2 },
    model: { name: 'test-model', version: '1' },
  }), null);
  assert.equal(agg.addSample({
    timestamp: 500,
    facePresent: true,
    probabilities: probs('happy', 0.7),
    confidence: 0.7,
    entropy: 1.2,
    quality: { faceAreaRatio: 0.3 },
    model: { name: 'test-model', version: '1' },
  }), null);
  const win = agg.addSample({
    timestamp: 1100,
    facePresent: false,
    quality: { reason: 'no-face' },
  });

  assert.equal(win.dominant_emotion, 'happy');
  assert.equal(win.valid_frames, 2);
  assert.equal(win.model_name, 'test-model');
  assert.equal(win.model_version, '1');
  assert.ok(win.missing_face_ratio > 0);
}

{
  const agg = new EmotionAggregator({ windowMs: 1000, minValidFrames: 3, labels });
  agg.addSample({ timestamp: 0, facePresent: false, quality: { reason: 'no-face' } });
  agg.addSample({
    timestamp: 500,
    facePresent: true,
    probabilities: probs('neutral', 0.9),
    confidence: 0.9,
    entropy: 0.4,
    quality: { faceAreaRatio: 0.2 },
  });
  const win = agg.addSample({ timestamp: 1200, facePresent: false, quality: { reason: 'no-face' } });

  assert.equal(win.dominant_emotion, null);
  assert.equal(win.probabilities, null);
  assert.equal(win.valid_frames, 1);
  assert.equal(win.quality.insufficientValidFrames, true);
}

// Bug 18 (18.5.2026): derived anxiety indicator. AffectNet models cannot
// emit an "anxious" class, so the aggregator exposes a derived [0,1]
// `anxious_index` from the circumplex (high arousal + negative valence,
// reinforced by fear), kept OUT of `probabilities` so the sum-to-one
// validator contract is untouched.
{
  // Pure-function behaviour: the high-arousal / negative-valence quadrant
  // with high fear must score far higher than calm positive affect.
  const anxious = anxiousIndex({ fear: 0.8 }, -0.9, 0.9);
  const calm = anxiousIndex({ fear: 0.0 }, 0.8, -0.6);
  assert.ok(anxious > 0.7, `anxious case should be high, got ${anxious}`);
  assert.ok(calm < 0.2, `calm case should be low, got ${calm}`);
  assert.ok(anxious >= 0 && anxious <= 1, 'index must be clamped to [0,1]');
  assert.equal(anxiousIndex(null, NaN, NaN), null, 'unknown inputs → null, not 0');

  // It must appear on the window object and never inside probabilities.
  const agg = new EmotionAggregator({ windowMs: 1000, minValidFrames: 2, labels });
  agg.addSample({ timestamp: 0, facePresent: true, probabilities: probs('fear', 0.8), valence: -0.8, arousal: 0.8, confidence: 0.8, entropy: 1, quality: { faceAreaRatio: 0.2 } });
  agg.addSample({ timestamp: 500, facePresent: true, probabilities: probs('fear', 0.7), valence: -0.7, arousal: 0.7, confidence: 0.7, entropy: 1, quality: { faceAreaRatio: 0.2 } });
  const win = agg.addSample({ timestamp: 1100, facePresent: false, quality: { reason: 'no-face' } });
  assert.ok(typeof win.anxious_index === 'number', 'window carries anxious_index');
  assert.ok(win.anxious_index > 0.5, `fearful negative window should read anxious, got ${win.anxious_index}`);
  assert.ok(!('anxious' in win.probabilities), 'anxious must NOT pollute the probability vector');
  const sum = Object.values(win.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `probabilities still sum to 1 (got ${sum})`);
}

// Insufficient-frames window still exposes the field (as null) so the
// shape is stable for consumers.
{
  const agg = new EmotionAggregator({ windowMs: 1000, minValidFrames: 3, labels });
  agg.addSample({ timestamp: 0, facePresent: false, quality: { reason: 'no-face' } });
  agg.addSample({ timestamp: 500, facePresent: true, probabilities: probs('neutral', 0.9), confidence: 0.9, entropy: 0.4, quality: { faceAreaRatio: 0.2 } });
  const win = agg.addSample({ timestamp: 1200, facePresent: false, quality: { reason: 'no-face' } });
  assert.equal(win.anxious_index, null, 'insufficient window → anxious_index null');
}

console.log('aggregation.test.js passed');
