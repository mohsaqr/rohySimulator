import assert from 'node:assert/strict';
import { EngagementAggregator } from '../src/aggregation/EngagementAggregator.js';

// ---------- helpers ----------

function makeValidFrame(overrides = {}) {
  const base = {
    eye_openness_l: 0.9,
    eye_openness_r: 0.9,
    blink_l: false,
    blink_r: false,
    iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
    gaze_zone: 'center',
    valid: true,
    smoothed: true,
    raw: {
      eye_openness_l: 0.9,
      eye_openness_r: 0.9,
      blink_l: false,
      blink_r: false,
    },
    ts_ms: 0,
  };
  return { ...base, ...overrides };
}

function makeInvalidFrame(overrides = {}) {
  return {
    eye_openness_l: 0,
    eye_openness_r: 0,
    blink_l: true,
    blink_r: true,
    iris_offset_normalized: { l: null, r: null },
    gaze_zone: null,
    valid: false,
    smoothed: false,
    raw: {
      eye_openness_l: 0,
      eye_openness_r: 0,
      blink_l: true,
      blink_r: true,
    },
    ts_ms: 0,
    ...overrides,
  };
}

// ---------- A. Empty buffer flush ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  assert.equal(agg.flush(1000), null, 'empty buffer flush should return null');
}

// ---------- B. All-invalid frames ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  let last = null;
  for (let i = 0; i < 5; i += 1) {
    const ts = i * 2000;
    last = agg.consumeFrame(makeInvalidFrame({ ts_ms: ts }), ts);
  }
  // After 5 frames @ 0,2000,4000,6000,8000 — none past 10s. Flush manually.
  const win = last || agg.flush(10000);
  assert.ok(win, 'should produce a window block');
  assert.equal(win.valid_frames, 0, 'no valid frames');
  assert.equal(win.valid_frame_ratio, 0, 'valid frame ratio is 0');
  assert.equal(win.eye_openness_mean, null, 'no openness stats');
  assert.equal(win.eye_openness_std, null, 'no openness std');
  assert.equal(win.gaze_zone_proportions, null, 'no zone proportions');
  assert.equal(win.gaze_entropy, null, 'no gaze entropy');
  assert.equal(win.focus_score, null, 'focus score null when no valid frames');
  assert.equal(win.focus_score_components, null, 'components null when no valid frames');
  assert.equal(win.model_version, 'mediapipe-blendshapes-v1');
}

// ---------- C. Static valid stream ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    const ts = i * 500;
    last = agg.consumeFrame(makeValidFrame({
      ts_ms: ts,
      eye_openness_l: 0.9,
      eye_openness_r: 0.9,
      gaze_zone: 'center',
      iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
      raw: {
        eye_openness_l: 0.9, eye_openness_r: 0.9,
        blink_l: false, blink_r: false,
      },
    }), ts);
  }
  const win = last || agg.flush(10000);
  assert.ok(win, 'static stream produces a window');
  assert.ok(Math.abs(win.gaze_entropy - 0) < 1e-9, `gaze_entropy ~ 0, got ${win.gaze_entropy}`);
  assert.ok(win.gaze_zone_proportions, 'has zone proportions');
  assert.ok(Math.abs(win.gaze_zone_proportions.center - 1) < 1e-9, `center ~ 1, got ${win.gaze_zone_proportions.center}`);
  assert.equal(win.blink_count, 0, 'no blinks');
  assert.equal(win.blink_rate_hz, 0, 'blink rate 0');
  assert.ok(win.focus_score > 0.7, `focus_score should be high, got ${win.focus_score}`);
  assert.ok(win.focus_score_components, 'components emitted');
  assert.ok(Math.abs(win.eye_openness_mean - 0.9) < 1e-9, `mean openness ~ 0.9, got ${win.eye_openness_mean}`);
}

// ---------- D. Chaotic gaze sweeping x-bins ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  let last = null;
  // 25 frames sweeping the 5 x-bins, y=0 (mid).
  for (let i = 0; i < 25; i += 1) {
    const ts = i * 400;
    const x = -0.5 + (i % 5) * 0.25 - 0.25;
    last = agg.consumeFrame(makeValidFrame({
      ts_ms: ts,
      iris_offset_normalized: { l: { x, y: 0 }, r: { x, y: 0 } },
      gaze_zone: 'center',
    }), ts);
  }
  const win = last || agg.flush(10000);
  assert.ok(win, 'chaotic stream produces a window');
  assert.ok(win.gaze_entropy > 0.3, `gaze_entropy should exceed 0.3, got ${win.gaze_entropy}`);
}

// ---------- E. Blink-edge counting ----------
{
  const agg = new EngagementAggregator({ windowMs: 100000 });
  const blinkSequence = [false, true, true, false, true, false, true];
  // 3 rising edges: index 1 (false->true), index 4 (false->true), index 6 (false->true).
  for (let i = 0; i < blinkSequence.length; i += 1) {
    const ts = i * 100;
    const isBlink = blinkSequence[i];
    const frame = makeValidFrame({
      ts_ms: ts,
      blink_l: isBlink,
      blink_r: false,
      raw: {
        eye_openness_l: isBlink ? 0.1 : 0.9,
        eye_openness_r: 0.9,
        blink_l: isBlink,
        blink_r: false,
      },
      valid: !isBlink,
      smoothed: !isBlink,
    });
    agg.consumeFrame(frame, ts);
  }
  const win = agg.flush(1000);
  assert.equal(win.blink_count, 3, `blink_count should be 3, got ${win.blink_count}`);
}

// ---------- F. Single-eye blink masking ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  for (let i = 0; i < 10; i += 1) {
    const ts = i * 500;
    agg.consumeFrame(makeValidFrame({
      ts_ms: ts,
      iris_offset_normalized: { l: null, r: { x: 0, y: 0 } },
      gaze_zone: 'center',
    }), ts);
  }
  const win = agg.flush(5000);
  assert.ok(win, 'single-eye blink mask stream still produces a window');
  assert.ok(Math.abs(win.gaze_entropy - 0) < 1e-9,
    `single-bin entropy ~ 0, got ${win.gaze_entropy}`);
}

// ---------- G. Buffer cleared after flush ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  for (let i = 0; i < 5; i += 1) {
    const ts = i * 500;
    agg.consumeFrame(makeValidFrame({ ts_ms: ts }), ts);
  }
  const first = agg.flush(2500);
  assert.ok(first, 'first flush yields a window');
  const second = agg.flush(2600);
  assert.equal(second, null, 'second flush immediately should be null');
  // New frame starts a fresh window.
  const next = agg.consumeFrame(makeValidFrame({ ts_ms: 3000 }), 3000);
  assert.equal(next, null, 'new frame after flush does not immediately flush');
  const third = agg.flush(3500);
  assert.ok(third, 'flush after new frame produces a window');
  assert.equal(third.total_frames, 1, 'only the one new frame');
}

// ---------- H. Constructor rejects bad weights ----------
{
  assert.throws(
    () => new EngagementAggregator({
      focusScoreWeights: { blink_penalty: 0.4, openness: 0.4, gaze_stability: 0.4 },
    }),
    /focusScoreWeights must sum to 1/,
  );
}

// ---------- I. focus_score_components emitted even when gaze_entropy null ----------
{
  // Frames are valid + smoothed but with no iris offsets (single-eye blink-mask of BOTH eyes
  // is impossible by definition of "valid", so we instead build frames where the smoother
  // produced valid openness but the iris offset is null for both eyes — emulating a state
  // where blink-mask cleared both eyes' iris but the frame is still considered valid by
  // the upstream contract for the test purposes).
  const agg = new EngagementAggregator({ windowMs: 10000 });
  for (let i = 0; i < 5; i += 1) {
    const ts = i * 500;
    agg.consumeFrame(makeValidFrame({
      ts_ms: ts,
      iris_offset_normalized: { l: null, r: null },
      gaze_zone: null,
      eye_openness_l: 0.8,
      eye_openness_r: 0.8,
    }), ts);
  }
  const win = agg.flush(3000);
  assert.equal(win.gaze_entropy, null, 'no iris -> null entropy');
  assert.ok(win.focus_score_components, 'components still emitted');
  assert.ok(Math.abs(win.focus_score_components.gaze_stability - 1) < 1e-9,
    `gaze_stability_component should be 1 when entropy is null, got ${win.focus_score_components.gaze_stability}`);
  assert.ok(win.focus_score !== null, 'focus_score present when openness mean is defined');
}

// ---------- J. Privacy invariant: landmarks not retained after flush ----------
{
  const agg = new EngagementAggregator({ windowMs: 10000 });
  // Embed a unique marker in the landmark payload; after flush we should not
  // be able to find it in any retained state.
  const SECRET_MARKER = 0.123456789;
  const landmarks = [];
  for (let i = 0; i < 200; i += 1) {
    landmarks.push({ x: SECRET_MARKER, y: SECRET_MARKER, z: SECRET_MARKER });
  }
  const frame = makeValidFrame({
    ts_ms: 100,
    raw: {
      eye_openness_l: 0.9, eye_openness_r: 0.9,
      blink_l: false, blink_r: false,
      landmarks,
      transformationMatrix: new Float32Array(16),
    },
  });
  agg.consumeFrame(frame, 100);
  agg.flush(2000);

  // After flush, internal buffer should be empty and no reference to the
  // landmark payload should remain. JSON-stringify the aggregator and look
  // for the secret marker substring.
  const serialized = JSON.stringify({
    frames: agg.frames,
    windowStart: agg.windowStart,
    options: agg.options,
  });
  assert.ok(
    !serialized.includes('0.123456789'),
    'aggregator should not retain landmark data after flush',
  );
  assert.equal(agg.frames.length, 0, 'frames buffer cleared');
  assert.equal(agg.windowStart, null, 'windowStart reset');
}

console.log('engagement-aggregator.test.js passed');
