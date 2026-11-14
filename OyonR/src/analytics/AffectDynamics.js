/**
 * @deprecated Analysis belongs in ladyna: use `seriesDynamics(values, { times })`
 * from `ladyna/stats` (same triad, plus the ratio reading; R-checked). The app
 * no longer calls this; it stays for existing `oyon/analytics/affect-dynamics`
 * importers and will be removed in a future major version.
 *
 * AffectDynamics — the validated affect-dynamics triad over a window series.
 *
 * A stream of 3-second windows IS an intensive-longitudinal series, which is
 * exactly the design the affect-dynamics literature was built for. Three
 * indices, each measuring something the others do not:
 *
 *   variability   within-person SD          how far affect ranges from its own mean
 *   instability   RMSSD                     how large the moment-to-moment jumps are
 *   inertia       lag-1 autocorrelation     how strongly affect predicts itself
 *
 * REPORT ALL THREE OR NONE. At constant variability, instability and inertia
 * are arithmetically inverse — a series can be volatile (high RMSSD, low AR1)
 * or sluggish (low RMSSD, high AR1) at identical SD. Surfacing one alone is
 * the "inertia–instability paradox" that produced a decade of contradictory
 * findings; surfacing the pair is what makes either one readable.
 *
 * References: Wendt et al., Eur J Personality (2020) — structure and
 * reliability of affect-dynamic indicators; Koval et al. — the paradox.
 *
 * This is deliberately SEPARATE from DynamicalFeatures.js, which is per-window
 * (velocity/acceleration from the neighbouring window). These are series-level
 * and need the whole session. Note that DynamicalFeatures' `instability_score`
 * is an unvalidated hand-weighted composite of five heterogeneous terms; where
 * the two disagree, `instability` here is the measure with a literature behind
 * it.
 */

const DEFAULT_CHANNELS = Object.freeze({
  valence: 'valence',
  arousal: 'arousal',
});

/** A successive pair is only successive if no window is missing between them. */
const DEFAULT_GAP_TOLERANCE = 1.5;

/**
 * @typedef {object} ChannelDynamics
 * @property {number} n              usable observations
 * @property {number} n_pairs        adjacent pairs that survived the gap check
 * @property {number} pairs_dropped  pairs rejected as non-adjacent in time
 * @property {number|null} mean
 * @property {number|null} variability  within-person SD
 * @property {number|null} instability  RMSSD
 * @property {number|null} inertia      lag-1 autocorrelation, [-1, 1]
 */

/**
 * Compute the triad for each configured channel.
 *
 * @param {Array<object>} windows  Window records, any order — sorted here.
 * @param {object} [options]
 * @param {Record<string,string>} [options.channels]  label -> field name.
 * @param {number} [options.gapTolerance=1.5]  A pair whose spacing exceeds
 *        this multiple of the median spacing is not treated as successive.
 *        Successive-difference measures assume even sampling; a paused session
 *        silently violates that and inflates RMSSD if left unchecked.
 * @returns {{schema_version: string, spacing_ms: number|null,
 *            channels: Record<string, ChannelDynamics>}}
 */
export function affectDynamics(windows, options = {}) {
  const channels = options.channels ?? DEFAULT_CHANNELS;
  const gapTolerance = Number.isFinite(options.gapTolerance) && options.gapTolerance > 0
    ? options.gapTolerance
    : DEFAULT_GAP_TOLERANCE;

  const ordered = orderByTime(Array.isArray(windows) ? windows : []);
  const spacing = medianSpacingMs(ordered);
  const gapLimit = spacing == null ? null : spacing * gapTolerance;

  const out = {};
  for (const [label, field] of Object.entries(channels)) {
    out[label] = channelDynamics(ordered, field, gapLimit);
  }
  return { schema_version: 'oyon-affect-dynamics-v1', spacing_ms: spacing, channels: out };
}

function channelDynamics(ordered, field, gapLimit) {
  const values = [];
  const times = [];
  for (const window of ordered) {
    const value = finiteNumber(window?.[field]);
    if (value === null) continue;
    values.push(value);
    times.push(window.__ts);
  }

  const n = values.length;
  const empty = {
    n, n_pairs: 0, pairs_dropped: 0,
    mean: null, variability: null, instability: null, inertia: null,
  };
  if (n === 0) return empty;

  const m = values.reduce((sum, value) => sum + value, 0) / n;
  const centered = values.map(value => value - m);
  const sumSquares = centered.reduce((sum, value) => sum + value * value, 0);
  const variability = n >= 2 ? Math.sqrt(sumSquares / (n - 1)) : null;

  // Only pairs that are genuinely adjacent in time feed the lag-1 measures.
  let squaredDiffTotal = 0;
  let lagProduct = 0;
  let pairs = 0;
  let dropped = 0;
  for (let i = 1; i < n; i += 1) {
    const spacing = times[i] != null && times[i - 1] != null ? times[i] - times[i - 1] : null;
    if (gapLimit != null && spacing != null && spacing > gapLimit) {
      dropped += 1;
      continue;
    }
    squaredDiffTotal += (values[i] - values[i - 1]) ** 2;
    lagProduct += centered[i] * centered[i - 1];
    pairs += 1;
  }

  return {
    ...empty,
    n_pairs: pairs,
    pairs_dropped: dropped,
    mean: m,
    variability,
    // RMSSD, not MSSD — root-mean keeps it on the same scale as the SD above,
    // so the two are directly comparable by eye.
    instability: pairs > 0 ? Math.sqrt(squaredDiffTotal / pairs) : null,
    // A flat series has zero variance and therefore no defined autocorrelation.
    // Returning 0 there would read as "no self-prediction" when the truth is
    // "perfectly self-predicting"; null is the honest answer.
    inertia: pairs > 0 && sumSquares > 0
      ? clampCorrelation(lagProduct / sumSquares)
      : null,
  };
}

function orderByTime(windows) {
  return windows
    .map(window => ({ ...window, __ts: timestampOf(window) }))
    .filter(window => window.__ts != null)
    .sort((a, b) => a.__ts - b.__ts);
}

function timestampOf(window) {
  for (const field of ['window_start_ms', 'window_start', 'window_end']) {
    const value = window?.[field];
    if (Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function medianSpacingMs(ordered) {
  const gaps = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i].__ts - ordered[i - 1].__ts;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/*
 * Coerce only what is genuinely numeric. `Number(null)` is 0 and
 * `Number.isFinite(0)` is true, so a bare Number() would silently turn "not
 * measured" into "measured exactly zero" — dragging the mean, inflating RMSSD,
 * and never erroring. Missing readings are common here: a window with no face
 * detected carries null valence.
 */
function finiteNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}
