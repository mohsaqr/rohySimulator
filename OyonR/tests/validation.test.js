import assert from 'node:assert/strict';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

const validEvent = {
  session_id: 1,
  user_id: 2,
  case_id: 3,
  tenant_id: 1,
  window_start: '2026-05-07T19:00:00.000Z',
  window_end: '2026-05-07T19:00:10.000Z',
  dominant_emotion: 'neutral',
  probabilities: {
    neutral: 0.5,
    happy: 0.1,
    sad: 0.1,
    surprise: 0.1,
    anger: 0.1,
    fear: 0.05,
    disgust: 0.05,
  },
  valence: null,
  arousal: null,
  confidence: 0.5,
  entropy: 2,
  valid_frames: 10,
  missing_face_ratio: 0.1,
  quality: { meanFaceAreaRatio: 0.2 },
  model_name: 'test-model',
  model_version: '1',
  capture_mode: 'local-browser',
  consent_version: 'fer-consent-v1',
};

{
  const result = validateEmotionBatch({ events: [validEvent] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, image: 'base64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('image is forbidden')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, dominant_emotion: 'confused' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('dominant_emotion')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, probabilities: { neutral: 2 } }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('probabilities.neutral')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, confidence: 1.2 }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('confidence')));
}

console.log('validation.test.js passed');

