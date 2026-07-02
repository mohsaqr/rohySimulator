import assert from 'node:assert/strict';
import {
  createOyonSettings,
  expectedSamplesPerWindow,
  settingsSnapshot,
  normalizeFocusScoreWeights,
} from '../src/settings/OyonSettings.js';

{
  const settings = createOyonSettings();
  assert.equal(settings.sample_interval_ms, 1000);
  assert.equal(settings.aggregate_window_ms, 10000);
  assert.equal(settings.min_valid_frames, 6);
  assert.equal(settings.enable_dynamics, true);
}

{
  const settings = createOyonSettings({
    sampleIntervalMs: 2000,
    windowMs: 5000,
    minValidFrames: 99,
  });
  assert.equal(settings.sample_interval_ms, 2000);
  assert.equal(settings.aggregate_window_ms, 5000);
  assert.equal(settings.min_valid_frames, expectedSamplesPerWindow(2000, 5000));
}

{
  const one = settingsSnapshot(createOyonSettings({ model: 'mock' }));
  const two = settingsSnapshot(createOyonSettings({ model_profile: 'mock' }));
  assert.equal(one.settings_hash, two.settings_hash);
  assert.match(one.settings_hash, /^fnv1a32:/);
}

// Eye-tracking / engagement settings defaults.
{
  const settings = createOyonSettings();
  assert.equal(settings.eye_tracking_enabled, false);
  assert.equal(settings.blink_mask_threshold, 0.2);
  assert.equal(settings.gaze_zone_neutral_deg, 8);
  assert.equal(settings.engagement_window_share, true);
  assert.equal(settings.blink_rate_baseline_hz, 0.25);
  assert.equal(settings.gaze_entropy_grid_n, 5);
  assert.deepEqual(settings.focus_score_weights, {
    blink_penalty: 0.30,
    openness: 0.20,
    gaze_stability: 0.50,
  });
}

// eye_tracking_enabled can be flipped on.
{
  const settings = createOyonSettings({ eye_tracking_enabled: true });
  assert.equal(settings.eye_tracking_enabled, true);
}

// camelCase legacy alias.
{
  const settings = createOyonSettings({ eyeTrackingEnabled: true });
  assert.equal(settings.eye_tracking_enabled, true);
}

// focus_score_weights summing to 1.5 → renormalized to sum 1.
{
  const settings = createOyonSettings({
    focus_score_weights: { blink_penalty: 0.6, openness: 0.3, gaze_stability: 0.6 },
  });
  const w = settings.focus_score_weights;
  const sum = w.blink_penalty + w.openness + w.gaze_stability;
  assert.ok(Math.abs(sum - 1) < 1e-9, `expected sum≈1, got ${sum}`);
  assert.ok(Math.abs(w.blink_penalty - 0.6 / 1.5) < 1e-9);
}

// focus_score_weights with a negative value → clamped to 0, then renormalized.
{
  const w = normalizeFocusScoreWeights({ blink_penalty: -0.1, openness: 0.5, gaze_stability: 0.5 });
  assert.equal(w.blink_penalty, 0);
  const sum = w.blink_penalty + w.openness + w.gaze_stability;
  assert.ok(Math.abs(sum - 1) < 1e-9);
}

// focus_score_weights with non-finite (NaN) → defaults restored.
{
  const w = normalizeFocusScoreWeights({ blink_penalty: NaN, openness: 0.5, gaze_stability: 0.5 });
  assert.deepEqual(w, { blink_penalty: 0.30, openness: 0.20, gaze_stability: 0.50 });
}

// focus_score_weights all-zero → defaults restored.
{
  const w = normalizeFocusScoreWeights({ blink_penalty: 0, openness: 0, gaze_stability: 0 });
  assert.deepEqual(w, { blink_penalty: 0.30, openness: 0.20, gaze_stability: 0.50 });
}

// blink_mask_threshold: 2 → clamped to 1.
{
  const settings = createOyonSettings({ blink_mask_threshold: 2 });
  assert.equal(settings.blink_mask_threshold, 1);
}

// gaze_entropy_grid_n: 100 → clamped to 20.
{
  const settings = createOyonSettings({ gaze_entropy_grid_n: 100 });
  assert.equal(settings.gaze_entropy_grid_n, 20);
}

// settings_hash changes when eye_tracking_enabled toggles.
{
  const off = settingsSnapshot(createOyonSettings({ eye_tracking_enabled: false }));
  const on = settingsSnapshot(createOyonSettings({ eye_tracking_enabled: true }));
  assert.notEqual(off.settings_hash, on.settings_hash);
}

// ─── Gaze settings (Stage 4) ────────────────────────────────────────────

// gaze_tracking_enabled defaults + new fields exposed.
{
  const s = createOyonSettings({});
  assert.equal(s.gaze_tracking_enabled, false);
  assert.equal(s.gaze_engine, 'mediapipe');
  assert.equal(s.gaze_window_share, true);
  assert.equal(s.gaze_calibration_required, true);
  assert.equal(s.gaze_min_calibration_samples, 9);
  assert.equal(s.gaze_min_quality_score, 0.3);
  assert.equal(s.gaze_zone_grid, 3);
  assert.deepEqual(s.gaze_aois, []);
  assert.equal(s.gaze_drop_off_screen, true);
  // WebGazer-specific tunables default off; integrators opt in per UI.
  assert.equal(s.webgazer_show_face_overlay, false);
  assert.equal(s.webgazer_show_prediction_points, false);
  assert.equal(s.webgazer_show_face_feedback_box, false);
  assert.equal(s.webgazer_save_across_sessions, false);
  assert.equal(s.webgazer_regression, 'ridge');
  assert.equal(s.gaze_calibration_points, 5);
}

// gaze_engine selection is explicit; 'webgazer' and 'webeyetrack' are
// opt-ins, anything else lands on the project default (mediapipe landmarks).
{
  assert.equal(createOyonSettings({ gaze_engine: 'mediapipe' }).gaze_engine, 'mediapipe');
  assert.equal(createOyonSettings({ gaze_engine: 'MediaPipe' }).gaze_engine, 'mediapipe');
  assert.equal(createOyonSettings({ gaze_engine: 'webeyetrack' }).gaze_engine, 'webeyetrack');
  assert.equal(createOyonSettings({ gaze_engine: 'WebEyeTrack' }).gaze_engine, 'webeyetrack');
  assert.equal(createOyonSettings({ gaze_engine: 'webgazer' }).gaze_engine, 'webgazer');
  assert.equal(createOyonSettings({ gaze_engine: 'unknown' }).gaze_engine, 'mediapipe');
}

// webgazer_regression accepts three documented values, anything else falls
// back to 'ridge'.
{
  assert.equal(createOyonSettings({ webgazer_regression: 'weightedRidge' }).webgazer_regression, 'weightedRidge');
  assert.equal(createOyonSettings({ webgazer_regression: 'threadedRidge' }).webgazer_regression, 'threadedRidge');
  assert.equal(createOyonSettings({ webgazer_regression: 'bogus' }).webgazer_regression, 'ridge');
}

// gaze_calibration_points clamps to 5 or 9 only — no other counts make sense
// with the documented overlay layouts.
{
  assert.equal(createOyonSettings({ gaze_calibration_points: 9 }).gaze_calibration_points, 9);
  assert.equal(createOyonSettings({ gaze_calibration_points: 5 }).gaze_calibration_points, 5);
  assert.equal(createOyonSettings({ gaze_calibration_points: 13 }).gaze_calibration_points, 5);
}

// gaze_zone_grid clamps.
{
  assert.equal(createOyonSettings({ gaze_zone_grid: 1 }).gaze_zone_grid, 2);
  assert.equal(createOyonSettings({ gaze_zone_grid: 100 }).gaze_zone_grid, 10);
}

// gaze_min_quality_score clamps.
{
  assert.equal(createOyonSettings({ gaze_min_quality_score: -1 }).gaze_min_quality_score, 0);
  assert.equal(createOyonSettings({ gaze_min_quality_score: 2 }).gaze_min_quality_score, 1);
}

// gaze_aois: malformed entries are dropped, well-formed kept.
{
  const aois = [
    { id: 'good', x: 0, y: 0, width: 0.5, height: 0.5 },
    { id: '', x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { id: 'bad-size', x: 0, y: 0, width: 0, height: 0.5 },
    { id: 'bad-coord', x: 'a', y: 0, width: 0.5, height: 0.5 },
    'string',
    null,
  ];
  const s = createOyonSettings({ gaze_aois: aois });
  assert.equal(s.gaze_aois.length, 1);
  assert.equal(s.gaze_aois[0].id, 'good');
}

// gaze_aois: non-array → empty.
{
  assert.deepEqual(createOyonSettings({ gaze_aois: 'not-array' }).gaze_aois, []);
  assert.deepEqual(createOyonSettings({ gaze_aois: null }).gaze_aois, []);
}

// gaze_aois cap.
{
  const many = Array.from({ length: 50 }, (_, i) => ({
    id: `aoi_${i}`, x: 0, y: 0, width: 0.1, height: 0.1,
  }));
  assert.equal(createOyonSettings({ gaze_aois: many }).gaze_aois.length, 32);
}

// Legacy camelCase key normalizes.
{
  assert.equal(createOyonSettings({ gazeTrackingEnabled: true }).gaze_tracking_enabled, true);
}

// settings_hash changes when gaze_tracking_enabled toggles.
{
  const off = settingsSnapshot(createOyonSettings({ gaze_tracking_enabled: false }));
  const on = settingsSnapshot(createOyonSettings({ gaze_tracking_enabled: true }));
  assert.notEqual(off.settings_hash, on.settings_hash);
}

console.log('settings.test.js passed');
