import assert from 'node:assert/strict';
import { GazeSmoother } from '../src/smoothing/GazeSmoother.js';

function gs(overrides = {}) {
  return {
    x: 0,
    y: 0,
    quality: 0.9,
    valid: true,
    gaze_state: 'open',
    ts_ms: 0,
    ts_video_ms: 0,
    ...overrides,
  };
}

// A — First valid sample initializes state with no blending.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  const out = sm.update(gs({ x: 0.3, y: -0.2, quality: 0.9 }));
  assert.equal(out.smoothed, true);
  assert.equal(out.x, 0.3);
  assert.equal(out.y, -0.2);
}

// B — Subsequent valid samples produce values strictly between prev and new.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  sm.update(gs({ x: 0.0, y: 0.0, quality: 0.9 }));
  const out = sm.update(gs({ x: 1.0, y: 1.0, quality: 0.9 }));
  // alpha=0.5: blended = 0*(1-0.5) + 1*0.5 = 0.5
  assert.equal(out.x, 0.5);
  assert.equal(out.y, 0.5);
  assert.equal(out.smoothed, true);
}

// C — Below-quality sample → passthrough with smoothed:false; state unchanged.
{
  const sm = new GazeSmoother({ alpha: 0.5, minQualityScore: 0.3 });
  sm.update(gs({ x: 0.2, y: 0.2, quality: 0.9 }));
  const out = sm.update(gs({ x: 1.0, y: 1.0, quality: 0.1 }));
  assert.equal(out.smoothed, false);
  // Reported x/y is the LAST smoothed state, not the noisy input.
  assert.equal(out.x, 0.2);
  assert.equal(out.y, 0.2);

  // Next valid sample blends with the unchanged state, not the noisy one.
  const out2 = sm.update(gs({ x: 1.0, y: 1.0, quality: 0.9 }));
  // 0.2*(0.5) + 1.0*(0.5) = 0.6
  assert.equal(out2.x, 0.6);
}

// D — Blink (gaze_state: 'closed') → passthrough, state unchanged.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  sm.update(gs({ x: 0.3, y: 0.3, quality: 0.9 }));
  const out = sm.update(gs({ x: 0.0, y: 0.0, quality: 0.0, gaze_state: 'closed', valid: false }));
  assert.equal(out.smoothed, false);
  assert.equal(out.gaze_state, 'closed');
  assert.equal(out.x, 0.3);
  assert.equal(out.y, 0.3);
}

// E — valid:false but high quality → passthrough, state unchanged.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  sm.update(gs({ x: 0.4, y: 0.4 }));
  const out = sm.update(gs({ x: 9, y: 9, valid: false }));
  assert.equal(out.smoothed, false);
  assert.equal(out.x, 0.4);
  assert.equal(out.y, 0.4);
}

// F — NaN coordinates → passthrough, state unchanged.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  sm.update(gs({ x: 0.1, y: -0.1 }));
  const out = sm.update(gs({ x: NaN, y: 0 }));
  assert.equal(out.smoothed, false);
  assert.equal(out.x, 0.1);
}

// G — reset() clears state.
{
  const sm = new GazeSmoother({ alpha: 0.5 });
  sm.update(gs({ x: 0.5, y: 0.5 }));
  sm.reset();
  const out = sm.update(gs({ x: -0.4, y: -0.4 }));
  assert.equal(out.smoothed, true);
  assert.equal(out.x, -0.4);
  assert.equal(out.y, -0.4);
}

// H — Direction check on EWMA: successive samples drag state toward the new point.
{
  const sm = new GazeSmoother({ alpha: 0.3 });
  sm.update(gs({ x: 0, y: 0 }));
  const a = sm.update(gs({ x: 1, y: 1 }));
  const b = sm.update(gs({ x: 1, y: 1 }));
  // After two equal updates, state should approach 1 monotonically.
  assert.ok(a.x < b.x, `expected x to increase: ${a.x} -> ${b.x}`);
  assert.ok(b.x < 1, `should not yet hit 1: ${b.x}`);
}

// I — null input → null output.
{
  const sm = new GazeSmoother();
  assert.equal(sm.update(null), null);
  assert.equal(sm.update(undefined), null);
}

// J — Passthrough before any state initializes — returns the raw values.
{
  const sm = new GazeSmoother({ minQualityScore: 0.3 });
  const out = sm.update(gs({ x: 0.4, y: 0.2, quality: 0.1 })); // below threshold first frame
  assert.equal(out.smoothed, false);
  assert.equal(out.x, 0.4); // No smoothed state yet — passthrough returns raw.
}

console.log('gaze-smoother.test.js — all cases passed');
