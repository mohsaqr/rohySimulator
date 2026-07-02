import assert from 'node:assert/strict';
import { EmotionAggregator } from '../src/aggregation/EmotionAggregator.js';

const labels = ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

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

{
  const agg = new EmotionAggregator({ windowMs: 1000, minValidFrames: 2 });
  agg.addSample({
    timestamp: 0,
    facePresent: true,
    probabilities: probs('contempt', 0.8),
    confidence: 0.8,
    entropy: 1,
    quality: { faceAreaRatio: 0.2 },
  });
  const win = agg.addSample({
    timestamp: 1100,
    facePresent: true,
    probabilities: probs('contempt', 0.7),
    confidence: 0.7,
    entropy: 1.2,
    quality: { faceAreaRatio: 0.3 },
  });

  assert.equal(win.dominant_emotion, 'contempt');
  assert.ok(Object.prototype.hasOwnProperty.call(win.probabilities, 'contempt'));
  assert.ok(Math.abs(Object.values(win.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
}

console.log('aggregation.test.js passed');
