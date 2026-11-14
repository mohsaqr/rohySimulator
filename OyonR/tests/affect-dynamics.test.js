import assert from 'node:assert/strict';
import { affectDynamics } from '../src/analytics/AffectDynamics.js';

const STEP = 3000;

function series(values, { step = STEP, start = 0 } = {}) {
  return values.map((valence, index) => ({
    window_start: new Date(start + index * step).toISOString(),
    valence,
    arousal: 0,
  }));
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

// A — Hand-computed triad on a known series.
{
  // 0, 2, 0, 2 → mean 1; SD (sample) = sqrt(4/3); successive diffs all ±2 so
  // RMSSD = 2; lag-1 products all (-1)(+1) = -1, sum = -3, Σ(x−x̄)² = 4,
  // so inertia = -0.75.
  const { channels } = affectDynamics(series([0, 2, 0, 2]));
  const v = channels.valence;
  assert.equal(v.n, 4);
  assert.equal(v.n_pairs, 3);
  assert.equal(v.pairs_dropped, 0);
  close(v.mean, 1);
  close(v.variability, Math.sqrt(4 / 3));
  close(v.instability, 2);
  close(v.inertia, -0.75);
}

// B — The paradox, made concrete: identical variability, opposite dynamics.
//     A perfectly alternating series and a smooth ramp are both SD-equal here
//     only by construction, so compare the ORDERING the two indices give.
{
  const zigzag = affectDynamics(series([0, 1, 0, 1, 0, 1])).channels.valence;
  const drift = affectDynamics(series([0, 0, 0, 1, 1, 1])).channels.valence;

  close(zigzag.variability, drift.variability);
  assert.ok(
    zigzag.instability > drift.instability,
    'alternation must be more UNSTABLE than a single step',
  );
  assert.ok(
    zigzag.inertia < drift.inertia,
    'alternation must be less INERT than a single step',
  );
  // The whole reason both are reported: variability alone cannot tell these
  // two sessions apart, and they are not the same session.
}

// C — A flat series has no defined self-prediction. Zero would read as
//     "does not predict itself", which is the opposite of the truth.
{
  const v = affectDynamics(series([0.4, 0.4, 0.4, 0.4])).channels.valence;
  close(v.variability, 0);
  close(v.instability, 0);
  assert.equal(v.inertia, null);
}

// D — A gap in the session must not become a successive difference.
{
  const windows = [
    ...series([0, 0, 0]),
    // Sensing paused for a minute; the next value is not "the next moment".
    ...series([1], { start: 60_000 }),
  ];
  const v = affectDynamics(windows).channels.valence;
  assert.equal(v.n, 4, 'the post-gap window still counts toward mean and SD');
  assert.equal(v.n_pairs, 2, 'only genuinely adjacent pairs feed RMSSD');
  assert.equal(v.pairs_dropped, 1);
  close(v.instability, 0, 1e-12);

  // Without the guard the straddling pair would contribute a jump of 1.
  const unguarded = affectDynamics(windows, { gapTolerance: 1e6 }).channels.valence;
  assert.equal(unguarded.n_pairs, 3);
  assert.ok(unguarded.instability > 0.5, 'the guard is what suppresses this');
}

// E — Dropped pairs are disclosed, never silent.
{
  const windows = [...series([0, 1]), ...series([2], { start: 60_000 })];
  const v = affectDynamics(windows).channels.valence;
  assert.ok(v.pairs_dropped > 0);
  assert.ok(
    Object.prototype.hasOwnProperty.call(v, 'pairs_dropped'),
    'a caller must be able to see that coverage was reduced',
  );
}

// F — Unordered input is sorted, not trusted.
{
  const ordered = affectDynamics(series([0, 2, 0, 2])).channels.valence;
  const shuffled = affectDynamics([...series([0, 2, 0, 2])].reverse()).channels.valence;
  close(shuffled.inertia, ordered.inertia);
  close(shuffled.instability, ordered.instability);
}

// G — Non-finite values are skipped, not coerced to zero.
{
  const windows = series([1, 1, 1]);
  windows[1].valence = null;
  const v = affectDynamics(windows).channels.valence;
  assert.equal(v.n, 2);
  close(v.mean, 1);
}

// H — Both channels are computed independently.
{
  const windows = series([0, 1, 0, 1]).map((w, i) => ({ ...w, arousal: i }));
  const { channels } = affectDynamics(windows);
  assert.ok(channels.valence.instability > 0);
  assert.ok(channels.arousal.instability > 0);
  assert.notEqual(channels.valence.mean, channels.arousal.mean);
}

// I — Empty and single-observation inputs degrade to nulls, not throws.
{
  const none = affectDynamics([]).channels.valence;
  assert.equal(none.n, 0);
  assert.equal(none.instability, null);
  assert.equal(none.inertia, null);

  const one = affectDynamics(series([0.5])).channels.valence;
  assert.equal(one.n, 1);
  assert.equal(one.variability, null, 'one observation has no spread');
  assert.equal(one.instability, null);
}

// J — Median spacing is reported so a reader can judge the sampling cadence.
{
  const out = affectDynamics(series([0, 1, 2]));
  assert.equal(out.spacing_ms, STEP);
  assert.equal(out.schema_version, 'oyon-affect-dynamics-v1');
}

console.log('affect-dynamics: all assertions passed');
