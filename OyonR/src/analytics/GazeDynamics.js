/**
 * GazeDynamics — coefficient K, the ambient/focal attention index.
 *
 *   K = z(fixation duration) − z(amplitude of the following saccade)
 *
 * Negative K: short fixations, long saccades — AMBIENT processing, the broad
 * scanning typical of orienting to a new display. Positive K: long fixations,
 * short saccades — FOCAL processing, inspecting something closely. Near zero:
 * neither mode dominates. (Krejtz, Duchowski & Krejtz, ACM TAP 2016.)
 *
 * ── Why this lives here and not in GazeAggregator ─────────────────────────
 *
 * The z-scores are taken over the whole scanpath, so K is undefined inside a
 * single window. Worse, it is degenerate over the whole series: the mean of a
 * z-score is zero by construction, so pooling every fixation into one K always
 * yields exactly 0. K only says something when computed PER WINDOW against
 * SESSION-level moments, which is what makes it a time-varying index of how
 * attention shifts between modes rather than a single session score.
 *
 * That decomposition is exact, not an approximation of the per-fixation mean:
 *
 *   mean over window w of [ (dᵢ−μ_d)/σ_d − (aᵢ−μ_a)/σ_a ]
 *     = (d̄_w − μ_d)/σ_d − (ā_w − μ_a)/σ_a
 *
 * because z is affine in the observation. So window means suffice — provided
 * μ and σ are the SESSION moments. Estimating σ from the window means alone
 * would capture only between-window variance, understating σ and inflating
 * every |K|. `GazeAggregator` therefore emits `fixation_duration_ms_sd` and
 * `saccade_amplitude_sd` so the total variance can be pooled exactly.
 *
 * The one genuine approximation: Krejtz pairs fixation i with saccade i+1,
 * while a window's means pair its fixations with its own saccades. The pairing
 * differs only at window boundaries — one pair per window — so it is
 * negligible at any realistic fixation count and is disclosed as
 * `boundary_pairs` rather than hidden.
 */

const FIXATION = Object.freeze({
  mean: 'fixation_duration_ms_mean',
  sd: 'fixation_duration_ms_sd',
  count: 'fixation_count',
});

const SACCADE = Object.freeze({
  mean: 'saccade_amplitude_mean',
  sd: 'saccade_amplitude_sd',
  count: 'saccade_count',
});

/**
 * Pool mean and SD across windows from per-window moments.
 *
 * σ² = Σ nᵢ(σᵢ² + (μᵢ − μ)²) / Σ nᵢ — the standard within-plus-between
 * decomposition. Exact given each window's own n, μ and σ.
 *
 * @param {Array<object>} windows
 * @param {{mean: string, sd: string, count: string}} fields
 * @returns {{n: number, mean: number|null, sd: number|null, windows: number}}
 */
export function pooledMoments(windows, fields) {
  let n = 0;
  let weightedSum = 0;
  let contributing = 0;
  const usable = [];

  for (const window of Array.isArray(windows) ? windows : []) {
    const count = finiteNumber(window?.[fields.count]);
    const m = finiteNumber(window?.[fields.mean]);
    if (count === null || count <= 0 || m === null) continue;
    // A missing SD means "spread unknown"; treating it as 0 keeps the window's
    // observations in the pooled MEAN, which is the part we can still trust.
    const sd = finiteNumber(window?.[fields.sd]);
    usable.push({ count, mean: m, sd: sd !== null && sd >= 0 ? sd : 0 });
    n += count;
    weightedSum += count * m;
    contributing += 1;
  }

  if (n === 0) return { n: 0, mean: null, sd: null, windows: 0 };
  const mean = weightedSum / n;
  let variance = 0;
  for (const item of usable) {
    variance += item.count * (item.sd * item.sd + (item.mean - mean) ** 2);
  }
  return { n, mean, sd: Math.sqrt(variance / n), windows: contributing };
}

/**
 * Coefficient K per window, against session-pooled moments.
 *
 * @param {Array<object>} windows  Gaze blocks (or records carrying one).
 * @returns {{schema_version: string,
 *            fixation: ReturnType<typeof pooledMoments>,
 *            saccade: ReturnType<typeof pooledMoments>,
 *            boundary_pairs: number,
 *            mode: 'ambient'|'focal'|'mixed'|null,
 *            k_mean: number|null,
 *            windows: Array<{window_start: string|null, k: number,
 *                            fixation_z: number, saccade_z: number}>}}
 */
export function coefficientK(windows) {
  const list = (Array.isArray(windows) ? windows : []).map(gazeOf).filter(Boolean);
  const fixation = pooledMoments(list, FIXATION);
  const saccade = pooledMoments(list, SACCADE);

  const empty = {
    schema_version: 'oyon-coefficient-k-v1',
    fixation,
    saccade,
    boundary_pairs: 0,
    mode: null,
    k_mean: null,
    windows: [],
  };

  // K is a contrast between two z-scores; a zero σ on either side makes it
  // undefined rather than zero. Refuse rather than emit a confident 0.
  if (!(fixation.sd > 0) || !(saccade.sd > 0)) return empty;

  const perWindow = [];
  let boundaryPairs = 0;
  for (const gaze of list) {
    const d = finiteNumber(gaze[FIXATION.mean]);
    const a = finiteNumber(gaze[SACCADE.mean]);
    const saccadeCount = finiteNumber(gaze[SACCADE.count]);
    if (d === null || a === null || saccadeCount === null || saccadeCount <= 0) continue;
    const fixationZ = (d - fixation.mean) / fixation.sd;
    const saccadeZ = (a - saccade.mean) / saccade.sd;
    perWindow.push({
      window_start: typeof gaze.window_start === 'string' ? gaze.window_start : null,
      k: fixationZ - saccadeZ,
      fixation_z: fixationZ,
      saccade_z: saccadeZ,
    });
    boundaryPairs += 1;
  }

  if (perWindow.length === 0) return empty;
  const kMean = perWindow.reduce((sum, item) => sum + item.k, 0) / perWindow.length;

  return {
    ...empty,
    boundary_pairs: boundaryPairs,
    k_mean: kMean,
    mode: classifyMode(kMean),
    windows: perWindow,
  };
}

/*
 * The ±0.1 band is a READABILITY threshold, not a significance test. K is a
 * difference of z-scores, so values near zero mean the two standardized
 * quantities were comparable — reporting that as "focal" because it came out
 * at +0.02 would overclaim. Anything resting on the distinction should test
 * it, not read this label.
 */
function classifyMode(k) {
  if (!Number.isFinite(k)) return null;
  if (k > 0.1) return 'focal';
  if (k < -0.1) return 'ambient';
  return 'mixed';
}

/*
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so a bare Number()
 * would read a window with no fixations as one with a mean duration of 0 ms —
 * a value that then anchors the session mean and every K derived from it.
 */
function finiteNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function gazeOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.gaze && typeof record.gaze === 'object') return record.gaze;
  return record;
}
