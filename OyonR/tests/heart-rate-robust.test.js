import assert from 'node:assert/strict';
import { robustBpm } from '../src/aggregation/heartRateRobust.js';
import { HeartRateAggregator } from '../src/aggregation/HeartRateAggregator.js';
// The ramp cases below assert against the SHIPPED default rather than a copy,
// so lowering/raising heart_rate_tracker_windows is caught here immediately.
import { createOyonSettings } from '../src/settings/OyonSettings.js';

// The worked example: true HR ~86 with an octave error (43), a double (172),
// and a low-confidence noise spike (118). Naive mean = 93.5; robust ≈ 86.1.
const EXAMPLE = [
  { bpm: 85, weight: 0.82 },
  { bpm: 43, weight: 0.71 },  // ½× → fold to 86
  { bpm: 88, weight: 0.90 },
  { bpm: 84, weight: 0.55 },
  { bpm: 172, weight: 0.40 }, // 2× → fold to 86
  { bpm: 87, weight: 0.88 },
  { bpm: 86, weight: 0.79 },
  { bpm: 118, weight: 0.25 }, // spike → dropped by MAD gate
  { bpm: 83, weight: 0.84 },
  { bpm: 89, weight: 0.86 },
];

// ── the worked example lands on ~86.1 ───────────────────────────────
{
  const r = robustBpm(EXAMPLE);
  assert.ok(Math.abs(r.bpm - 86.1) < 0.3, `robust mean ~86.1 (got ${r.bpm.toFixed(2)})`);
  assert.equal(r.folded, 2, 'folded the 43 and 172 octave errors');
  assert.equal(r.dropped, 1, 'dropped the 118 spike');
  assert.equal(r.kept, 9, '9 survivors feed the mean');
  assert.equal(r.total, 10);
  assert.ok(Math.abs(r.corrected_fraction - 0.3) < 1e-9, 'corrected fraction = 30%');

  // Naive mean is badly wrong — proving the filter earns its keep.
  const naive = EXAMPLE.reduce((s, x) => s + x.bpm, 0) / EXAMPLE.length;
  assert.ok(naive > 92, `naive mean is dragged high (${naive.toFixed(1)})`);
}

// ── toggles: filter disabled → plain mean (no correction) ───────────
{
  const off = robustBpm(EXAMPLE, { enabled: false, weighted: false });
  const naive = EXAMPLE.reduce((s, x) => s + x.bpm, 0) / EXAMPLE.length;
  assert.ok(Math.abs(off.bpm - naive) < 1e-9, 'disabled → plain arithmetic mean');
  assert.equal(off.folded, 0);
  assert.equal(off.dropped, 0);
}

// ── fold off → octaves survive, MAD still trims the far spike ────────
{
  const noFold = robustBpm(EXAMPLE, { fold: false });
  assert.equal(noFold.folded, 0, 'no folding when disabled');
  // 43 and 172 are now ~43 from the ~86 centre → dropped by the MAD gate.
  assert.ok(noFold.dropped >= 2, 'unfolded octave errors get dropped instead');
}

// ── weighting: high-confidence readings pull the mean ───────────────
{
  const pts = [{ bpm: 80, weight: 0.9 }, { bpm: 80, weight: 0.9 }, { bpm: 90, weight: 0.1 }];
  const w = robustBpm(pts, { weighted: true, madFloor: 20 });
  const u = robustBpm(pts, { weighted: false, madFloor: 20 });
  assert.ok(w.bpm < u.bpm, 'confidence-weighted mean leans toward the trusted 80s');
}

// ── empty / all-invalid → null ──────────────────────────────────────
{
  assert.equal(robustBpm([]).bpm, null);
  assert.equal(robustBpm([{ bpm: NaN }]).bpm, null);
}

// ── aggregator surfaces bpm_robust + anomaly block ──────────────────
{
  const agg = new HeartRateAggregator({ windowMs: 100000, sampleIntervalMs: 1000, robust: {} });
  const base = 10_000_000;
  EXAMPLE.forEach((e, i) => agg.consumeFrame({ bpm: e.bpm, snr: 5, confidence: e.weight, method: 'pos' }, base + i * 1000));
  const win = agg.flush(base + EXAMPLE.length * 1000);
  assert.ok(win, 'window emitted');
  assert.ok(Math.abs(win.bpm_robust - 86.1) < 0.4, `window bpm_robust ~86.1 (got ${win.bpm_robust})`);
  assert.ok(win.bpm_mean > 92, 'raw mean still reported (and still wrong)');
  assert.equal(win.anomaly.folded, 2);
  assert.equal(win.anomaly.dropped, 1);
  assert.equal(win.anomaly.total, 10);
}

// ── cross-window slew limit rejects a physiologically impossible flip ─
// Real capture: a whole window coherently locked onto ~116 after an 84 baseline
// (a ~38% flip in ~5 s ≈ 6 bpm/s). No intra-window outlier exists, so only a
// cross-window slew limit can catch it.
{
  const WINDOW_MS = 5000;
  const SLEW = 3; // bpm/sec → max 15 bpm move per 5 s window
  const agg = new HeartRateAggregator({ windowMs: WINDOW_MS, sampleIntervalMs: 1000, maxSlewBpmPerS: SLEW });
  let t = 20_000_000;
  const pushWindow = (bpm) => {
    // A coherent window: every estimate agrees (nothing for the MAD gate to drop).
    for (let i = 0; i < 5; i += 1) {
      agg.consumeFrame({ bpm, snr: 5, confidence: 0.7, method: 'pos' }, t + i * 1000);
    }
    const w = agg.flush(t + WINDOW_MS);
    t += WINDOW_MS;
    return w;
  };

  const w1 = pushWindow(84);
  assert.ok(Math.abs(w1.bpm_tracked - 84) < 0.5, 'first window seeds the tracker at 84');
  assert.equal(w1.slew_clamped, false, 'no clamp on the seed window');

  const w2 = pushWindow(116); // +32 bpm — impossible in 5 s
  assert.equal(w2.slew_clamped, true, 'the 38% flip is flagged as slew-clamped');
  assert.ok(Math.abs(w2.bpm_robust - 116) < 0.5, 'per-window robust still reports what it saw (honest)');
  assert.ok(Math.abs(w2.bpm_tracked - 99) < 0.5,
    `tracked clamped to 84 + 3·5 = 99, not 116 (got ${w2.bpm_tracked})`);

  // A genuine sustained change still converges (no permanent lock-out).
  const w3 = pushWindow(116);
  assert.ok(w3.bpm_tracked > w2.bpm_tracked, 'sustained change keeps converging upward');

  // Back to baseline: the drop is clamped the same way.
  const w4 = pushWindow(68);
  assert.equal(w4.slew_clamped, true, 'a large downward flip is clamped too');
  assert.ok(w4.bpm_tracked > 68, 'tracked does not snap down to the 68 dip');
}

// ── real capture: the level anchor must survive a run of bad windows ─
// bpm_robust sequence from an actual session (true HR ~82). It contains a
// 5-window patch where the estimator coherently locked onto wrong rates
// (61.7, 100.9, 124, 89.2, 96.7) — no intra-window outlier to drop, so only a
// cross-window anchor longer than the bad run can outvote it.
{
  const SEQ = [81.4, 79.8, 79.3, 80.8, 61.7, 100.9, 124.05, 89.2, 96.7, 72.8,
    79.0, 83.0, 89.3, 81.5, 82.6, 81.9, 131.3, 84.06];
  const TRUE_BPM = 82;
  const WINDOW_MS = 5500;

  const track = (trackerWindows) => {
    const agg = new HeartRateAggregator({
      windowMs: WINDOW_MS, sampleIntervalMs: 1000, maxSlewBpmPerS: 1.5, trackerWindows, robust: {},
    });
    let t = 0;
    const out = [];
    for (const bpm of SEQ) {
      for (let i = 0; i < 5; i += 1) agg.consumeFrame({ bpm, snr: 5, confidence: 0.7, method: 'pos' }, t + i * 1000);
      out.push(agg.flush(t + WINDOW_MS).bpm_tracked);
      t += WINDOW_MS;
    }
    return out;
  };
  const mae = (o) => o.reduce((s, v) => s + Math.abs(v - TRUE_BPM), 0) / o.length;

  const none = track(1);   // slew only, no level anchor
  const short = track(5);  // anchor SHORTER than the 5-window bad run
  const good = track(9);   // anchor longer than the bad run

  assert.ok(mae(good) < 2.5, `N=9 anchor tracks the true ~82 (MAE ${mae(good).toFixed(2)})`);
  assert.ok(mae(good) < mae(none), 'anchor beats slew-only');
  assert.ok(mae(good) < mae(short), 'an anchor shorter than the bad run is worse — N must outvote it');
  assert.ok(Math.max(...good) < 92, `no excursion past 92 (got ${Math.max(...good).toFixed(0)})`);
  assert.ok(Math.min(...good) > 75, `no dip below 75 (got ${Math.min(...good).toFixed(0)})`);
}

// ── startup: a 1-estimate seed must not poison the tracker ──────────
// Real capture: the first window produced bpm_robust 51 from a SINGLE estimate,
// which seeded the tracker at 51; the anchor then rejected the correct ~88 that
// followed as an "outlier", taking ~5 windows to reach the true ~81.
{
  // [bpm_robust, surviving estimate count] from the real 1:41:54–1:42:59 capture.
  const SEQ = [[50.99, 1], [50.30, 14], [87.78, 15], [82.01, 17], [79.06, 19],
    [82.61, 15], [81.67, 16], [80.38, 19], [85.25, 18], [78.92, 19], [96.42, 15]];
  const TRUE_BPM = 81;
  const WINDOW_MS = 5500;
  const agg = new HeartRateAggregator({
    windowMs: WINDOW_MS, sampleIntervalMs: 1000, maxSlewBpmPerS: 1.5,
    trackerWindows: 9, minEstimatesForAnchor: 2, resetBpm: 10, resetWindows: 3, robust: {},
  });
  let t = 0;
  const tracked = [];
  for (const [bpm, kept] of SEQ) {
    for (let i = 0; i < kept; i += 1) {
      agg.consumeFrame({ bpm, snr: 5, confidence: 0.7, method: 'pos' }, t + i * 250);
    }
    tracked.push(agg.flush(t + WINDOW_MS).bpm_tracked);
    t += WINDOW_MS;
  }

  assert.equal(tracked[0], null, 'a 1-estimate window emits no tracked value (settling), never seeds');
  assert.equal(tracked[1], null,
    'the implausible 50.3 (outside the 60-100 resting band) is not adopted uncorroborated');
  const wrong = tracked.filter((v) => v != null && Math.abs(v - TRUE_BPM) >= 8).length;
  assert.ok(wrong === 0, `plausibility prior avoids the bad seed entirely (got ${wrong} wrong)`);
  const final = tracked[tracked.length - 1];
  assert.ok(Math.abs(final - TRUE_BPM) < 4, `settles on the true ~81 (got ${final.toFixed(1)})`);
  assert.ok(Math.abs(final - 96.42) > 8, 'still rejects the trailing 96.4 outlier');
}

// ── plausibility prior must NOT lock out a genuinely low/high HR ────
// A real bradycardic subject (~52 bpm, outside the 60-100 band) reports it
// consistently — after corroboration the tracker must adopt it, not refuse it.
{
  const BRADY = [52.1, 51.4, 52.8, 51.9, 52.3, 51.7];
  const WINDOW_MS = 5500;
  const agg = new HeartRateAggregator({
    windowMs: WINDOW_MS, sampleIntervalMs: 1000, maxSlewBpmPerS: 1.5, trackerWindows: 9, robust: {},
  });
  let t = 0;
  const tracked = [];
  for (const bpm of BRADY) {
    for (let i = 0; i < 15; i += 1) agg.consumeFrame({ bpm, snr: 5, confidence: 0.7, method: 'pos' }, t + i * 250);
    tracked.push(agg.flush(t + WINDOW_MS).bpm_tracked);
    t += WINDOW_MS;
  }
  assert.equal(tracked[0], null, 'out-of-band value withheld until corroborated');
  const final = tracked[tracked.length - 1];
  assert.ok(Math.abs(final - 52) < 3,
    `a corroborated bradycardic rate IS adopted (got ${final == null ? 'null' : final.toFixed(1)})`);
}

// ── slew disabled → tracked === robust ──────────────────────────────
{
  const agg = new HeartRateAggregator({ windowMs: 5000, sampleIntervalMs: 1000, maxSlewBpmPerS: 0 });
  let t = 30_000_000;
  for (const bpm of [84, 116]) {
    for (let i = 0; i < 5; i += 1) agg.consumeFrame({ bpm, snr: 5, confidence: 0.7, method: 'pos' }, t + i * 1000);
    var win = agg.flush(t + 5000); // eslint-disable-line no-var
    t += 5000;
  }
  assert.ok(Math.abs(win.bpm_tracked - win.bpm_robust) < 1e-9, 'slew off → tracked equals robust');
  assert.equal(win.slew_clamped, false);
}

// ── RISING HR must not be under-reported by the anchor's lag ────────
// The gap the previous test set missed entirely: every case above feeds a
// STEADY or STEP rate, and a trailing median is unbiased on both. It is only
// on a monotonic ramp that the anchor's phase lag turns into a systematic
// UNDER-estimate — the tracked value sits ~half the anchor span in the past,
// which at the old trackerWindows=9 (a 90 s anchor) read ~10% low on a HR
// climbing 10 bpm/min. Pin the ceiling so the default cannot drift back.
{
  const WINDOW_MS = 10000;
  const START = 60;
  const END = 110;
  const TOTAL_S = 300;
  const agg = new HeartRateAggregator({
    windowMs: WINDOW_MS,
    sampleIntervalMs: 1000,
    maxSlewBpmPerS: 1.5,
    trackerWindows: createOyonSettings({ heart_rate_enabled: true }).heart_rate_tracker_windows,
    robust: {},
  });
  // Deterministic zig-zag instead of random noise: a test that samples an RNG
  // is a test that can fail on a different day for no reason.
  const jitter = (i) => [2.2, -1.7, 0.9, -2.4, 1.4, -0.6][i % 6];
  const errors = [];
  for (let i = 0; i < TOTAL_S; i += 1) {
    const t = (i + 1) * 1000;
    const truth = START + ((END - START) * i) / TOTAL_S;
    const win = agg.consumeFrame(
      { bpm: truth + jitter(i), snr: 8, confidence: 0.8, window_seconds: 12, method: 'pos' }, t,
    );
    if (win && Number.isFinite(win.bpm_tracked)) errors.push(win.bpm_tracked - truth);
  }
  assert.ok(errors.length >= 20, `ramp produced enough windows to judge (got ${errors.length})`);

  const meanErr = errors.reduce((a, b) => a + b, 0) / errors.length;
  const worst = errors.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  // Signed, not absolute: the whole point is that the error has a DIRECTION.
  assert.ok(meanErr > -3.0,
    `tracked must not lag a rising HR by more than 3 bpm on average (got ${meanErr.toFixed(2)})`);
  assert.ok(Math.abs(worst) < 8.0,
    `worst-case ramp error stays under 8 bpm (got ${worst.toFixed(2)})`);

  // And the mechanism, so a regression is diagnosable rather than just red:
  // a longer anchor MUST be measurably worse on this same input.
  const laggy = new HeartRateAggregator({
    windowMs: WINDOW_MS, sampleIntervalMs: 1000, maxSlewBpmPerS: 1.5, trackerWindows: 9, robust: {},
  });
  const laggyErrors = [];
  for (let i = 0; i < TOTAL_S; i += 1) {
    const t = (i + 1) * 1000;
    const truth = START + ((END - START) * i) / TOTAL_S;
    const win = laggy.consumeFrame(
      { bpm: truth + jitter(i), snr: 8, confidence: 0.8, window_seconds: 12, method: 'pos' }, t,
    );
    if (win && Number.isFinite(win.bpm_tracked)) laggyErrors.push(win.bpm_tracked - truth);
  }
  const laggyMean = laggyErrors.reduce((a, b) => a + b, 0) / laggyErrors.length;
  assert.ok(laggyMean < meanErr,
    `a 9-window anchor lags MORE than the default (9-win ${laggyMean.toFixed(2)} vs default ${meanErr.toFixed(2)})`);
}

// ── steady HR stays unbiased — the shorter anchor must not cost this ─
{
  const agg = new HeartRateAggregator({
    windowMs: 10000, sampleIntervalMs: 1000, maxSlewBpmPerS: 1.5, robust: {},
    trackerWindows: createOyonSettings({ heart_rate_enabled: true }).heart_rate_tracker_windows,
  });
  const jitter = (i) => [3.1, -2.6, 1.2, -1.9, 2.4, -2.2][i % 6];
  const tracked = [];
  for (let i = 0; i < 300; i += 1) {
    const win = agg.consumeFrame(
      { bpm: 72 + jitter(i), snr: 8, confidence: 0.8, window_seconds: 12, method: 'pos' }, (i + 1) * 1000,
    );
    if (win && Number.isFinite(win.bpm_tracked)) tracked.push(win.bpm_tracked);
  }
  const settled = tracked.slice(Math.floor(tracked.length / 2));
  const meanTracked = settled.reduce((a, b) => a + b, 0) / settled.length;
  assert.ok(Math.abs(meanTracked - 72) < 1.5,
    `a steady 72 stays unbiased with the shorter anchor (got ${meanTracked.toFixed(2)})`);
}

console.log('heart-rate-robust.test.js — all cases passed');
