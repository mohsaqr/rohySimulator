import assert from 'node:assert/strict';
import { DynamicalFeatureTracker, computeDynamicalFeatures } from '../src/analytics/DynamicalFeatures.js';

const first = {
  window_id: 'w1',
  window_start: '2026-05-08T00:00:00.000Z',
  window_end: '2026-05-08T00:00:10.000Z',
  dominant_emotion: 'neutral',
  valence: 0,
  arousal: 0,
  confidence: 0.5,
  entropy: 2,
  missing_face_ratio: 0.1,
};
const second = {
  window_id: 'w2',
  window_start: '2026-05-08T00:00:10.000Z',
  window_end: '2026-05-08T00:00:20.000Z',
  dominant_emotion: 'happy',
  valence: 0.5,
  arousal: 0.4,
  confidence: 0.8,
  entropy: 1,
  missing_face_ratio: 0,
};

{
  const features = computeDynamicalFeatures(second, first);
  assert.equal(features.phase_quadrant, 'positive-activated');
  assert.equal(features.transition_from, 'neutral');
  assert.equal(features.transition_to, 'happy');
  assert.equal(features.label_changed, true);
  assert.ok(features.valence_velocity > 0);
  assert.ok(features.arousal_velocity > 0);
}

{
  const tracker = new DynamicalFeatureTracker();
  const a = tracker.update(first);
  const b = tracker.update(second);
  assert.equal(a.valence_velocity, null);
  assert.ok(b.affect_speed > 0);
}

console.log('dynamics.test.js passed');
