import assert from 'node:assert/strict';
import { WebEyeTrackAdapter, normalizeGazeResult } from '../src/inference/WebEyeTrackAdapter.js';
import { MockWebEyeTrackAdapter } from '../src/mocks/MockWebEyeTrackAdapter.js';

// ─── normalizeGazeResult — pure shape tests ────────────────────────────────

{
  // A — Open eyes, centered gaze → valid, high quality, both timestamps populated.
  const s = normalizeGazeResult(
    { normPog: [0.1, -0.2], gazeState: 'open', timestamp: 1234 },
    9000,
    0.3,
  );
  assert.equal(s.x, 0.1);
  assert.equal(s.y, -0.2);
  assert.equal(s.gaze_state, 'open');
  assert.equal(s.valid, true);
  assert.ok(s.quality > 0.9, `expected high quality for centered gaze, got ${s.quality}`);
  assert.equal(s.quality_source, 'geometric');
  assert.equal(s.ts_ms, 9000);
  assert.equal(s.ts_video_ms, 1234);
}

{
  // B — Closed eyes → quality 0, valid false (blink masking).
  const s = normalizeGazeResult(
    { normPog: [0.0, 0.0], gazeState: 'closed', timestamp: 0 },
    0,
    0.3,
  );
  assert.equal(s.quality, 0);
  assert.equal(s.valid, false);
  assert.equal(s.gaze_state, 'closed');
}

{
  // C — Missing normPog or wrong shape → drop the frame (returns null).
  assert.equal(normalizeGazeResult(null, 0), null);
  assert.equal(normalizeGazeResult({}, 0), null);
  assert.equal(normalizeGazeResult({ normPog: [0.1] }, 0), null);
  assert.equal(normalizeGazeResult({ normPog: [NaN, 0] }, 0), null);
  assert.equal(normalizeGazeResult({ normPog: [0, 'x'] }, 0), null);
}

{
  // D — Off-screen point (beyond [-0.5, 0.5]) attenuates quality.
  const s = normalizeGazeResult(
    { normPog: [0.9, 0.0], gazeState: 'open' },
    0,
    0.3,
  );
  assert.ok(s.quality < 1, `off-axis should reduce quality, got ${s.quality}`);
  assert.equal(s.gaze_state, 'open');
}

{
  // E — Below-threshold quality → valid:false but sample preserved.
  const s = normalizeGazeResult(
    { normPog: [2.0, 0.0], gazeState: 'open' },
    0,
    0.3,
  );
  assert.equal(s.valid, false);
  assert.equal(s.x, 2.0);
}

// ─── Real adapter — construction + lifecycle errors ─────────────────────────

{
  // F — Constructor validates required options.
  assert.throws(() => new WebEyeTrackAdapter({}), /videoElementId/);
  assert.throws(() => new WebEyeTrackAdapter({ videoElementId: 'video' }), /onGaze/);
}

{
  // G — Real adapter constructor does NOT throw when peer dep missing;
  //     init() is the place that throws a clear, structured error.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  await assert.rejects(async () => adapter.init(), /webeyetrack/);
}

{
  // H — start() before init() throws.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  await assert.rejects(async () => adapter.start(), /init\(\) before start\(\)/);
}

{
  // H2 — WebEyeTrackProxy owns WebcamClient.startWebcam(callback). The adapter
  //       must not call startWebcam() again and create a duplicate frame loop.
  let startCalls = 0;
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  adapter._initialized = true;
  adapter._webcamClient = { async startWebcam() { startCalls += 1; } };
  await adapter.start();
  await adapter.start();
  assert.equal(adapter._started, true);
  assert.equal(startCalls, 0);
}

{
  // I — dispose() is idempotent and never throws.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  adapter.dispose();
  adapter.dispose();
  // After dispose, init() must fail explicitly.
  await assert.rejects(async () => adapter.init(), /after dispose/);
}

{
  // J — calibrate([]) before init returns structured error.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  const r = await adapter.calibrate([]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient_samples');
}

{
  // J2 — Upstream status 'idle' after clicks is a valid running state, not
  //      a calibration failure. The proxy flips calib → idle → inference;
  //      the adapter should use its own lifecycle flag for running checks.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  adapter._initialized = true;
  adapter._started = true;
  adapter._proxy = { status: 'idle' };
  const r = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.model, 'webeyetrack-0.0.2');
  // Upstream does not surface a quality reading → honest 'unknown' / null.
  assert.equal(r.quality, null);
  assert.equal(r.confidence, 'unknown');
}

{
  // J3 — Still reject when the adapter lifecycle has not started.
  const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze: () => {} });
  adapter._initialized = true;
  adapter._started = false;
  adapter._proxy = { status: 'idle' };
  const r = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'adapter_not_running');
}

// ─── Mock adapter — full contract used by downstream tests ─────────────────

{
  // K — Mock requires onGaze.
  assert.throws(() => new MockWebEyeTrackAdapter({}), /onGaze/);
}

{
  // L — Mock lifecycle: init → start → emitSample → callback fires.
  const received = [];
  const adapter = new MockWebEyeTrackAdapter({ onGaze: (s) => received.push(s) });
  await adapter.init();
  await adapter.start();
  adapter.emitSample({ x: 0.2, y: -0.1, quality: 0.9 });
  adapter.emitSample({ x: 0.0, y: 0.0, gaze_state: 'closed' });
  assert.equal(received.length, 2);
  assert.equal(received[0].valid, true);
  assert.equal(received[0].x, 0.2);
  assert.equal(received[1].valid, false);
  assert.equal(received[1].gaze_state, 'closed');
  // ts_ms is populated from the clock; ts_video_ms increments.
  assert.ok(Number.isFinite(received[0].ts_ms));
  assert.ok(received[1].ts_video_ms > received[0].ts_video_ms);
}

{
  // M — Sequence helper.
  const received = [];
  const adapter = new MockWebEyeTrackAdapter({ onGaze: (s) => received.push(s) });
  await adapter.init();
  await adapter.start();
  adapter.emitSequence([
    { x: -0.4, y: -0.4 },
    { x: 0, y: 0 },
    { x: 0.4, y: 0.4 },
  ]);
  assert.equal(received.length, 3);
  assert.equal(received[0].x, -0.4);
  assert.equal(received[2].y, 0.4);
}

{
  // N — Samples emitted before start() are silently dropped.
  const received = [];
  const adapter = new MockWebEyeTrackAdapter({ onGaze: (s) => received.push(s) });
  await adapter.init();
  adapter.emitSample({ x: 0, y: 0 });
  assert.equal(received.length, 0);
}

{
  // O — calibrate([]) → insufficient_samples.
  const adapter = new MockWebEyeTrackAdapter({ onGaze: () => {} });
  await adapter.init();
  const r = await adapter.calibrate([]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient_samples');
}

{
  // P — calibrate() with fewer than minCalibrationSamples → insufficient.
  const adapter = new MockWebEyeTrackAdapter({ onGaze: () => {}, minCalibrationSamples: 9 });
  await adapter.init();
  const r = await adapter.calibrate([{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient_samples');
}

{
  // Q — Full 9-point calibration succeeds; quality + model surfaced; age advances.
  let now = 1000;
  const clock = () => now;
  const adapter = new MockWebEyeTrackAdapter({
    onGaze: () => {},
    minCalibrationSamples: 9,
    calibrationQuality: 0.77,
    modelName: 'mock-blazegaze',
    clock,
  });
  await adapter.init();
  const pts = Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) * 0.4 - 0.4, y: Math.floor(i / 3) * 0.4 - 0.4 }));
  const r = await adapter.calibrate(pts);
  assert.equal(r.ok, true);
  assert.equal(r.quality, 0.77);
  assert.equal(r.confidence, 'measured');
  assert.equal(r.model, 'mock-blazegaze');
  assert.equal(adapter.calibrationQuality(), 0.77);
  assert.equal(adapter.calibrationAgeMs(), 0);
  now = 1500;
  assert.equal(adapter.calibrationAgeMs(), 500);
}

{
  // R — Status before init is null; after start() is 'inference'; after dispose() is 'idle'.
  const adapter = new MockWebEyeTrackAdapter({ onGaze: () => {} });
  assert.equal(adapter.status(), null);
  await adapter.init();
  assert.equal(adapter.status(), 'idle');
  await adapter.start();
  assert.equal(adapter.status(), 'inference');
  adapter.dispose();
  assert.equal(adapter.status(), 'idle');
}

{
  // S — Mock dispose() is idempotent and dropping samples after dispose is safe.
  const received = [];
  const adapter = new MockWebEyeTrackAdapter({ onGaze: (s) => received.push(s) });
  await adapter.init();
  await adapter.start();
  adapter.dispose();
  adapter.dispose();
  adapter.emitSample({ x: 0.1, y: 0.1 });
  assert.equal(received.length, 0);
}

console.log('web-eye-track-adapter.test.js — all cases passed');
