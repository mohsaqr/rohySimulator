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

// Engagement block — well-formed engagement passes.
{
  const engagementEvent = {
    ...validEvent,
    engagement: {
      blink_count: 2,
      blink_rate_hz: 0.32,
      eye_openness_mean: 0.81,
      eye_openness_std: 0.07,
      gaze_entropy: 0.42,
      gaze_zone_proportions: {
        center: 0.71, left: 0.08, right: 0.05, up: 0.04, down: 0.12,
      },
      valid_frame_ratio: 0.94,
      valid_frames: 18,
      total_frames: 19,
      duration_ms: 10000,
      expected_samples: 11,
      focus_score: 0.68,
      focus_score_components: { blink: 0.9, openness: 0.81, gaze_stability: 0.58 },
      window_start: '2026-05-07T19:00:00.000Z',
      window_end: '2026-05-07T19:00:10.000Z',
      model_version: 'mediapipe-blendshapes-v1',
    },
  };
  const result = validateEmotionBatch({ events: [engagementEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// engagement = null is allowed (back-compat / optional block).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, engagement: null }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Window with no `engagement` field still passes (the base validEvent test does this,
// but assert again to lock the contract).
{
  const { ...withoutEngagement } = validEvent;
  delete withoutEngagement.engagement;
  const result = validateEmotionBatch({ events: [withoutEngagement] });
  assert.equal(result.ok, true);
}

// iris_landmarks_raw at top level → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, iris_landmarks_raw: [1, 2, 3] }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('iris_landmarks_raw')));
}

// gaze_points_raw at top level → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze_points_raw: [] }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('gaze_points_raw')));
}

// pupil_diameter_px → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, pupil_diameter_px: 3.2 }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('pupil_diameter_px')));
}

// eye_image_left → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, eye_image_left: 'b64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('eye_image_left')));
}

// eye_image_strip → rejected (prefix rule).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, eye_image_strip: 'b64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('eye_image_strip')));
}

// engagement.focus_score out of range.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { focus_score: 1.5 },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.focus_score')));
}

// engagement.gaze_zone_proportions with an unsupported zone.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { gaze_zone_proportions: { invalid_zone: 0.5, center: 0.5 } },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('invalid_zone')));
}

// engagement.landmarks nested forbidden.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { landmarks: [{ x: 1 }] },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.landmarks')));
}

// engagement.eye_image_strip nested forbidden (prefix inside engagement).
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { eye_image_strip: 'b64' },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.eye_image_strip')));
}

// ─── Gaze block (Stage 4) ──────────────────────────────────────────────

// Well-formed gaze block passes.
{
  const gazeEvent = {
    ...validEvent,
    gaze: {
      n_points: 287,
      total_frames: 300,
      centroid: { x: 0.05, y: -0.04 },
      dispersion: 0.12,
      zone_proportions: {
        top_left:    0.02, top_center:    0.05, top_right:    0.01,
        middle_left: 0.04, middle_center: 0.71, middle_right: 0.04,
        bottom_left: 0.03, bottom_center: 0.08, bottom_right: 0.02,
      },
      aoi_dwell_ms: { stimulus_chart: 4200, stimulus_text: 3100 },
      calibration_age_ms: 142000,
      calibration_quality: 0.78,
      valid_frame_ratio: 0.94,
      off_screen_ratio: 0.03,
      duration_ms: 10000,
      window_start: '2026-05-07T19:00:00.000Z',
      window_end: '2026-05-07T19:00:10.000Z',
      model_version: 'webeyetrack-0.0.2',
    },
  };
  const result = validateEmotionBatch({ events: [gazeEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// gaze = null is allowed (optional block).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze: null }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// gaze.zone_proportions with all-indexed (r<n>c<n>) keys passes — 5x5 mode.
{
  const zp = {};
  for (let r = 0; r < 5; r += 1) for (let c = 0; c < 5; c += 1) zp[`r${r}c${c}`] = 1 / 25;
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze: { zone_proportions: zp } }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Mixed 3x3 + indexed zone keys → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { zone_proportions: { top_left: 0.5, r0c1: 0.5 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('zone_proportions keys must all')));
}

// Raw points field forbidden (top-level deny — `gaze_points_raw`).
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze_points_raw: [[0.1, 0.2], [0.3, 0.4]] }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze_points_raw is forbidden')));
}

// Raw points inside gaze block → forbidden by FORBIDDEN_GAZE_FIELDS.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { gaze_points_raw: [[0, 0]] } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.gaze_points_raw is forbidden')));
}

// gaze_raw / gaze_trace inside gaze → forbidden.
{
  for (const key of ['gaze_raw', 'gaze_trace', 'points', 'points_raw']) {
    const result = validateEmotionBatch({
      events: [{ ...validEvent, gaze: { [key]: [1] } }],
    });
    assert.equal(result.ok, false, `key ${key} should be forbidden`);
    assert.ok(result.errors.some(e => e.includes(`gaze.${key}`)),
      `expected gaze.${key} error, got ${JSON.stringify(result.errors)}`);
  }
}

// Naming-convention deny: keys ending in _array / _trace / _raw inside gaze.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { custom_array: [1, 2, 3] } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.custom_array')));
}

// Oversized array inside gaze → forbidden by length cap.
{
  const big = new Array(101).fill(0);
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { sample_log: big } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('exceeds 100')));
}

// gaze.centroid out of range → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { centroid: { x: 5, y: 0 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.centroid.x')));
}

// gaze.aoi_dwell_ms with negative value → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { aoi_dwell_ms: { stim_a: -10 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('aoi_dwell_ms.stim_a')));
}

// gaze.valid_frame_ratio out of [0,1] → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { valid_frame_ratio: 1.4 } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('valid_frame_ratio')));
}

console.log('validation.test.js passed');

