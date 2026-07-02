import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';
import { settingsSnapshot } from '../src/settings/OyonSettings.js';

// A minimal in-memory transport that captures sent batches.
class CapturingTransport {
  constructor() {
    this.batches = [];
  }
  async send(events /* , context */) {
    this.batches.push(events);
  }
}

// Stub camera that satisfies the readyState gate.
function makeStubCamera() {
  return {
    video: { readyState: 2 },
    async start() {},
    stop() {},
  };
}

// A scripted eye extractor returning a known feature object regardless of input.
function makeScriptedEyeExtractor() {
  let tick = 0;
  return {
    extract() {
      tick += 1;
      return {
        eye_openness_l: 0.9,
        eye_openness_r: 0.9,
        blink_l: false,
        blink_r: false,
        iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
        gaze_zone: 'center',
        valid: true,
        ts_ms: tick,
      };
    },
  };
}

// ---------- Test 1: flag off — exact v0.2.2 behavior ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      eye_tracking_enabled: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });

  assert.equal(runtime.eyeEnabled, false);
  assert.equal(runtime.eyeExtractor, null);
  assert.equal(runtime.eyeSmoother, null);
  assert.equal(runtime.engagementAggregator, null);

  // Drive enough samples to cross a window boundary.
  await runtime.sampleOnce();
  await runtime.sampleOnce();
  await runtime.sampleOnce();
  await runtime.sampleOnce();
  await runtime.stop();

  // No batch event should carry an engagement field.
  const allEvents = transport.batches.flat();
  assert.ok(allEvents.length > 0, 'expected at least one window batch');
  for (const event of allEvents) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'engagement'), false,
      `flag-off event must not include engagement field: ${JSON.stringify(event)}`);
  }

  // No oyon.engagement.* logs should be present.
  const engagementLogs = runtime.logger.read().filter(e =>
    e.event_name && e.event_name.startsWith('oyon.engagement.'));
  assert.equal(engagementLogs.length, 0,
    `flag-off must not emit engagement logs; found ${JSON.stringify(engagementLogs)}`);
}

// ---------- Test 2: flag on, shared window — engagement block + log + validator pass ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      eye_tracking_enabled: true,
      engagement_window_share: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    eyeExtractor: makeScriptedEyeExtractor(),
    // Use real EyeSmoother and EngagementAggregator from the runtime defaults.
  });

  assert.equal(runtime.eyeEnabled, true);
  assert.ok(runtime.eyeExtractor);
  assert.ok(runtime.eyeSmoother);
  assert.ok(runtime.engagementAggregator);

  const samples = [];
  runtime.on('sample', event => samples.push(event));

  // Drive enough samples to cross at least one window boundary.
  for (let i = 0; i < 5; i += 1) {
    await runtime.sampleOnce();
  }
  await runtime.stop();

  const eyeSamples = samples.map(event => event.eye).filter(Boolean);
  assert.ok(eyeSamples.length > 0, 'expected privacy-safe eye samples on sample events');
  assert.equal(eyeSamples[0].valid, true);
  assert.equal(eyeSamples[0].gaze_zone, 'center');
  assert.equal(Object.prototype.hasOwnProperty.call(eyeSamples[0], 'raw'), false,
    'sample event must not expose raw eye payload');

  const allEvents = transport.batches.flat();
  const engagementEvents = allEvents.filter(e => e.engagement);
  assert.ok(engagementEvents.length > 0,
    `expected at least one batch event with engagement; got events=${JSON.stringify(allEvents.map(e => Object.keys(e)))}`);

  // Shape check on the first engagement-bearing event.
  const e = engagementEvents[0].engagement;
  assert.ok(Number.isFinite(e.focus_score) || e.focus_score === null,
    'focus_score must be a number or null');
  assert.ok(Number.isFinite(e.blink_rate_hz) || e.blink_rate_hz === null);
  assert.ok(Number.isFinite(e.valid_frame_ratio));
  assert.ok(e.gaze_zone_proportions && Number.isFinite(e.gaze_zone_proportions.center));
  // Scripted iris was centered with no blinks → center proportion close to 1.
  assert.ok(e.gaze_zone_proportions.center > 0.9,
    `expected center proportion near 1, got ${e.gaze_zone_proportions.center}`);

  // oyon.engagement.window log was emitted.
  const engagementLogs = runtime.logger.read().filter(ev =>
    ev.event_name === 'oyon.engagement.window');
  assert.ok(engagementLogs.length > 0, 'expected at least one oyon.engagement.window log');

  // Validator accepts the batched payload.
  const validation = validateEmotionBatch({ events: engagementEvents });
  assert.equal(validation.ok, true,
    `validator rejected engagement batch: ${JSON.stringify(validation.errors)}`);
}

// ---------- Test 4: engagement survives an in-loop natural flush boundary ----------
// Regression: if the engagement aggregator's own consumeFrame naturally flushes
// at the same boundary as the emotion aggregator, the runtime must use that
// flushed window rather than calling flush() a second time (which would return
// null on an empty buffer and overwrite the engagement field).
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      eye_tracking_enabled: true,
      engagement_window_share: true,
      sample_interval_ms: 50,
      aggregate_window_ms: 100,    // small enough that real time crosses it during the loop
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    eyeExtractor: makeScriptedEyeExtractor(),
  });

  // Drive sampleOnce calls with real setTimeout between them so the wall-clock
  // timestamp inside the aggregator crosses windowMs and triggers natural flush
  // BEFORE stop() is called.
  for (let i = 0; i < 6; i += 1) {
    await runtime.sampleOnce();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await runtime.stop();

  const allEvents = transport.batches.flat();
  const engagementEvents = allEvents.filter(e => e.engagement);
  assert.ok(engagementEvents.length > 0,
    `expected at least one in-loop window with engagement, got ${allEvents.length} events with keys ${JSON.stringify(allEvents.map(e => Object.keys(e).filter(k => k === 'engagement')))}`);
  // At least one engagement block came from the in-loop flush (not just the
  // final stop() flush). If only the final flush attached engagement, only
  // the last event would have it. Assert multiple if there were multiple
  // emotion-bearing events.
  const eventsWithEmotion = allEvents.filter(e => e.dominant_emotion !== undefined);
  if (eventsWithEmotion.length > 1) {
    assert.ok(engagementEvents.length >= eventsWithEmotion.length - 1,
      `engagement should attach to in-loop windows too, not just the final stop() flush; events=${eventsWithEmotion.length}, engagement=${engagementEvents.length}`);
  }
}

// ---------- Test 3: settings_hash differs when the flag toggles ----------
{
  const off = settingsSnapshot({ eye_tracking_enabled: false });
  const on = settingsSnapshot({ eye_tracking_enabled: true });
  assert.notEqual(off.settings_hash, on.settings_hash,
    'settings_hash should differ when eye_tracking_enabled toggles');
}

console.log('runtime-engagement.test.js passed');
