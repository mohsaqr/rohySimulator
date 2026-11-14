import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}
function makeStubCamera() {
  let t = 0;
  return { video: { get readyState() { return 2; }, get currentTime() { t += 1; return t; }, videoWidth: 640, videoHeight: 480 }, async start() {}, stop() {} };
}

// Stub estimator: real Date.now() timing can't be driven in-loop, so the DSP
// is validated in heart-rate.test.js; here we test the runtime wiring.
function makeStubEstimator() {
  return {
    added: 0,
    addSample() { this.added += 1; },
    estimate() { return { bpm: 68, snr: 4, confidence: 0.5, fs: 30, n_samples: 300, method: 'pos' }; },
    status() { return { ready: true, progress: 1, span_seconds: 10, sample_rate_hz: 30, reason: null }; },
    reset() { this.added = 0; },
  };
}

// ---------- Test 1: flag off ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { heart_rate_enabled: false, sample_interval_ms: 1000, aggregate_window_ms: 2000, min_valid_frames: 1 },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });
  assert.equal(runtime.heartRateEnabled, false);
  assert.equal(runtime.heartRateEstimator, null);

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  for (const event of transport.batches.flat()) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'heart_rate'), false,
      `flag-off event must not include heart_rate: ${JSON.stringify(Object.keys(event))}`);
  }
}

// ---------- Test 2: flag on — heart_rate block + sample + validator ----------
{
  const transport = new CapturingTransport();
  const stub = makeStubEstimator();
  let roiCalls = 0;
  const runtime = new EmotionRuntime({
    settings: {
      heart_rate_enabled: true,
      heart_rate_window_share: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    heartRateEstimator: stub,
    roiSampler: () => { roiCalls += 1; return { r: 100, g: 128, b: 120 }; },
  });
  assert.equal(runtime.heartRateEnabled, true);

  const samples = [];
  runtime.on('sample', (e) => samples.push(e));

  // One heavy tick refreshes the bbox but must not acquire ROI colour itself.
  await runtime.sampleOnce();
  assert.equal(roiCalls, 0, 'heavy sampleOnce is decoupled from ROI acquisition');

  // The independent sampler can acquire many colour frames from that cached
  // bbox before the next face/emotion tick.
  const fastStart = Date.now();
  for (let i = 0; i < 30; i += 1) {
    runtime.heartRateSampler.sampleOnce(fastStart + i * (1000 / 30));
  }
  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  assert.equal(roiCalls, 30, 'independent sampler acquired 30 ROI frames between slow ticks');
  assert.equal(stub.added, 30, 'estimator received every independent ROI sample');

  const hrSamples = samples.map((e) => e.heart_rate).filter(Boolean);
  assert.ok(hrSamples.length > 0, 'heart_rate estimate on sample events');
  assert.equal(hrSamples[0].bpm, 68, 'instantaneous bpm on sample event');
  const hrStatuses = samples.map((e) => e.heart_rate_status).filter(Boolean);
  assert.ok(hrStatuses.length > 0, 'heart-rate acquisition status rides every live sample');
  assert.equal(hrStatuses[0].ready, true);
  assert.equal(hrStatuses[0].reason, null, 'a confirmed rate is not labelled rejected');
  assert.equal(hrStatuses[0].motion_paused, false, 'a still head does not report the motion gate');

  const hrEvents = transport.batches.flat().filter((e) => e.heart_rate);
  assert.ok(hrEvents.length > 0,
    `expected a window with heart_rate; keys=${JSON.stringify(transport.batches.flat().map((e) => Object.keys(e)))}`);
  const hr = hrEvents[0].heart_rate;
  assert.ok(Math.abs(hr.bpm_mean - 68) < 1e-9, 'window bpm_mean = 68');
  assert.equal(hr.bpm_last, 68);
  assert.ok(Number.isFinite(hr.valid_frame_ratio), 'valid_frame_ratio numeric');
  assert.equal(hr.method, 'pos');
  assert.equal(typeof hr.model_version, 'string');

  const validation = validateEmotionBatch({ events: hrEvents });
  assert.equal(validation.ok, true, `validator rejected heart_rate batch: ${JSON.stringify(validation.errors)}`);
}

// ---------- Test 3: full buffer + rejected estimate is not "acquiring" ----------
{
  const transport = new CapturingTransport();
  const rejected = {
    addSample() {},
    estimate() { return null; },
    status() { return { ready: true, progress: 1, span_seconds: 10, sample_rate_hz: 16, reason: null }; },
    reset() {},
  };
  const runtime = new EmotionRuntime({
    settings: {
      heart_rate_enabled: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    heartRateEstimator: rejected,
    roiSampler: () => ({ r: 100, g: 128, b: 120 }),
  });
  const samples = [];
  runtime.on('sample', (event) => samples.push(event));
  await runtime.sampleOnce();
  await runtime.stop();
  assert.equal(samples[0].heart_rate, null);
  assert.equal(samples[0].heart_rate_status.ready, true);
  assert.equal(samples[0].heart_rate_status.reason, 'no_stable_rate',
    'a rejected full-buffer estimate must be actionable, not permanent acquisition');
}

// ---------- Test 4: the head-motion gate is reported, and only reported ----------
{
  const transport = new CapturingTransport();
  const stub = makeStubEstimator();
  const runtime = new EmotionRuntime({
    settings: {
      heart_rate_enabled: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    heartRateEstimator: stub,
    roiSampler: () => ({ r: 100, g: 128, b: 120 }),
  });
  // Force the gate: the head is "moving" on this tick.
  runtime._hrHeadMotionPaused = () => true;
  const samples = [];
  runtime.on('sample', (event) => samples.push(event));
  await runtime.sampleOnce();
  await runtime.stop();
  assert.equal(samples[0].heart_rate_status.motion_paused, true, 'motion pause is surfaced on the status');
  assert.equal(samples[0].heart_rate.bpm, 68, 'the gate does not blank the estimate from samples already buffered');
}

console.log('runtime-heart-rate.test.js — all cases passed');
