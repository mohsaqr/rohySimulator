/**
 * Transition Network Analysis (TNA) computation utilities.
 * Builds transition probability matrices from categorical action sequences.
 */

/**
 * Compute a TNA model from sequences of categorical actions.
 * @param {string[][]} sequences - Array of action sequences
 * @param {{ labels: string[] }} options - Options with ordered label list
 * @returns {{ labels: string[], weights: number[][], inits: Float64Array }}
 */
export function tna(sequences, { labels }) {
  const n = labels.length;
  const labelIndex = Object.create(null);
  labels.forEach((l, i) => { labelIndex[l] = i; });

  // Transition counts: counts[i][j] = number of i→j transitions
  const counts = Array.from({ length: n }, () => new Float64Array(n));
  // Initial counts
  const initCounts = new Float64Array(n);

  for (const seq of sequences) {
    if (seq.length === 0) continue;
    const firstIdx = labelIndex[seq[0]];
    if (firstIdx !== undefined) {
      initCounts[firstIdx]++;
    }
    for (let k = 0; k < seq.length - 1; k++) {
      const from = labelIndex[seq[k]];
      const to = labelIndex[seq[k + 1]];
      if (from !== undefined && to !== undefined) {
        counts[from][to]++;
      }
    }
  }

  // Normalize rows to probabilities
  const weights = counts.map(row => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum === 0) return Array.from(row);
    return Array.from(row, v => v / sum);
  });

  // Normalize initial probabilities
  const initSum = initCounts.reduce((a, b) => a + b, 0);
  const inits = initSum > 0
    ? new Float64Array(initCounts.map(v => v / initSum))
    : new Float64Array(n);

  return { labels, weights, inits };
}

/**
 * Prune weak transitions below threshold (set to 0).
 * @param {{ labels: string[], weights: number[][], inits: Float64Array }} model
 * @param {number} threshold - Minimum weight to keep (0-0.5)
 * @returns {{ labels: string[], weights: number[][], inits: Float64Array }}
 */
export function prune(model, threshold) {
  const prunedWeights = model.weights.map(row =>
    row.map(w => (w >= threshold ? w : 0))
  );
  return { labels: model.labels, weights: prunedWeights, inits: model.inits };
}

/**
 * Find the maximum value in a 2D weight matrix.
 * @param {number[][]} weights - N x N matrix
 * @returns {number}
 */
export function maxWeight(weights) {
  let max = 0;
  for (const row of weights) {
    for (const w of row) {
      if (w > max) max = w;
    }
  }
  return max;
}
