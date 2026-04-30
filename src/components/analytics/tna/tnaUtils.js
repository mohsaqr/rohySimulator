/**
 * TNA computation utilities — thin wrappers around the tnaj package.
 * Converts tnaj Matrix objects to plain 2D arrays so downstream
 * components (NetworkGraph, CentralityChart) can use weights[i][j].
 */
import {
  tna as tnajTna,
  prune as tnajPrune,
  clusterSequences as tnajCluster,
  centralities as tnajCentralities,
} from 'tnaj';

/**
 * Convert a tnaj Matrix to a plain 2D array.
 */
function matrixTo2D(matrix, n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      row.push(matrix.get(i, j));
    }
    arr.push(row);
  }
  return arr;
}

/**
 * Compute a TNA model from sequences.
 * @param {string[][]} sequences
 * @param {{ labels: string[] }} options
 * @returns {{ labels: string[], weights: number[][], inits: Float64Array }}
 */
export function tna(sequences, { labels }) {
  const model = tnajTna(sequences);
  const n = model.labels.length;
  return {
    labels: model.labels,
    weights: matrixTo2D(model.weights, n),
    inits: model.inits,
  };
}

/**
 * Prune weak transitions below threshold (set to 0).
 */
export function prune(model, threshold) {
  const prunedWeights = model.weights.map(row =>
    row.map(w => (w >= threshold ? w : 0))
  );
  return { labels: model.labels, weights: prunedWeights, inits: model.inits };
}

/**
 * Find the maximum value in a 2D weight matrix.
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

/**
 * Cluster user sequences using tnaj's clusterSequences (PAM + Levenshtein).
 * @param {Object} userSequences - { userId: string[] } mapping
 * @param {string[]} labels - Ordered label list
 * @param {number} k - Number of clusters
 * @returns {{ id: number, userIds: string[], sequences: string[][] }[]}
 */
export function clusterSequences(userSequences, labels, k) {
  const userIds = Object.keys(userSequences);
  const seqs = userIds.map(uid => userSequences[uid]);
  const m = seqs.length;

  if (m <= k) {
    return seqs.map((seq, i) => ({
      id: i,
      userIds: [userIds[i]],
      sequences: [seq],
    }));
  }

  const result = tnajCluster(seqs, k, {
    dissimilarity: 'lv',
    method: 'pam',
  });

  // Group by cluster assignment
  const groups = new Map();
  for (let i = 0; i < m; i++) {
    const c = result.assignments[i];
    if (!groups.has(c)) groups.set(c, { userIds: [], sequences: [] });
    const g = groups.get(c);
    g.userIds.push(userIds[i]);
    g.sequences.push(seqs[i]);
  }

  const clusters = [];
  for (const [, g] of groups) {
    clusters.push({ id: clusters.length, userIds: g.userIds, sequences: g.sequences });
  }
  return clusters;
}

/**
 * Compute centrality metrics using tnaj.
 */
export function centralities(model) {
  // Build a tnaj model from our 2D array weights
  const n = model.labels.length;
  const tnajModel = tnajTna([['_dummy']]);
  // Instead, compute centralities manually from our 2D weights
  // (tnaj centralities expects a tnaj model with Matrix weights)
  const { labels, weights } = model;

  return labels.map((label, i) => {
    let outStrength = 0;
    let inStrength = 0;
    for (let j = 0; j < n; j++) {
      outStrength += weights[i][j];
      inStrength += weights[j][i];
    }
    return {
      label,
      inStrength: Math.round(inStrength * 1000) / 1000,
      outStrength: Math.round(outStrength * 1000) / 1000,
    };
  }).sort((a, b) => b.inStrength - a.inStrength);
}
