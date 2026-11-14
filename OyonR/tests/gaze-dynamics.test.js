import assert from 'node:assert/strict';
import { coefficientK, pooledMoments } from '../src/analytics/GazeDynamics.js';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

function momentsOf(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { n: values.length, mean, sd: Math.sqrt(variance) };
}

function windowFrom(durations, amplitudes, windowStart = null) {
  const d = momentsOf(durations);
  const a = momentsOf(amplitudes);
  return {
    window_start: windowStart,
    fixation_count: d.n,
    fixation_duration_ms_mean: d.mean,
    fixation_duration_ms_sd: d.sd,
    saccade_count: a.n,
    saccade_amplitude_mean: a.mean,
    saccade_amplitude_sd: a.sd,
  };
}

const FIELDS = {
  mean: 'fixation_duration_ms_mean',
  sd: 'fixation_duration_ms_sd',
  count: 'fixation_count',
};

// A — Pooling is EXACT, not an approximation. This is the whole reason the
//     aggregator emits per-window SDs.
{
  const groupA = [100, 200, 300];
  const groupB = [700, 900];
  const windows = [windowFrom(groupA, [1]), windowFrom(groupB, [1])];

  const pooled = pooledMoments(windows, FIELDS);
  const truth = momentsOf([...groupA, ...groupB]);

  assert.equal(pooled.n, 5);
  close(pooled.mean, truth.mean);
  close(pooled.sd, truth.sd);
}

// B — The failure mode the SD fields prevent: σ from window MEANS alone drops
//     all within-window variance and understates the true spread.
{
  const groupA = [100, 200, 300];
  const groupB = [700, 900];
  const windows = [windowFrom(groupA, [1]), windowFrom(groupB, [1])];

  const pooled = pooledMoments(windows, FIELDS);
  const meansOnly = momentsOf([200, 800]);
  assert.ok(
    pooled.sd > meansOnly.sd,
    'ignoring within-window variance must understate σ — that is the bug',
  );
}

// C — K is degenerate when pooled: equal-sized windows average to ~0. This is
//     why K is reported PER WINDOW, never as one session number.
{
  const windows = [
    windowFrom([100, 120], [0.4, 0.5]),
    windowFrom([300, 320], [0.1, 0.2]),
    windowFrom([200, 220], [0.25, 0.3]),
  ];
  const out = coefficientK(windows);
  close(out.k_mean, 0, 1e-9);
  assert.equal(out.windows.length, 3);
}

// D — Direction: long fixations with short saccades read FOCAL; the mirror
//     window reads AMBIENT. Signs, not magnitudes, carry the meaning.
{
  const windows = [
    windowFrom([400, 420], [0.05, 0.06], '2026-07-31T00:00:00.000Z'), // focal
    windowFrom([80, 90], [0.6, 0.7], '2026-07-31T00:00:03.000Z'),     // ambient
  ];
  const out = coefficientK(windows);
  const [focal, ambient] = out.windows;
  assert.ok(focal.k > 0, `expected focal K > 0, got ${focal.k}`);
  assert.ok(ambient.k < 0, `expected ambient K < 0, got ${ambient.k}`);
  assert.equal(focal.window_start, '2026-07-31T00:00:00.000Z');
}

// E — A session with no variation in either quantity has no defined K.
//     Emitting 0 would claim "neither mode dominates", which is a finding.
{
  const windows = [
    windowFrom([200, 200], [0.3, 0.3]),
    windowFrom([200, 200], [0.3, 0.3]),
  ];
  const out = coefficientK(windows);
  assert.equal(out.k_mean, null);
  assert.equal(out.mode, null);
  assert.deepEqual(out.windows, []);
}

// F — Windows with no saccades cannot be paired and are excluded, but still
//     contribute their fixations to the pooled fixation moments.
{
  const withSaccades = windowFrom([100, 120], [0.4, 0.5]);
  const noSaccades = {
    ...windowFrom([300], [0.1]),
    saccade_count: 0,
    saccade_amplitude_mean: null,
    saccade_amplitude_sd: null,
  };
  const out = coefficientK([withSaccades, noSaccades, windowFrom([260, 280], [0.15, 0.2])]);
  assert.equal(out.windows.length, 2, 'the saccade-less window yields no K');
  assert.equal(out.fixation.n, 5, 'but its fixations still shape the session mean');
}

// G — Records may arrive wrapped in a full window payload.
{
  const bare = windowFrom([400, 420], [0.05, 0.06]);
  const wrapped = { session_id: 's1', gaze: bare };
  const other = windowFrom([80, 90], [0.6, 0.7]);
  const fromBare = coefficientK([bare, other]);
  const fromWrapped = coefficientK([wrapped, { gaze: other }]);
  close(fromWrapped.windows[0].k, fromBare.windows[0].k);
}

// H — Empty input degrades, never throws.
{
  const out = coefficientK([]);
  assert.equal(out.k_mean, null);
  assert.equal(out.fixation.n, 0);
  assert.equal(out.schema_version, 'oyon-coefficient-k-v1');
}

// I — A missing SD is treated as zero spread within that window, not as a
//     reason to drop the window's observations from the pooled mean.
{
  const windows = [
    { fixation_count: 2, fixation_duration_ms_mean: 100, fixation_duration_ms_sd: null },
    { fixation_count: 2, fixation_duration_ms_mean: 300, fixation_duration_ms_sd: null },
  ];
  const pooled = pooledMoments(windows, FIELDS);
  assert.equal(pooled.n, 4);
  close(pooled.mean, 200);
  close(pooled.sd, 100);
}

console.log('gaze-dynamics: all assertions passed');
