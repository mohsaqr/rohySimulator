import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { MockWebEyeTrackAdapter } from '../src/mocks/MockWebEyeTrackAdapter.js';
import { WebGazerAdapter } from '../src/inference/WebGazerAdapter.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}

function makeStubCamera() {
  return {
    video: { readyState: 2 },
    async start() {},
    stop() {},
  };
}

function makeAdapter(opts = {}) {
  // onGaze is mandatory; the runtime overrides it but the mock requires it
  // at construction time. We pass a no-op; runtime will replace.
  return new MockWebEyeTrackAdapter({ onGaze: () => {}, ...opts });
}

function nineCalibrationPoints() {
  const pts = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      pts.push({ x: -0.4 + c * 0.4, y: -0.4 + r * 0.4 });
    }
  }
  return pts;
}

// ─── Test 1: gaze flag off → no gaze field, no adapter allocated ─────────
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });

  assert.equal(runtime.gazeEnabled, false);
  assert.equal(runtime.gazeSmoother, null);
  assert.equal(runtime.gazeAggregator, null);
  assert.equal(runtime.webEyeTrackAdapter, null);

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  const events = transport.batches.flat();
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.equal(Object.prototype.hasOwnProperty.call(e, 'gaze'), false,
      `flag-off event must not include gaze field`);
  }
}

// ─── Test 2: gaze flag on + calibration completed → gaze block in windows
//             + validator passes the combined payload ────────────────────
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter({ minCalibrationSamples: 9, calibrationQuality: 0.78 });
  const runtime = new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: true,
      gaze_engine: 'webeyetrack',
      gaze_window_share: true,
      gaze_calibration_required: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    webEyeTrackAdapter: adapter,
  });

  assert.equal(runtime.gazeEnabled, true);
  assert.ok(runtime.gazeSmoother);
  assert.ok(runtime.gazeAggregator);
  assert.equal(runtime.gazeCalibrated, false);

  await runtime.init();
  await adapter.start();

  // Calibrate — 9 points → ok:true, gazeCalibrated flips true.
  const cal = await runtime.calibrateGaze(nineCalibrationPoints());
  assert.equal(cal.ok, true);
  assert.equal(runtime.gazeCalibrated, true);

  // Drive gaze samples (event-driven), interleaved with sampleOnce. The
  // aggregator buffers across sampleOnce calls; the runtime force-flushes
  // it at the emotion window boundary.
  for (let i = 0; i < 5; i += 1) {
    adapter.emitSample({ x: 0.05, y: -0.05, quality: 0.9 });
    adapter.emitSample({ x: 0.0,  y: 0.0,  quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const events = transport.batches.flat();
  const gazeEvents = events.filter(e => e.gaze);
  assert.ok(gazeEvents.length > 0, `expected at least one window with gaze, got events keys=${JSON.stringify(events.map(e => Object.keys(e)))}`);

  const g = gazeEvents[0].gaze;
  assert.ok(Number.isInteger(g.n_points));
  assert.ok(g.centroid && Number.isFinite(g.centroid.x));
  assert.ok(Number.isFinite(g.valid_frame_ratio));
  assert.ok(g.zone_proportions && typeof g.zone_proportions.middle_center === 'number');
  assert.equal(g.model_version, 'webeyetrack-0.0.2');
  // Centered scripted samples should be in middle_center.
  assert.equal(g.zone_proportions.middle_center, 1);
  // Calibration metadata present.
  assert.equal(g.calibration_quality, 0.78);
  assert.ok(Number.isFinite(g.calibration_age_ms));

  // The validator accepts the combined batch.
  const validation = validateEmotionBatch({ events: gazeEvents });
  assert.equal(validation.ok, true,
    `validator rejected gaze batch: ${JSON.stringify(validation.errors)}`);

  // Both engagement-summary and gaze-summary logs land in the logger ring.
  const gazeLogs = runtime.logger.read().filter(ev => ev.event_name === 'oyon.gaze.window');
  assert.ok(gazeLogs.length > 0, 'expected oyon.gaze.window log');
}

// ─── Test 3: gaze flag on + NO calibration → windows omit gaze + warn log
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter();
  const runtime = new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: true,
      gaze_window_share: true,
      gaze_calibration_required: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    webEyeTrackAdapter: adapter,
  });

  await runtime.init();
  await adapter.start();

  // Skip calibration. Emit samples.
  for (let i = 0; i < 5; i += 1) {
    adapter.emitSample({ x: 0, y: 0, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const events = transport.batches.flat();
  for (const e of events) {
    assert.equal(Object.prototype.hasOwnProperty.call(e, 'gaze'), false,
      `un-calibrated runtime must NOT attach gaze block, got: ${JSON.stringify(Object.keys(e))}`);
  }
}

// ─── Test 4: calibration_required:false → gaze emits immediately ─────────
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter();
  const runtime = new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: true,
      gaze_window_share: true,
      gaze_calibration_required: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    webEyeTrackAdapter: adapter,
  });

  await runtime.init();
  await adapter.start();

  for (let i = 0; i < 4; i += 1) {
    adapter.emitSample({ x: 0.1, y: 0.1, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const events = transport.batches.flat();
  const gazeEvents = events.filter(e => e.gaze);
  assert.ok(gazeEvents.length > 0, 'gaze should emit without calibration when not required');
}

// ─── Test 5: calibrateGaze() when gaze disabled → structured error ─────────
{
  const runtime = new EmotionRuntime({
    settings: { gaze_tracking_enabled: false },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport: new CapturingTransport(),
  });
  const r = await runtime.calibrateGaze([{ x: 0, y: 0 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'gaze_tracking_not_enabled');
}

// ─── Test 5b: runtime selects WebGazer adapter when configured ─────────────
{
  const runtime = new EmotionRuntime({
    settings: { gaze_tracking_enabled: true, gaze_engine: 'webgazer' },
    gaze: {
      webgazer: {
        webgazer: {
          setGazeListener() { return this; },
          saveDataAcrossSessions() { return this; },
          showVideoPreview() { return this; },
          showFaceOverlay() { return this; },
          showFaceFeedbackBox() { return this; },
          showPredictionPoints() { return this; },
          begin() { return this; },
        },
      },
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport: new CapturingTransport(),
  });
  assert.ok(runtime.gazeAdapter instanceof WebGazerAdapter);
  assert.equal(runtime.webEyeTrackAdapter, runtime.gazeAdapter);
}

// ─── Test 6: failed calibration emits warning log + status event ──────────
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter({ minCalibrationSamples: 9 });
  const runtime = new EmotionRuntime({
    settings: { gaze_tracking_enabled: true },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    webEyeTrackAdapter: adapter,
  });
  const events = [];
  runtime.on('status', (s) => events.push(s));
  await runtime.init();
  await adapter.start();

  const r = await runtime.calibrateGaze([{ x: 0, y: 0 }]); // < 9 samples
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient_samples');
  assert.equal(runtime.gazeCalibrated, false);

  const failed = events.find(e => e.state === 'gaze:calibration_failed');
  assert.ok(failed, 'expected gaze:calibration_failed status event');

  const failLogs = runtime.logger.read().filter(ev => ev.event_name === 'oyon.gaze.calibration_failed');
  assert.ok(failLogs.length > 0);
}

// ─── Test 7: engagement + gaze both flow into the same window object ─────
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter({ minCalibrationSamples: 9 });
  const runtime = new EmotionRuntime({
    settings: {
      eye_tracking_enabled: true,
      engagement_window_share: true,
      gaze_tracking_enabled: true,
      gaze_window_share: true,
      gaze_calibration_required: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    webEyeTrackAdapter: adapter,
    eyeExtractor: {
      extract: () => ({
        eye_openness_l: 0.9,
        eye_openness_r: 0.9,
        blink_l: false,
        blink_r: false,
        iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
        gaze_zone: 'center',
        valid: true,
        ts_ms: Date.now(),
      }),
    },
  });
  await runtime.init();
  await adapter.start();

  for (let i = 0; i < 5; i += 1) {
    adapter.emitSample({ x: 0, y: 0, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const events = transport.batches.flat();
  const combined = events.filter(e => e.engagement && e.gaze);
  assert.ok(combined.length > 0, 'expected at least one window with BOTH engagement and gaze');

  // Validator accepts the combined batch.
  const validation = validateEmotionBatch({ events: combined });
  assert.equal(validation.ok, true,
    `combined-block validator failed: ${JSON.stringify(validation.errors)}`);
}

// ─── Test: setGazeAois() live update → next window's aoi_dwell_ms uses the
//          new rects; invalid entries are dropped by the normalizer ───────
{
  const transport = new CapturingTransport();
  const adapter = makeAdapter();
  const runtime = new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: true,
      gaze_engine: 'webeyetrack',
      gaze_window_share: true,
      gaze_calibration_required: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    gazeAdapter: adapter,
  });
  await runtime.init();
  await adapter.start();

  // Live-update AOIs mid-run: a face box around screen center + one junk entry.
  const applied = runtime.setGazeAois([
    { id: 'agent_face', x: -0.2, y: -0.25, width: 0.4, height: 0.4 },
    { id: 'bad', x: Number.NaN, y: 0, width: 0.1, height: 0.1 },
  ]);
  assert.equal(applied.length, 1, 'invalid AOI must be dropped by the normalizer');
  assert.equal(applied[0].id, 'agent_face');
  assert.equal(runtime.gazeAggregator.options.aois, applied, 'aggregator must see the new AOIs by reference');
  assert.deepEqual(runtime.settings.gaze_aois, applied, 'settings snapshot must reflect the live update');

  // Samples at screen center land inside agent_face → dwell accrues.
  for (let i = 0; i < 5; i += 1) {
    adapter.emitSample({ x: 0, y: 0, quality: 0.9 });
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const events = transport.batches.flat();
  const withGaze = events.filter(e => e.gaze && e.gaze.aoi_dwell_ms);
  assert.ok(withGaze.length > 0, 'expected a gaze window with aoi_dwell_ms');
  const dwell = withGaze[withGaze.length - 1].gaze.aoi_dwell_ms;
  assert.ok(dwell.agent_face > 0, `expected positive agent_face dwell, got ${JSON.stringify(dwell)}`);
  assert.equal(Object.prototype.hasOwnProperty.call(dwell, 'bad'), false, 'dropped AOI must not appear in dwell');
}

console.log('runtime-gaze.test.js — all cases passed');
