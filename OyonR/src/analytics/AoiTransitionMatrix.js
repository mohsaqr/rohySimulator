/**
 * AoiTransitionMatrix — pool per-window `aoi_transitions` into one labelled
 * transition-count matrix.
 *
 * This is the whole of Oyon's contribution to gaze transition entropy, and
 * deliberately so. Oyon owns the emit format, so reshaping its own
 * `{"from→to": count}` maps into a square matrix is its job. Computing entropy
 * from that matrix is NOT: `transitionEntropy()` already exists in tnaj
 * (a verified port of Nestimate's `transition_entropy()`) and returns the row
 * entropies, the stationary distribution from the eigenvector of Pᵀ, the
 * entropy rate h(P) = Σ πᵢ H(Pᵢ·) and the redundancy H(π) − h(P). Duplicating
 * that here would fork a maintained algorithm into a sensing library.
 *
 * ── Why pooling is the point, not a convenience ──────────────────────────
 *
 * Entropy was first attempted per window and removed. Over 400 stationary
 * sessions the per-window estimate had a 95% interval of [0.00, 1.17] bits
 * against a true 1.585 — an interval containing zero, on a process with no
 * structure at all. A 3-second window simply does not hold enough transitions
 * to estimate a conditional distribution, and plug-in entropy is biased
 * downward on sparse counts.
 *
 * Pooling is what fixes it, so this module reports `nTransitions` and an
 * explicit `adequate` flag rather than handing back a number that looks
 * usable at any sample size. A caller that ignores adequacy gets the same
 * silently-biased estimate the per-window field would have given.
 */

/*
 * Separators accepted in a transition key.
 *
 * `GazeAggregator` emits U+2192 (`a→b`). The ASCII form is accepted too
 * because it turns up in stored data: the demo fixture used it for a long
 * time, and nothing before this module ever split the key — every prior
 * consumer just summed the values or counted the keys — so the divergence went
 * unnoticed and unvalidated. Rejecting it would silently drop every
 * transition in such a dataset, which is worse than tolerating two spellings.
 *
 * Longest first: `->` must be tried before `>` would ever be added.
 */
const ARROWS = ['→', '->'];

function splitPair(key) {
  for (const arrow of ARROWS) {
    const at = key.indexOf(arrow);
    // Reject a leading or trailing arrow — one side would be empty.
    if (at > 0 && at + arrow.length < key.length) {
      return [key.slice(0, at), key.slice(at + arrow.length)];
    }
  }
  return null;
}

/*
 * Below this many pooled transitions the estimate is not trustworthy.
 *
 * The count matrix has n(n−1) reachable off-diagonal cells, and the usual
 * rule of thumb for a multinomial cell estimate is a handful of observations
 * each. `5n` is a deliberately permissive floor — it is a guard against
 * obvious nonsense (three transitions over four AOIs), not a power analysis.
 * Callers doing inference should set their own.
 */
const MIN_TRANSITIONS_PER_STATE = 5;

/**
 * @typedef {object} AoiTransitionMatrixResult
 * @property {string[]} labels      AOI ids, sorted, indexing both axes.
 * @property {number[][]} counts    counts[i][j] = observed i→j transitions.
 * @property {number[]} rowTotals   Outgoing total per source AOI.
 * @property {number} nTransitions  Total pooled transitions.
 * @property {number} windows       Windows that contributed at least one.
 * @property {boolean} adequate     Whether `nTransitions` clears the floor.
 * @property {number} minTransitions The floor that was applied.
 */

/**
 * Pool `aoi_transitions` across windows.
 *
 * @param {Array<object>} windows  Window records, or bare gaze blocks.
 * @param {object} [options]
 * @param {string[]} [options.labels]  Force the state set — pass the
 *        configured AOI ids to keep a never-visited AOI in the matrix as a
 *        zero row. Dropping it would silently shrink the state space and
 *        inflate every normalized entropy that divides by log(n).
 * @param {number} [options.minTransitions]  Override the adequacy floor.
 * @returns {AoiTransitionMatrixResult}
 */
export function aoiTransitionMatrix(windows, options = {}) {
  const list = (Array.isArray(windows) ? windows : []).map(gazeOf).filter(Boolean);

  // Two passes: collect the state set first so every row is the same width
  // even when an AOI only ever appears as a destination.
  const seen = new Set(Array.isArray(options.labels) ? options.labels.filter(isId) : []);
  const pairs = [];
  let contributingWindows = 0;

  for (const gaze of list) {
    const transitions = gaze.aoi_transitions;
    if (!transitions || typeof transitions !== 'object') continue;
    let contributed = false;
    for (const [key, rawCount] of Object.entries(transitions)) {
      const count = toCount(rawCount);
      if (count === null || count === 0) continue;
      const pair = splitPair(key);
      if (pair === null) continue;
      const [from, to] = pair;
      if (!isId(from) || !isId(to)) continue;
      seen.add(from);
      seen.add(to);
      pairs.push([from, to, count]);
      contributed = true;
    }
    if (contributed) contributingWindows += 1;
  }

  const labels = [...seen].sort();
  const index = new Map(labels.map((id, i) => [id, i]));
  const counts = labels.map(() => new Array(labels.length).fill(0));

  let nTransitions = 0;
  for (const [from, to, count] of pairs) {
    counts[index.get(from)][index.get(to)] += count;
    nTransitions += count;
  }

  const rowTotals = counts.map(row => row.reduce((sum, value) => sum + value, 0));
  const minTransitions = Number.isFinite(options.minTransitions) && options.minTransitions >= 0
    ? options.minTransitions
    : MIN_TRANSITIONS_PER_STATE * labels.length;

  return {
    labels,
    counts,
    rowTotals,
    nTransitions,
    windows: contributingWindows,
    adequate: labels.length >= 2 && nTransitions >= minTransitions,
    minTransitions,
  };
}

/**
 * Row-normalize the pooled counts into a transition probability matrix.
 *
 * A row with no outgoing transitions stays ALL ZERO rather than being filled
 * with 1/n. A state that was entered and never left is absorbing — a real
 * property of the scanpath — and a uniform row would invent branching that
 * never happened.
 *
 * That makes the result unsuitable for `transitionEntropy()`, which rejects
 * zero-sum rows because the stationary distribution of a non-ergodic chain is
 * not unique. Pass `activeSubchain(matrix)` first — see there.
 *
 * @param {AoiTransitionMatrixResult} matrix
 * @returns {number[][]}
 */
export function toProbabilityMatrix(matrix) {
  return matrix.counts.map((row, i) => {
    const total = matrix.rowTotals[i];
    if (!(total > 0)) return row.map(() => 0);
    return row.map(value => value / total);
  });
}

/**
 * Restrict the matrix to states that actually participate in the chain.
 *
 * Two things make zero-sum rows routine here, not exotic: an AOI passed in
 * `labels` but never looked at, and an AOI entered once at the very end of a
 * session and never left. Either produces a row of zeros, and
 * `transitionEntropy()` throws on those — correctly, since a chain with an
 * absorbing state has no unique stationary distribution.
 *
 * So the states are pruned before the entropy call, iteratively: removing a
 * state can strand another one whose only outgoing transitions pointed at it,
 * so a single pass is not enough.
 *
 * The pruned ids are RETURNED, not swallowed. Entropy over 2 of 5 AOIs is a
 * different quantity from entropy over 5, and everything normalized by log(n)
 * shifts with n — a caller that cannot see what was dropped cannot know which
 * number it is holding.
 *
 * @param {AoiTransitionMatrixResult} matrix
 * @returns {{labels: string[], counts: number[][], rowTotals: number[],
 *            dropped: string[], nTransitions: number}}
 */
export function activeSubchain(matrix) {
  let keep = matrix.labels.map((_, i) => i);

  for (;;) {
    const keepSet = new Set(keep);
    // A state survives only if it still has an outgoing transition to another
    // surviving state.
    const next = keep.filter(i =>
      keep.some(j => matrix.counts[i][j] > 0 && keepSet.has(j)));
    if (next.length === keep.length) break;
    keep = next;
    if (keep.length === 0) break;
  }

  const labels = keep.map(i => matrix.labels[i]);
  const counts = keep.map(i => keep.map(j => matrix.counts[i][j]));
  const rowTotals = counts.map(row => row.reduce((sum, value) => sum + value, 0));
  const kept = new Set(labels);

  return {
    labels,
    counts,
    rowTotals,
    dropped: matrix.labels.filter(id => !kept.has(id)),
    nTransitions: rowTotals.reduce((sum, value) => sum + value, 0),
  };
}

function gazeOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.gaze && typeof record.gaze === 'object') return record.gaze;
  return record;
}

function isId(value) {
  return typeof value === 'string' && value.length > 0;
}

/*
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so coercing blindly
 * would turn a malformed entry into a real zero-count observation.
 */
function toCount(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}
