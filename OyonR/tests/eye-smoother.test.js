import assert from 'node:assert/strict';
import { EyeSmoother } from '../src/smoothing/EyeSmoother.js';

// Build a synthetic EyeFeatures object with sensible defaults.
function ef(overrides = {}) {
  const base = {
    eye_openness_l: 0.9,
    eye_openness_r: 0.9,
    blink_l: false,
    blink_r: false,
    iris_offset_normalized: { l: { x: 0, y: 0 }, r: { x: 0, y: 0 } },
    gaze_zone: 'center',
    valid: true,
    ts_ms: 0,
  };
  return { ...base, ...overrides };
}

// A — First valid frame initializes EWMA state to the input values (no blending).
{
  const sm = new EyeSmoother({ alpha: 0.3 });
  const out = sm.update(ef({
    eye_openness_l: 0.8,
    eye_openness_r: 0.7,
    iris_offset_normalized: { l: { x: 0.1, y: -0.2 }, r: { x: -0.3, y: 0.4 } },
  }), 0);
  assert.equal(out.smoothed, true, 'first frame should be tagged smoothed:true');
  assert.equal(out.eye_openness_l, 0.8, `openness_l init: ${out.eye_openness_l}`);
  assert.equal(out.eye_openness_r, 0.7, `openness_r init: ${out.eye_openness_r}`);
  assert.equal(out.iris_offset_normalized.l.x, 0.1);
  assert.equal(out.iris_offset_normalized.l.y, -0.2);
  assert.equal(out.iris_offset_normalized.r.x, -0.3);
  assert.equal(out.iris_offset_normalized.r.y, 0.4);
}

// B — Subsequent valid frames produce values strictly between previous and raw new.
{
  const sm = new EyeSmoother({ alpha: 0.3 });
  sm.update(ef({ eye_openness_l: 0.2, eye_openness_r: 0.2 }), 0);
  const out = sm.update(ef({ eye_openness_l: 0.8, eye_openness_r: 0.8 }), 100);
  assert.ok(out.eye_openness_l > 0.2 && out.eye_openness_l < 0.8,
    `openness_l should be between 0.2 and 0.8, got ${out.eye_openness_l}`);
  assert.ok(out.eye_openness_r > 0.2 && out.eye_openness_r < 0.8,
    `openness_r should be between 0.2 and 0.8, got ${out.eye_openness_r}`);
}

// C — A `valid: false` frame after a valid one yields previous smoothed values; state unchanged.
{
  const sm = new EyeSmoother({ alpha: 0.3 });
  const prev = sm.update(ef({
    eye_openness_l: 0.6, eye_openness_r: 0.5,
    iris_offset_normalized: { l: { x: 0.1, y: 0.2 }, r: { x: 0.3, y: 0.4 } },
  }), 0);
  const out = sm.update(ef({
    eye_openness_l: 0.99,  // should be ignored
    eye_openness_r: 0.99,
    iris_offset_normalized: { l: null, r: null },
    gaze_zone: null,
    valid: false,
  }), 100);
  assert.equal(out.smoothed, false, 'invalid frame should be tagged smoothed:false');
  assert.equal(out.eye_openness_l, prev.eye_openness_l);
  assert.equal(out.eye_openness_r, prev.eye_openness_r);
  assert.equal(out.iris_offset_normalized.l.x, prev.iris_offset_normalized.l.x);
  assert.equal(out.iris_offset_normalized.l.y, prev.iris_offset_normalized.l.y);
  assert.equal(out.iris_offset_normalized.r.x, prev.iris_offset_normalized.r.x);
  assert.equal(out.iris_offset_normalized.r.y, prev.iris_offset_normalized.r.y);

  // Verify state really wasn't touched: a follow-up valid frame should EWMA from prev,
  // not from the 0.99 we tried to inject.
  const after = sm.update(ef({
    eye_openness_l: 0.6, eye_openness_r: 0.5,
    iris_offset_normalized: { l: { x: 0.1, y: 0.2 }, r: { x: 0.3, y: 0.4 } },
  }), 200);
  // Since previous smoothed openness_l was 0.6 and new sample is 0.6, smoothed = 0.6 again.
  assert.ok(Math.abs(after.eye_openness_l - 0.6) < 1e-12, `state was advanced unexpectedly: ${after.eye_openness_l}`);
}

// D — Hold-time: minHold 1000ms, votes 1; 100ms gap doesn't switch.
{
  const sm = new EyeSmoother({ alpha: 0.3, gazeZoneMinHoldMs: 1000, gazeZoneMinSwitchVotes: 1 });
  const first = sm.update(ef({ gaze_zone: 'center' }), 0);
  assert.equal(first.gaze_zone, 'center');
  const second = sm.update(ef({ gaze_zone: 'left' }), 100);
  assert.equal(second.gaze_zone, 'center', `expected still 'center', got ${second.gaze_zone}`);
}

// E — Hold-time satisfied: same setup, 1500ms after first establishes -> switches to 'left'.
{
  const sm = new EyeSmoother({ alpha: 0.3, gazeZoneMinHoldMs: 1000, gazeZoneMinSwitchVotes: 1 });
  sm.update(ef({ gaze_zone: 'center' }), 0);
  const out = sm.update(ef({ gaze_zone: 'left' }), 1500);
  assert.equal(out.gaze_zone, 'left', `expected 'left' after hold, got ${out.gaze_zone}`);
}

// F — Switch-votes: minHold 0, votes 3; one differing frame stays, three flips on third.
{
  const sm = new EyeSmoother({ alpha: 0.3, gazeZoneMinHoldMs: 0, gazeZoneMinSwitchVotes: 3 });
  sm.update(ef({ gaze_zone: 'center' }), 0);
  const after1 = sm.update(ef({ gaze_zone: 'right' }), 100);
  assert.equal(after1.gaze_zone, 'center', `vote 1: expected 'center', got ${after1.gaze_zone}`);
  const after2 = sm.update(ef({ gaze_zone: 'right' }), 200);
  assert.equal(after2.gaze_zone, 'center', `vote 2: expected 'center', got ${after2.gaze_zone}`);
  const after3 = sm.update(ef({ gaze_zone: 'right' }), 300);
  assert.equal(after3.gaze_zone, 'right', `vote 3: expected 'right', got ${after3.gaze_zone}`);
}

// G — Null gaze_zone input doesn't advance or reset zone state.
{
  const sm = new EyeSmoother({ alpha: 0.3, gazeZoneMinHoldMs: 0, gazeZoneMinSwitchVotes: 3 });
  sm.update(ef({ gaze_zone: 'center' }), 0);
  sm.update(ef({ gaze_zone: 'right' }), 100); // vote 1
  sm.update(ef({ gaze_zone: 'right' }), 200); // vote 2
  // Null frame should NOT reset candidate streak.
  const nullOut = sm.update(ef({ gaze_zone: null }), 300);
  assert.equal(nullOut.gaze_zone, 'center', 'null frame leaves visible unchanged');
  const after3 = sm.update(ef({ gaze_zone: 'right' }), 400); // vote 3 -> switches
  assert.equal(after3.gaze_zone, 'right',
    `streak should have survived the null frame; got ${after3.gaze_zone}`);
}

// H — reset() clears state; first frame after reset behaves like very first frame.
{
  const sm = new EyeSmoother({ alpha: 0.3 });
  sm.update(ef({ eye_openness_l: 0.2, eye_openness_r: 0.2 }), 0);
  sm.update(ef({ eye_openness_l: 0.8, eye_openness_r: 0.8 }), 100);
  sm.reset();
  const out = sm.update(ef({
    eye_openness_l: 0.5,
    eye_openness_r: 0.4,
    iris_offset_normalized: { l: { x: 0.11, y: 0.22 }, r: { x: 0.33, y: 0.44 } },
    gaze_zone: 'left',
  }), 500);
  assert.equal(out.eye_openness_l, 0.5, `post-reset init failed: ${out.eye_openness_l}`);
  assert.equal(out.eye_openness_r, 0.4, `post-reset init failed: ${out.eye_openness_r}`);
  assert.equal(out.iris_offset_normalized.l.x, 0.11);
  assert.equal(out.iris_offset_normalized.l.y, 0.22);
  assert.equal(out.iris_offset_normalized.r.x, 0.33);
  assert.equal(out.iris_offset_normalized.r.y, 0.44);
  assert.equal(out.gaze_zone, 'left');
}

// I — Left-eye iris null updates right-eye EWMA but leaves left-eye state untouched.
{
  const sm = new EyeSmoother({ alpha: 0.3 });
  // Seed both eyes.
  sm.update(ef({
    iris_offset_normalized: { l: { x: 0.1, y: 0.1 }, r: { x: 0.2, y: 0.2 } },
  }), 0);
  // Now feed a frame where left is null (blink-masked), right has new sample.
  const out = sm.update(ef({
    blink_l: true,
    iris_offset_normalized: { l: null, r: { x: 0.6, y: 0.6 } },
  }), 100);
  assert.equal(out.iris_offset_normalized.l, null,
    'left iris must be reported as null when input null');
  // Right eye must have advanced toward 0.6 (between 0.2 and 0.6, exclusive).
  assert.ok(out.iris_offset_normalized.r.x > 0.2 && out.iris_offset_normalized.r.x < 0.6,
    `right.x should be between 0.2 and 0.6, got ${out.iris_offset_normalized.r.x}`);
  assert.ok(out.iris_offset_normalized.r.y > 0.2 && out.iris_offset_normalized.r.y < 0.6,
    `right.y should be between 0.2 and 0.6, got ${out.iris_offset_normalized.r.y}`);

  // Verify left state untouched: feed a follow-up that exposes the stored left state.
  const out2 = sm.update(ef({
    iris_offset_normalized: { l: { x: 0.1, y: 0.1 }, r: { x: 0.2, y: 0.2 } },
  }), 200);
  // Stored left was 0.1; new sample is 0.1 → smoothed remains 0.1.
  assert.ok(Math.abs(out2.iris_offset_normalized.l.x - 0.1) < 1e-12,
    `left.x state was advanced unexpectedly: ${out2.iris_offset_normalized.l.x}`);
  assert.ok(Math.abs(out2.iris_offset_normalized.l.y - 0.1) < 1e-12,
    `left.y state was advanced unexpectedly: ${out2.iris_offset_normalized.l.y}`);
}

console.log('eye-smoother.test.js passed');
