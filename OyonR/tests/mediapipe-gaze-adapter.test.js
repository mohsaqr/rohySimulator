// MediaPipeLandmarkGazeAdapter unit tests.
//
// Covers the failure modes from AGENT-NOTE-GAZE-INTEGRATION.md: lifecycle
// incl. restart (dispose is non-terminal), honest calibration, the
// iris-offset → screen-point mapping, diagnostics counters for silent-
// absence debugging, and the MockFaceTracker iris-landmark geometry that
// the runtime e2e test relies on.

import assert from 'node:assert/strict';
import {
  MediaPipeLandmarkGazeAdapter,
  featuresToGazeSample,
  MEDIAPIPE_GAZE_MODEL,
} from '../src/inference/MediaPipeLandmarkGazeAdapter.js';
import { extractEyeFeatures } from '../src/inference/EyeFeatureExtractor.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';

function blinkBlendshapes({ left = 0, right = 0 } = {}) {
  return [
    { categoryName: 'eyeBlinkLeft', score: left },
    { categoryName: 'eyeBlinkRight', score: right },
  ];
}

async function faceWithIris(irisOffsets, blendshapes) {
  const tracker = new MockFaceTracker({
    irisOffsets,
    ...(blendshapes ? { mockBlendshapes: blendshapes } : {}),
  });
  return tracker.analyze();
}

// ─── 1: constructor validation + capability flag ─────────────────────────
{
  assert.throws(() => new MediaPipeLandmarkGazeAdapter(), /onGaze/);
  assert.throws(() => new MediaPipeLandmarkGazeAdapter({ onGaze: 'nope' }), /onGaze/);
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: () => {} });
  assert.equal(adapter.requiresCalibration, false);
}

// ─── 2: lifecycle — init/start/status, idempotent non-terminal dispose ───
{
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: () => {} });
  assert.equal(adapter.status(), null);
  await assert.rejects(() => adapter.start(), /init\(\) before start\(\)/);

  await adapter.init();
  assert.equal(adapter.status(), 'idle');
  await adapter.start();
  assert.equal(adapter.status(), 'inference');

  adapter.dispose();
  adapter.dispose(); // idempotent
  assert.equal(adapter.status(), 'idle');

  // Non-terminal: same-instance restart (the chatoyon failure mode).
  await adapter.init();
  await adapter.start();
  assert.equal(adapter.status(), 'inference');
}

// ─── 3: honest calibration result + calibrationRuns counter ─────────────
{
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: () => {} });
  await adapter.init();
  const result = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.deepEqual(result, {
    ok: true,
    quality: null,
    confidence: 'inferred',
    model: MEDIAPIPE_GAZE_MODEL,
  });
  assert.equal(adapter.diagnostics().calibrationRuns, 1);
}

// ─── 4: handleFace mapping — gains, flipX, timestamps, quality ───────────
{
  const samples = [];
  const CLOCK_MS = 123456;
  const adapter = new MediaPipeLandmarkGazeAdapter({
    onGaze: (s) => samples.push(s),
    clock: () => CLOCK_MS,
  });
  await adapter.init();
  await adapter.start();

  const face = await faceWithIris({ l: { x: 0.1, y: 0 }, r: { x: 0.1, y: 0 } });
  adapter.handleFace(face, 777);

  assert.equal(samples.length, 1);
  const s = samples[0];
  // flipX × xGain(2.0) × meanX(0.1) → -0.2
  assert.ok(Math.abs(s.x - (-0.2)) < 1e-9, `x should be -0.2, got ${s.x}`);
  assert.equal(s.y, 0);
  assert.ok(s.quality > 0.999, `identical eyes → ~zero disagreement, got ${s.quality}`);
  assert.equal(s.quality_source, 'geometric');
  assert.equal(s.valid, true);
  assert.equal(s.gaze_state, 'open');
  assert.equal(s.ts_ms, CLOCK_MS);
  assert.equal(s.ts_video_ms, 777);

  const d = adapter.diagnostics();
  assert.equal(d.rawFrames, 1);
  assert.equal(d.validSamples, 1);
  assert.equal(d.invalidSamples, 0);
  assert.equal(d.lastSampleAt, CLOCK_MS);
}

// ─── 5: clamping at the screen edge ──────────────────────────────────────
{
  const samples = [];
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: (s) => samples.push(s) });
  await adapter.init();
  await adapter.start();
  const face = await faceWithIris({ l: { x: 0.5, y: 0.5 }, r: { x: 0.5, y: 0.5 } });
  adapter.handleFace(face, 1);
  assert.equal(samples[0].x, -0.5); // -2.0 * 0.5 = -1.0 → clamped
  assert.equal(samples[0].y, 0.5);  //  2.5 * 0.5 = 1.25 → clamped
}

// ─── 6: blink handling — one eye capped, both eyes → closed sample ───────
{
  const samples = [];
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: (s) => samples.push(s) });
  await adapter.init();
  await adapter.start();

  // Left eye blinking → only the right offset survives → one-eye quality cap.
  const oneEye = await faceWithIris(
    { l: { x: 0.1, y: 0 }, r: { x: 0.1, y: 0 } },
    blinkBlendshapes({ left: 0.95 }),
  );
  adapter.handleFace(oneEye, 1);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].quality, 0.6);
  assert.equal(samples[0].valid, true); // 0.6 ≥ default 0.3
  assert.equal(samples[0].gaze_state, 'open');

  // Both eyes blinking → emitted closed sample so blinks count in windows.
  const bothEyes = await faceWithIris(
    { l: { x: 0.1, y: 0 }, r: { x: 0.1, y: 0 } },
    blinkBlendshapes({ left: 0.95, right: 0.95 }),
  );
  adapter.handleFace(bothEyes, 2);
  assert.equal(samples.length, 2);
  assert.equal(samples[1].gaze_state, 'closed');
  assert.equal(samples[1].quality, 0);
  assert.equal(samples[1].valid, false);
  assert.equal(samples[1].x, 0);
  assert.equal(samples[1].y, 0);
}

// ─── 7: no face → no emit, counted in diagnostics ────────────────────────
{
  const samples = [];
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: (s) => samples.push(s) });
  await adapter.init();
  await adapter.start();
  adapter.handleFace({ facePresent: false, reason: 'no-face' }, 1);
  assert.equal(samples.length, 0);
  const d = adapter.diagnostics();
  assert.equal(d.rawFrames, 1);
  assert.equal(d.validSamples, 0);
  assert.equal(d.invalidSamples, 1);
}

// ─── 8: no refined irises (legacy empty landmarks) → no emit ─────────────
{
  const samples = [];
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: (s) => samples.push(s) });
  await adapter.init();
  await adapter.start();
  const tracker = new MockFaceTracker(); // no irisOffsets → landmarks: []
  adapter.handleFace(await tracker.analyze(), 1);
  assert.equal(samples.length, 0);
  assert.equal(adapter.diagnostics().invalidSamples, 1);
}

// ─── 9: handleFace before start / after dispose is a silent no-op ────────
{
  const samples = [];
  const adapter = new MediaPipeLandmarkGazeAdapter({ onGaze: (s) => samples.push(s) });
  const face = await faceWithIris({ l: { x: 0, y: 0 }, r: { x: 0, y: 0 } });
  adapter.handleFace(face, 1); // before init
  await adapter.init();
  adapter.handleFace(face, 2); // idle, not started
  await adapter.start();
  adapter.dispose();
  adapter.handleFace(face, 3); // disposed
  assert.equal(samples.length, 0);
  assert.equal(adapter.diagnostics().rawFrames, 0);
}

// ─── 10: onGaze throwing → onError, lastError, continued emission ────────
{
  const errors = [];
  let throwNext = true;
  let delivered = 0;
  const adapter = new MediaPipeLandmarkGazeAdapter({
    onGaze: () => {
      if (throwNext) { throwNext = false; throw new Error('host exploded'); }
      delivered += 1;
    },
    onError: (err) => errors.push(err),
  });
  await adapter.init();
  await adapter.start();
  const face = await faceWithIris({ l: { x: 0, y: 0 }, r: { x: 0, y: 0 } });
  adapter.handleFace(face, 1);
  adapter.handleFace(face, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'host exploded');
  assert.equal(adapter.diagnostics().lastError, 'host exploded');
  assert.equal(delivered, 1);
}

// ─── 11: featuresToGazeSample pure helper edge cases ─────────────────────
{
  assert.equal(featuresToGazeSample(null), null);
  // One-eye-only offsets (other eye null).
  const sample = featuresToGazeSample({
    blink_l: false,
    blink_r: false,
    iris_offset_normalized: { l: null, r: { x: -0.2, y: 0.1 } },
  }, {}, 10, 20);
  assert.ok(Math.abs(sample.x - 0.4) < 1e-9);  // -2.0 * -0.2
  assert.ok(Math.abs(sample.y - 0.25) < 1e-9); //  2.5 * 0.1
  assert.equal(sample.quality, 0.6);
  // flipX off.
  const noFlip = featuresToGazeSample({
    blink_l: false,
    blink_r: false,
    iris_offset_normalized: { l: { x: 0.1, y: 0 }, r: { x: 0.1, y: 0 } },
  }, { flipX: false }, 10, null);
  assert.ok(Math.abs(noFlip.x - 0.2) < 1e-9);
  assert.equal(noFlip.ts_video_ms, null);
  // Disagreeing eyes lose quality.
  const disagree = featuresToGazeSample({
    blink_l: false,
    blink_r: false,
    iris_offset_normalized: { l: { x: 0.15, y: 0 }, r: { x: -0.15, y: 0 } },
  }, {}, 10, null);
  assert.equal(disagree.quality, 0); // dist 0.3 / span 0.3 → 1 - 1 = 0
  assert.equal(disagree.valid, false);
}

// ─── 12: MockFaceTracker iris geometry round-trips through the real
//         EyeFeatureExtractor ─────────────────────────────────────────────
{
  const tracker = new MockFaceTracker({ irisOffsets: { l: { x: 0.1, y: -0.05 }, r: { x: 0.1, y: -0.05 } } });
  const face = await tracker.analyze();
  assert.equal(face.landmarks.length, 478);
  const features = extractEyeFeatures(face, {});
  assert.ok(features.valid);
  assert.ok(Math.abs(features.iris_offset_normalized.l.x - 0.1) < 1e-6);
  assert.ok(Math.abs(features.iris_offset_normalized.l.y - (-0.05)) < 1e-6);
  assert.ok(Math.abs(features.iris_offset_normalized.r.x - 0.1) < 1e-6);

  // Per-eye null offset → null normalized offset for that eye.
  const oneEyeTracker = new MockFaceTracker({ irisOffsets: { l: null, r: { x: 0, y: 0 } } });
  const oneEyeFeatures = extractEyeFeatures(await oneEyeTracker.analyze(), {});
  assert.equal(oneEyeFeatures.iris_offset_normalized.l, null);
  assert.ok(oneEyeFeatures.iris_offset_normalized.r);

  // Legacy default stays empty.
  const legacy = new MockFaceTracker();
  assert.deepEqual((await legacy.analyze()).landmarks, []);

  // setIrisOffsets toggles at runtime.
  legacy.setIrisOffsets({ l: { x: 0, y: 0 }, r: { x: 0, y: 0 } });
  assert.equal((await legacy.analyze()).landmarks.length, 478);
}

console.log('mediapipe-gaze-adapter.test.js — all cases passed');
