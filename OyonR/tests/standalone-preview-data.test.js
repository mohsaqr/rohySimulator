import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { MockWebEyeTrackAdapter } from '../src/mocks/MockWebEyeTrackAdapter.js';

/**
 * The standalone preview page (`standalone/preview.html`) wires the runtime
 * the same way this test does: mock face tracker, mock classifier, mock
 * gaze adapter, synthetic eye features, synthetic gaze samples. This test
 * locks in the data path so a refactor that breaks the preview catches at
 * `npm test` rather than in a browser nobody opens in CI.
 *
 * Coverage:
 *  - The runtime emits at least one window with both `engagement` and `gaze`
 *    blocks when both flags are on and gaze_window_share is true.
 *  - `gaze.zone_proportions` are present, sum close to 1, and use the 3x3
 *    named keys (validator invariant).
 *  - `gaze.centroid` is finite and within the documented [-0.6, 0.6] range.
 *  - The mock adapter's `calibrate()` round-trips through
 *    `runtime.calibrateGaze()` and flips the gating + emits the right log.
 */

function nineCalibrationPoints() {
  const pts = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      pts.push({ x: -0.4 + c * 0.4, y: -0.4 + r * 0.4 });
    }
  }
  return pts;
}

function makeRuntime({ captured }) {
  const adapter = new MockWebEyeTrackAdapter({
    onGaze: () => {},
    calibrationQuality: 0.83,
    modelName: 'mock-blazegaze',
  });
  let frameI = 0;
  const runtime = new EmotionRuntime({
    settings: {
      eye_tracking_enabled: true,
      gaze_tracking_enabled: true,
      gaze_calibration_required: false,
      sample_interval_ms: 250,
      aggregate_window_ms: 1000,
      min_valid_frames: 2,
    },
    faceTracker: new MockFaceTracker({
      mockBlendshapes: [
        { categoryName: 'eyeBlinkLeft', score: 0.05 },
        { categoryName: 'eyeBlinkRight', score: 0.05 },
      ],
    }),
    classifier: new MockEmotionClassifier(),
    webEyeTrackAdapter: adapter,
    transport: { async send(events) { captured.push(...events); } },
    eyeExtractor: {
      extract: () => {
        const ts = frameI * 250;
        return {
          eye_openness_l: 0.9, eye_openness_r: 0.9, blink_l: false, blink_r: false,
          iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
          gaze_zone: 'center', valid: true, ts_ms: ts,
        };
      },
    },
  });
  runtime.camera = {
    video: { readyState: 4, currentTime: 0 },
    async start() {},
    stop() {},
  };
  return { runtime, adapter, advance() { frameI += 1; } };
}

// A — Combined window: at least one batch has both engagement and gaze blocks.
// Wall-clock barely advances in a synchronous test loop, so we trigger emission
// via runtime.stop() — same pattern as tests/runtime-gaze.test.js. The live
// preview hits the time-based boundary naturally because setInterval lets real
// time tick between samples.
{
  const captured = [];
  const { runtime, adapter } = makeRuntime({ captured });
  await runtime.init();
  await adapter.start();

  for (let i = 0; i < 8; i += 1) {
    runtime.camera.video.currentTime = (i + 1) * 0.25;
    adapter.emitSample({ x: 0, y: 0, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const combined = captured.find(w => w?.engagement && w?.gaze);
  assert.ok(combined, `expected at least one window with both engagement and gaze blocks, got keys=${JSON.stringify(captured.map(w => Object.keys(w || {})))}`);
  assert.ok(combined.engagement.focus_score == null || Number.isFinite(combined.engagement.focus_score));
}

// B — Gaze block shape: 3x3 named zone keys, proportions sum to ~1, centroid in range.
{
  const captured = [];
  const { runtime, adapter } = makeRuntime({ captured });
  await runtime.init();
  await adapter.start();

  // Sweep gaze across x so multiple zones get populated.
  const sweep = [-0.4, -0.2, 0, 0.2, 0.4, 0.3, 0.1, -0.1, -0.3, 0, 0.2, -0.2];
  for (let i = 0; i < sweep.length; i += 1) {
    runtime.camera.video.currentTime = (i + 1) * 0.25;
    adapter.emitSample({ x: sweep[i], y: 0, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const withGaze = captured.find(w => w?.gaze && w.gaze.n_points > 0);
  assert.ok(withGaze, 'expected a window with non-empty gaze block');
  const g = withGaze.gaze;

  const expectedKeys = new Set([
    'top_left', 'top_center', 'top_right',
    'middle_left', 'middle_center', 'middle_right',
    'bottom_left', 'bottom_center', 'bottom_right',
  ]);
  const keys = Object.keys(g.zone_proportions || {});
  assert.equal(keys.length, 9, 'zone_proportions has 9 entries');
  for (const k of keys) assert.ok(expectedKeys.has(k), `unexpected zone key ${k}`);
  const sum = keys.reduce((acc, k) => acc + Number(g.zone_proportions[k] || 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-6 || sum === 0, `zone proportions sum ${sum} not ≈ 1`);

  assert.ok(g.centroid, 'centroid present');
  assert.ok(Math.abs(g.centroid.x) <= 0.6, `centroid.x ${g.centroid.x} out of validator range`);
  assert.ok(Math.abs(g.centroid.y) <= 0.6, `centroid.y ${g.centroid.y} out of validator range`);
}

// C — Calibration round-trip through runtime.calibrateGaze.
{
  const captured = [];
  const { runtime, adapter } = makeRuntime({ captured });
  await runtime.init();
  await adapter.start();

  const result = await runtime.calibrateGaze(nineCalibrationPoints());
  assert.equal(result.ok, true);
  assert.equal(result.model, 'mock-blazegaze');
  assert.ok(result.quality >= 0 && result.quality <= 1);
  assert.equal(runtime.gazeCalibrated, true);
}

// D — Real-time regression: when wall-clock crosses `aggregate_window_ms`,
// `GazeAggregator.consumeFrame()` auto-flushes internally. The runtime
// must capture that return value and attach it to the next emitted
// emotion window — otherwise the buffer is drained behind the runtime's
// back and the final flush returns null. The previous synchronous-loop
// tests don't catch this because wall clock barely advances; only a real
// `setTimeout`-paced loop trips the boundary inside consumeFrame.
{
  const captured = [];
  const { runtime, adapter } = makeRuntime({ captured });
  // Override settings to short, real-time windows so the test runs ~300ms.
  runtime.settings.sample_interval_ms = 50;
  runtime.settings.aggregate_window_ms = 200;
  runtime.aggregator.options.windowMs = 200;
  runtime.engagementAggregator.options.windowMs = 200;
  runtime.gazeAggregator.options.windowMs = 200;
  runtime.gazeAggregator.options.sampleIntervalMs = 50;

  await runtime.init();
  await adapter.start();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Drive ~12 ticks across ~360ms of wall time so the gaze aggregator's
  // internal flush boundary fires at least once before the runtime's
  // emotion-window emission picks it up.
  for (let i = 0; i < 12; i += 1) {
    adapter.emitSample({ x: 0, y: 0, quality: 0.9 });
    runtime.camera.video.currentTime = (i + 1) * 0.05;
    await runtime.sampleOnce();
    await sleep(30);
  }
  // Do NOT call runtime.stop() — the bug specifically hides behind stop()'s
  // unconditional flush. We must see a gaze block in a *running-state* window.
  const withGaze = captured.find(w => w?.gaze && w.gaze.n_points > 0);
  assert.ok(withGaze, `expected a running-state window with gaze attached (no stop() flush), captured=${captured.length}`);
  await runtime.stop();
}

console.log('standalone-preview-data tests passed');
