// EmotionRuntime + MediaPipe landmark gaze engine — end-to-end tests for the
// AGENT-NOTE-GAZE-INTEGRATION.md failure modes:
//   1. Default engine emits gaze blocks WITHOUT calibration (single
//      pipeline: face tracker → handleFace → smoother → aggregator).
//   2. Honest empty blocks: enabled-but-dry windows carry n_points: 0
//      instead of silently omitting `gaze`; persistent emptiness warns
//      with adapter diagnostics.
//   3. Calibration-gated engines log (once) instead of silently omitting.
//   4. Restart: start → gaze window → stop → start → gaze window, same
//      runtime + adapter instances.

import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { EmotionAggregator } from '../src/aggregation/EmotionAggregator.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { MockWebEyeTrackAdapter } from '../src/mocks/MockWebEyeTrackAdapter.js';
import { MediaPipeLandmarkGazeAdapter } from '../src/inference/MediaPipeLandmarkGazeAdapter.js';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRuntime({ faceTracker, transport, settings = {}, ...rest }) {
  return new EmotionRuntime({
    settings: {
      gaze_tracking_enabled: true,
      gaze_window_share: true,
      min_valid_frames: 1,
      ...settings,
    },
    camera: makeStubCamera(),
    faceTracker,
    classifier: new MockEmotionClassifier(),
    transport,
    // Settings clamp aggregate_window_ms to ≥1000; inject a fast emotion
    // aggregator directly so in-loop window boundaries (the path that
    // attaches honest-empty gaze blocks) happen within test time.
    aggregator: new EmotionAggregator({ windowMs: 120, minValidFrames: 1, sampleIntervalMs: 30 }),
    ...rest,
  });
}

// Drive sampleOnce across real window boundaries (sampleOnce reads
// Date.now(), so in-loop flushes need wall-clock to pass).
async function driveSamples(runtime, { iterations = 8, gapMs = 35 } = {}) {
  for (let i = 0; i < iterations; i += 1) {
    await runtime.sampleOnce();
    await sleep(gapMs);
  }
}

// ─── Test 1: default engine, NO calibration → gaze blocks flow ───────────
{
  const transport = new CapturingTransport();
  const runtime = makeRuntime({
    transport,
    faceTracker: new MockFaceTracker({ irisOffsets: { l: { x: 0.1, y: 0 }, r: { x: 0.1, y: 0 } } }),
  });

  // The factory picked the landmark adapter from the default settings.
  assert.ok(runtime.gazeAdapter instanceof MediaPipeLandmarkGazeAdapter);
  assert.equal(runtime.settings.gaze_engine, 'mediapipe');
  assert.equal(runtime.settings.gaze_calibration_required, true);
  assert.equal(runtime.gazeCalibrated, false);

  await runtime.init();
  await runtime.gazeAdapter.start();
  await driveSamples(runtime);
  await runtime.stop();

  const events = transport.batches.flat();
  const gazeEvents = events.filter((e) => e.gaze);
  assert.ok(gazeEvents.length > 0, 'expected gaze windows without any calibrateGaze() call');

  const filled = gazeEvents.filter((e) => e.gaze.n_points > 0);
  assert.ok(filled.length > 0, 'expected at least one gaze window with points');
  const g = filled[0].gaze;
  // flipX: iris offset +0.1 → screen x ≈ -0.2 (left half).
  assert.ok(g.centroid.x < 0, `centroid.x should be negative, got ${g.centroid.x}`);
  // Honest uncalibrated metadata.
  assert.equal(g.calibration_quality, null);
  assert.equal(g.calibration_confidence, 'unknown');
  assert.equal(g.calibration_age_ms, null);
  assert.equal(g.model_version, 'mediapipe-landmarks');

  const validation = validateEmotionBatch({ events: gazeEvents });
  assert.equal(validation.ok, true,
    `validator rejected landmark-gaze batch: ${JSON.stringify(validation.errors)}`);

  // Diagnostics saw every frame.
  const d = runtime.gazeAdapter.diagnostics();
  assert.ok(d.rawFrames >= 8, `adapter should have seen all frames, saw ${d.rawFrames}`);
  assert.ok(d.validSamples > 0);
}

// ─── Test 2: honest empty blocks + persistent_empty warning ──────────────
{
  const transport = new CapturingTransport();
  const runtime = makeRuntime({
    transport,
    // No irisOffsets → legacy empty landmarks → adapter emits nothing.
    faceTracker: new MockFaceTracker(),
  });

  await runtime.init();
  await runtime.gazeAdapter.start();
  await driveSamples(runtime, { iterations: 18, gapMs: 35 });
  // Snapshot before stop(): the stop-flush window intentionally skips
  // emit-empty (no empty gaze-only noise at shutdown) — the honest-empty
  // contract applies to in-loop window boundaries.
  const inLoopWindows = transport.batches.flat();
  await runtime.stop();

  assert.ok(inLoopWindows.length >= 3, `need ≥3 in-loop windows to test persistence, got ${inLoopWindows.length}`);
  for (const e of inLoopWindows) {
    assert.ok(e.gaze, 'gaze-enabled in-loop windows must include a gaze block even when empty');
    assert.equal(e.gaze.n_points, 0);
    assert.equal(e.gaze.valid_frame_ratio, 0);
    assert.equal(e.gaze.centroid, null);
  }

  const validation = validateEmotionBatch({ events: inLoopWindows });
  assert.equal(validation.ok, true,
    `validator rejected empty gaze blocks: ${JSON.stringify(validation.errors)}`);

  // Structured diagnostics fired after 3 consecutive empties.
  const warns = runtime.logger.read().filter((ev) => ev.event_name === 'oyon.gaze.persistent_empty');
  assert.ok(warns.length > 0, 'expected oyon.gaze.persistent_empty warning');
  const detail = warns[0].details || warns[0];
  assert.ok(detail.diagnostics, 'warning should carry adapter diagnostics');
  assert.ok(detail.diagnostics.rawFrames > 0);
  assert.equal(detail.diagnostics.validSamples, 0);
}

// ─── Test 3: calibration-gated engine logs once instead of silence ───────
{
  const transport = new CapturingTransport();
  const adapter = new MockWebEyeTrackAdapter({ onGaze: () => {} });
  const runtime = makeRuntime({
    transport,
    faceTracker: new MockFaceTracker(),
    settings: { gaze_engine: 'webeyetrack', gaze_calibration_required: true },
    webEyeTrackAdapter: adapter,
  });

  await runtime.init();
  await adapter.start();
  await driveSamples(runtime, { iterations: 10, gapMs: 35 });

  const events = transport.batches.flat();
  for (const e of events) {
    assert.equal(Object.prototype.hasOwnProperty.call(e, 'gaze'), false,
      'uncalibrated webeyetrack windows must omit gaze (gate intact)');
  }
  const gateLogs = runtime.logger.read().filter((ev) => ev.event_name === 'oyon.gaze.gated_awaiting_calibration');
  assert.equal(gateLogs.length, 1, `gate log must fire exactly once, got ${gateLogs.length}`);
  await runtime.stop();
}

// ─── Test 4: restart — gaze windows flow again after stop()/start() ──────
{
  const transport = new CapturingTransport();
  const runtime = makeRuntime({
    transport,
    faceTracker: new MockFaceTracker({ irisOffsets: { l: { x: -0.05, y: 0.05 }, r: { x: -0.05, y: 0.05 } } }),
  });

  // Phase 1.
  await runtime.init();
  await runtime.gazeAdapter.start();
  await driveSamples(runtime, { iterations: 5, gapMs: 35 });
  await runtime.stop(); // disposes the adapter
  assert.equal(runtime.gazeAdapter.status(), 'idle');

  const phase1Batches = transport.batches.length;
  const phase1Gaze = transport.batches.flat().filter((e) => e.gaze && e.gaze.n_points > 0);
  assert.ok(phase1Gaze.length > 0, 'phase 1 must persist a gaze window');

  // Phase 2: same runtime + adapter instances (dispose is non-terminal for
  // the landmark adapter — the chatoyon restart failure mode).
  await runtime.gazeAdapter.start();
  assert.equal(runtime.gazeAdapter.status(), 'inference');
  await driveSamples(runtime, { iterations: 5, gapMs: 35 });
  await runtime.stop();

  const phase2Gaze = transport.batches.slice(phase1Batches).flat()
    .filter((e) => e.gaze && e.gaze.n_points > 0);
  assert.ok(phase2Gaze.length > 0, 'phase 2 (after restart) must persist a new gaze window');
}

console.log('runtime-mediapipe-gaze.test.js — all cases passed');
