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

// R — AOI dwell follows real timestamps rather than multiplying by the
// runtime's unrelated slow emotion interval. Irregular gaze callbacks remain
// honest and expose their observed cadence for audit.
{
  const aois = [
    { id: 'content', x: -0.5, y: -0.5, width: 1, height: 1 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 1000 });
  for (const ts of [0, 40, 95, 130]) {
    agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: ts }), ts);
  }
  const out = agg.flush(180);
  // 40 + 55 + 35 + median(40) = 170, not 4 * 1000.
  assert.equal(out.aoi_dwell_ms.content, 170);
  assert.equal(out.timing_source, 'timestamps');
  assert.equal(out.observed_sample_interval_ms, 40);
  assert.equal(out.observed_sample_rate_hz, 25);
}

// S — Stable high-rate gaze becomes one coarse fixation. A direct AOI switch
// produces entries, a transition, and time-to-first without leaking points.
{
  const aois = [
    { id: 'text', x: -0.5, y: -0.5, width: 0.5, height: 1 },
    { id: 'chart', x: 0, y: -0.5, width: 0.5, height: 1 },
  ];
  const agg = new GazeAggregator({
    windowMs: 2000,
    aois,
    fixationMinDurationMs: 150,
    fixationDispersionThreshold: 0.08,
  });
  for (let i = 0; i < 6; i += 1) {
    agg.consumeFrame(sgs({ x: -0.2 + (i % 2) * 0.005, y: 0, ts_ms: i * 40 }), i * 40);
  }
  for (let i = 6; i < 12; i += 1) {
    agg.consumeFrame(sgs({ x: 0.2 + (i % 2) * 0.005, y: 0, ts_ms: i * 40 }), i * 40);
  }
  const out = agg.flush(520);
  assert.equal(out.fixation_sampling_adequate, true);
  assert.equal(out.fixation_count, 2);
  assert.ok(out.fixation_duration_ms_total >= 400);
  assert.ok(out.scanpath_length > 0.3);
  assert.equal(out.aoi_entries.text, 1);
  assert.equal(out.aoi_entries.chart, 1);
  assert.equal(out.aoi_revisits.text, 0);
  assert.equal(out.aoi_time_to_first_ms.text, 0);
  assert.equal(out.aoi_time_to_first_ms.chart, 240);
  assert.equal(out.aoi_transitions['text→chart'], 1);
  assert.equal(out.aoi_transition_count, 1);
  assert.equal(out.aoi_transition_entropy, 0);
}

// T — A long callback dropout breaks sequences and is not charged as dwell.
// The dynamic gap threshold follows the normal 40 ms cadence, not the outlier.
{
  const aois = [{ id: 'a', x: -0.5, y: -0.5, width: 1, height: 1 }];
  const agg = new GazeAggregator({ windowMs: 5000, aois, maxSampleGapMs: 250 });
  for (const ts of [0, 40, 80, 2000, 2040, 2080]) {
    agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: ts }), ts);
  }
  const out = agg.flush(2120);
  assert.equal(out.max_observed_sample_gap_ms, 1920);
  assert.ok(out.aoi_dwell_ms.a < 500, `dropout became dwell: ${out.aoi_dwell_ms.a}`);
  assert.equal(out.aoi_entries.a, 2, 'the dropout starts a new AOI visit');
}

// U — One-Hz screen points can still support coarse dwell, but the payload is
// explicit that they cannot support fixation detection.
{
  const agg = new GazeAggregator({ windowMs: 4000, sampleIntervalMs: 1000 });
  for (const ts of [0, 1000, 2000]) agg.consumeFrame(sgs({ ts_ms: ts }), ts);
  const out = agg.flush(3000);
  assert.equal(out.observed_sample_rate_hz, 1);
  assert.equal(out.fixation_sampling_adequate, false);
  assert.equal(out.fixation_count, null);
  assert.equal(out.fixation_duration_ms_total, null);
}

// V — Attention distribution: even dwell over every AOI is maximal entropy,
//     zero imbalance, full coverage.
{
  const aois = [
    { id: 'a', x: -1, y: -1, width: 1, height: 2 },
    { id: 'b', x: 0, y: -1, width: 1, height: 2 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 50 });
  for (let i = 0; i < 5; i += 1) agg.consumeFrame(sgs({ x: -0.5, y: 0, ts_ms: i * 50 }), i * 50);
  for (let i = 5; i < 10; i += 1) agg.consumeFrame(sgs({ x: 0.5, y: 0, ts_ms: i * 50 }), i * 50);
  const out = agg.flush(600);
  assert.equal(out.aoi_count, 2);
  assert.equal(out.aoi_coverage, 1, 'both AOIs were reached');
  assert.ok(Math.abs(out.aoi_stationary_entropy - 1) < 1e-9, 'even split ⇒ entropy 1');
  assert.ok(out.aoi_allocation_sd < 1e-9, 'even split ⇒ no imbalance');
}

// W — Attention pooled in one AOI: entropy 0, coverage halved, and the
//     imbalance SD is the full spread around the 50% mean.
{
  const aois = [
    { id: 'a', x: -1, y: -1, width: 1, height: 2 },
    { id: 'b', x: 0, y: -1, width: 1, height: 2 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 50 });
  for (let i = 0; i < 10; i += 1) agg.consumeFrame(sgs({ x: -0.5, y: 0, ts_ms: i * 50 }), i * 50);
  const out = agg.flush(600);
  assert.equal(out.aoi_coverage, 0.5, 'only one of two AOIs was reached');
  assert.equal(out.aoi_stationary_entropy, 0, 'all mass in one AOI ⇒ entropy 0');
  assert.ok(Math.abs(out.aoi_allocation_sd - 50) < 1e-9, 'shares are 100/0 ⇒ SD 50');
}

// X — An ignored AOI must LOWER stationary entropy. Normalizing by the number
//     of AOIs actually visited (as the transition-entropy helper does) would
//     score this identically to case V, hiding that a third of the layout was
//     never looked at.
{
  // Thirds of the on-screen span (|x| <= SCREEN_HALF), so every point is on
  // screen and only the third AOI is genuinely ignored.
  const aois = [
    { id: 'a', x: -0.5, y: -1, width: 0.34, height: 2 },
    { id: 'b', x: -0.16, y: -1, width: 0.33, height: 2 },
    { id: 'c', x: 0.17, y: -1, width: 0.33, height: 2 },
  ];
  const agg = new GazeAggregator({ windowMs: 1000, aois, sampleIntervalMs: 50 });
  for (let i = 0; i < 5; i += 1) agg.consumeFrame(sgs({ x: -0.4, y: 0, ts_ms: i * 50 }), i * 50);
  for (let i = 5; i < 10; i += 1) agg.consumeFrame(sgs({ x: 0, y: 0, ts_ms: i * 50 }), i * 50);
  const out = agg.flush(600);
  assert.equal(out.aoi_count, 3);
  assert.ok(Math.abs(out.aoi_coverage - 2 / 3) < 1e-9);
  assert.ok(
    out.aoi_stationary_entropy < 1 && out.aoi_stationary_entropy > 0,
    `two of three AOIs evenly viewed must sit below 1, got ${out.aoi_stationary_entropy}`,
  );
}

// Y — Saccade amplitudes are retained, not just summed away into the scanpath.
{
  const agg = new GazeAggregator({ windowMs: 4000, sampleIntervalMs: 40 });
  const dwellAt = (x, from) => {
    for (let i = 0; i < 8; i += 1) {
      const ts = from + i * 40;
      agg.consumeFrame(sgs({ x, y: 0, ts_ms: ts }), ts);
    }
  };
  dwellAt(-0.4, 0);
  dwellAt(0, 400);
  dwellAt(0.4, 800);
  const out = agg.flush(1200);
  assert.equal(out.fixation_sampling_adequate, true);
  assert.equal(out.saccade_count, Math.max(0, out.fixation_count - 1));
  assert.ok(out.saccade_amplitude_mean > 0, 'amplitudes must be measured');
  assert.ok(
    Math.abs(out.saccade_amplitude_mean * out.saccade_count - out.scanpath_length) < 1e-9,
    'amplitudes must sum to the scanpath length',
  );
}

// Z — With no AOIs configured the distribution fields stay null rather than
//     reporting a perfectly balanced zero.
{
  const agg = new GazeAggregator({ windowMs: 1000, aois: [] });
  agg.consumeFrame(sgs({ ts_ms: 0 }), 0);
  const out = agg.flush(600);
  assert.equal(out.aoi_stationary_entropy, null);
  assert.equal(out.aoi_allocation_sd, null);
  assert.equal(out.aoi_coverage, null);
  assert.equal(out.aoi_count, null);
}

// AA — REGRESSION GUARD. No per-window transition-entropy scalar may be
//      emitted from this aggregator, ever.
//
//      One was implemented and removed. Two independent reasons, and both
//      still hold, so this test exists to stop it drifting back:
//
//      1. Ownership. tnaj's `transitionEntropy()` — a verified port of
//         Nestimate's `transition_entropy()` — already computes the entropy
//         rate, stationary distribution and redundancy from a transition
//         matrix. Oyon senses; the network packages own network algorithms.
//      2. Sample size. Over 400 stationary sessions the per-window estimate
//         had a 95% interval of [0.00, 1.17] bits against a true 1.585 — an
//         interval containing zero, on a process with no structure at all.
//
//      What crosses the boundary is `aoi_transitions`, the raw counts, pooled
//      by src/analytics/AoiTransitionMatrix.js. That is asserted present.
{
  const aois = [
    { id: 'left',  x: -0.5, y: -0.5, width: 0.5, height: 1.0 },
    { id: 'right', x:  0.0, y: -0.5, width: 0.5, height: 1.0 },
  ];
  const agg = new GazeAggregator({ windowMs: 2000, aois, sampleIntervalMs: 50 });
  for (let i = 0; i < 8; i += 1) {
    agg.consumeFrame(sgs({ x: i % 2 === 0 ? -0.2 : 0.2, y: 0, ts_ms: i * 50 }), i * 50);
  }
  const out = agg.flush(400);

  for (const field of Object.keys(out)) {
    assert.ok(
      !/entropy_bits$|^aoi_gaze_transition_entropy/.test(field),
      `${field}: entropy belongs in tnaj over a POOLED matrix, not in a 3s window`,
    );
  }

  // The counts are the interface, and they must survive intact.
  assert.ok(out.aoi_transitions, 'aoi_transitions is what the analysis layer consumes');
  assert.equal(out.aoi_transitions['left→right'], 4);
  assert.equal(out.aoi_transitions['right→left'], 3);
  assert.equal(out.aoi_transition_count, 7);
}

// AC — Per-window SDs, the inputs that let a session-level σ be pooled
//      exactly for coefficient K.
{
  const agg = new GazeAggregator({
    windowMs: 5000,
    sampleIntervalMs: 20,
    fixationMinDurationMs: 100,
  });
  const dwellAt = (x, from) => {
    for (let i = 0; i < 10; i += 1) {
      agg.consumeFrame(sgs({ x, y: 0, ts_ms: from + i * 20 }), from + i * 20);
    }
  };
  dwellAt(-0.4, 0);
  dwellAt(0, 400);
  dwellAt(0.4, 800);
  const out = agg.flush(1200);

  assert.ok(Number.isFinite(out.fixation_duration_ms_sd), 'fixation SD must be emitted');
  assert.ok(Number.isFinite(out.saccade_amplitude_sd), 'saccade SD must be emitted');
  assert.ok(out.fixation_duration_ms_sd >= 0);
  assert.ok(out.saccade_amplitude_sd >= 0);
}

console.log('gaze-aggregator.test.js — all cases passed');
