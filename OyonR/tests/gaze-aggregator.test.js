import assert from 'node:assert/strict';
import { GazeAggregator } from '../src/aggregation/GazeAggregator.js';

function sgs(overrides = {}) {
  return {
    x: 0,
    y: 0,
    quality: 0.9,
    valid: true,
    smoothed: true,
    gaze_state: 'open',
    ts_ms: 0,
    ...overrides,
  };
}

// A — Empty buffer → null.
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  assert.equal(agg.flush(2000), null);
}

// B — All-invalid frames → n_points 0, centroid null, dispersion null,
//     zone_proportions null, valid_frame_ratio 0.
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  agg.consumeFrame(sgs({ ts_ms: 100, valid: false, smoothed: false }), 100);
  agg.consumeFrame(sgs({ ts_ms: 200, valid: false, smoothed: false }), 200);
  const out = agg.flush(1500);
  assert.equal(out.n_points, 0);
  assert.equal(out.centroid, null);
  assert.equal(out.dispersion, null);
  assert.equal(out.zone_proportions, null);
  assert.equal(out.valid_frame_ratio, 0);
  assert.equal(out.total_frames, 2);
}

// C — Static centered gaze → centroid near (0,0), dispersion near 0,
//     middle_center proportion = 1.0 in 3x3 grid.
{
  const agg = new GazeAggregator({ windowMs: 1000, zoneGrid: 3 });
  for (let i = 0; i < 10; i += 1) {
    agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: i * 50 }), i * 50);
  }
  const out = agg.flush(600);
  assert.equal(out.n_points, 10);
  assert.equal(out.centroid.x, 0);
  assert.equal(out.centroid.y, 0);
  assert.equal(out.dispersion, 0);
  assert.equal(out.zone_proportions.middle_center, 1);
  assert.equal(out.zone_proportions.top_left, 0);
  assert.equal(out.valid_frame_ratio, 1);
  assert.equal(out.off_screen_ratio, 0);
}

// D — Scanning gaze (sweeps across grid) → non-zero dispersion, even-ish
//     zone distribution.
{
  const agg = new GazeAggregator({ windowMs: 1000, zoneGrid: 3 });
  // 9 points, one centered in each 3x3 cell.
  const positions = [
    [-0.33, -0.33], [0, -0.33], [0.33, -0.33],
    [-0.33,  0   ], [0,  0   ], [0.33,  0   ],
    [-0.33,  0.33], [0,  0.33], [0.33,  0.33],
  ];
  positions.forEach(([x, y], i) => agg.consumeFrame(sgs({ x, y, ts_ms: i * 50 }), i * 50));
  const out = agg.flush(500);
  assert.equal(out.n_points, 9);
  // Centroid near origin.
  assert.ok(Math.abs(out.centroid.x) < 1e-9);
  assert.ok(Math.abs(out.centroid.y) < 1e-9);
  assert.ok(out.dispersion > 0.1, `dispersion should be substantial, got ${out.dispersion}`);
  // Each zone gets 1/9 share.
  for (const k of Object.keys(out.zone_proportions)) {
    assert.ok(Math.abs(out.zone_proportions[k] - 1 / 9) < 1e-9, `${k}: ${out.zone_proportions[k]}`);
  }
}

// E — Off-screen handling: with dropOffScreen:true, off-screen points still
//     increment off_screen_ratio but don't pollute centroid/dispersion.
{
  const agg = new GazeAggregator({ windowMs: 1000, dropOffScreen: true });
  // 5 on-screen at (0,0), 5 off-screen at (1, 1).
  for (let i = 0; i < 5; i += 1) agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: i * 50 }), i * 50);
  for (let i = 0; i < 5; i += 1) agg.consumeFrame(sgs({ x: 1, y: 1, ts_ms: 250 + i * 50 }), 250 + i * 50);
  const out = agg.flush(600);
  // n_points reflects on-screen valid count.
  assert.equal(out.n_points, 5);
  assert.equal(out.centroid.x, 0);
  assert.equal(out.centroid.y, 0);
  assert.equal(out.dispersion, 0);
  // off_screen_ratio over valid frames = 5/10.
  assert.equal(out.off_screen_ratio, 0.5);
}

// F — dropOffScreen:false → off-screen points contribute to centroid.
{
  const agg = new GazeAggregator({ windowMs: 1000, dropOffScreen: false });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  agg.consumeFrame(sgs({ x: 1, y: 1, ts_ms: 50 }), 50);
  const out = agg.flush(100);
  // Mean of (0,0) and (1,1) → (0.5, 0.5).
  assert.equal(out.centroid.x, 0.5);
  assert.equal(out.centroid.y, 0.5);
  assert.equal(out.n_points, 2);
}

// G — AOI dwell: two non-overlapping rectangles.
{
  const aois = [
    { id: 'left_half',  x: -0.5, y: -0.5, width: 0.5, height: 1.0 },
    { id: 'right_half', x:  0.0, y: -0.5, width: 0.5, height: 1.0 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 50 });
  // 6 points in left half.
  for (let i = 0; i < 6; i += 1) agg.consumeFrame(sgs({ x: -0.2, y: 0, ts_ms: i * 50 }), i * 50);
  // 4 points in right half.
  for (let i = 0; i < 4; i += 1) agg.consumeFrame(sgs({ x: 0.2, y: 0, ts_ms: 300 + i * 50 }), 300 + i * 50);
  const out = agg.flush(600);
  assert.equal(out.aoi_dwell_ms.left_half, 6 * 50);
  assert.equal(out.aoi_dwell_ms.right_half, 4 * 50);
}

// H — AOI dwell is null when gaze_aois empty.
{
  const agg = new GazeAggregator({ windowMs: 1000, aois: [] });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  const out = agg.flush(100);
  assert.equal(out.aoi_dwell_ms, null);
}

// I — AOI first-match wins: overlapping AOIs do not double-count.
{
  const aois = [
    { id: 'a', x: -0.5, y: -0.5, width: 1.0, height: 1.0 },
    { id: 'b', x: -0.5, y: -0.5, width: 1.0, height: 1.0 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 50 });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 50 }), 50);
  const out = agg.flush(100);
  assert.equal(out.aoi_dwell_ms.a, 100);
  assert.equal(out.aoi_dwell_ms.b, 0);
}

// J — Buffer clears after flush() (no leakage between windows).
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  agg.consumeFrame(sgs({ x: 0.4, y: 0.4, ts_ms: 0 }), 0);
  const a = agg.flush(500);
  assert.equal(a.n_points, 1);
  const b = agg.flush(1000);
  assert.equal(b, null, 'second flush with empty buffer should return null');
  agg.consumeFrame(sgs({ x: -0.4, y: -0.4, ts_ms: 1100 }), 1100);
  const c = agg.flush(1200);
  assert.equal(c.n_points, 1);
  assert.equal(c.centroid.x, -0.4);
}

// K — Auto-flush at window boundary: returns the window from consumeFrame.
{
  const agg = new GazeAggregator({ windowMs: 100 });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  const window = agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 120 }), 120);
  assert.ok(window !== null, 'expected auto-flush at boundary');
  assert.equal(window.n_points, 2);
}

// L — Calibration metadata passes through flush().
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  const out = agg.flush(500, { calibrationAgeMs: 4200, calibrationQuality: 0.78 });
  assert.equal(out.calibration_age_ms, 4200);
  assert.equal(out.calibration_quality, 0.78);
  assert.equal(out.model_version, 'webeyetrack-0.0.2');
}

// M — Custom modelVersion option propagates.
{
  const agg = new GazeAggregator({ windowMs: 1000, modelVersion: 'mock-blazegaze' });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  assert.equal(agg.flush(500).model_version, 'mock-blazegaze');
}

// N — 5x5 grid produces 25 indexed zones.
{
  const agg = new GazeAggregator({ windowMs: 1000, zoneGrid: 5 });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0 }), 0);
  const out = agg.flush(500);
  const keys = Object.keys(out.zone_proportions);
  assert.equal(keys.length, 25);
  // 5x5 center is r2c2.
  assert.equal(out.zone_proportions.r2c2, 1);
}

// O — Privacy invariant: returned object never has a raw points array.
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  for (let i = 0; i < 5; i += 1) agg.consumeFrame(sgs({ x: 0.1 * i, y: 0.1 * i, ts_ms: i * 50 }), i * 50);
  const out = agg.flush(300);
  function scan(obj, path = '') {
    if (Array.isArray(obj)) {
      // Allowed arrays: none at top level. Fail if any value array length > 25.
      assert.ok(obj.length <= 25, `array at ${path} length ${obj.length} > 25 — possible raw point leak`);
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        assert.ok(
          !/_raw$|_trace$|gaze_points|gaze_raw|gaze_trace|points_raw/.test(k),
          `disallowed key ${path}.${k}`,
        );
        scan(v, `${path}.${k}`);
      }
    }
  }
  scan(out);
}

// P — consumeFrame(null) → returns null, no state change.
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  assert.equal(agg.consumeFrame(null, 0), null);
  assert.equal(agg.flush(500), null);
}

// Q — Quality-gated input that smoother passed through with smoothed:false
//     is excluded from on-screen-valid stats.
{
  const agg = new GazeAggregator({ windowMs: 1000 });
  agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: 0, valid: true, smoothed: true }), 0);
  agg.consumeFrame(sgs({ x: 0.4, y: 0.4, ts_ms: 50, valid: false, smoothed: false }), 50);
  const out = agg.flush(100);
  assert.equal(out.n_points, 1);
  assert.equal(out.total_frames, 2);
  assert.equal(out.valid_frame_ratio, 0.5);
}

console.log('gaze-aggregator.test.js — all cases passed');
