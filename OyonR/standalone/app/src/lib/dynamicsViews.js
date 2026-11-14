/*
 * Dynamics views — the library behind /analyze/sequence (a person's
 * sessions). View-model layer, node-testable; the same contract as
 * patternViews.js, so a group page can call it on group sequences later.
 *
 * Input is plain state sequences, `(string|null)[][]`; the page decides where
 * they come from. Every number comes from ladyna and every picture is the SVG
 * a ladyna painter returns:
 *
 *   sequences    sequenceIndices; plotSequenceIndex, plotStateDistribution,
 *                plotEntropyProfile, plotMeanTimes
 *   network      tna → plotNetwork; centralities → plotCentralities;
 *                communities → plotMCML (communities as clusters)
 *   reliability  bootstrapTna → plotNetwork (stable edges);
 *                estimateCS → plotStability (case-dropping)
 *   lag          lsa → plotLSA (heatmap, network), plotPolar; pAdjust (BH)
 *   transfer     transferEntropy (surrogate test) → plotNetwork; pAdjust (BH)
 *   clusters     mmm (several starts, several k) or clusterSequences (PAM)
 *                → groupTna → plotNetworkGrid; plotMeanTimes, plotSequenceIndex
 *
 * Views follow lib/ladynaViews.js: `{ id, title, caption, svg, note, error,
 * file_name }`. Tables are tidy, one row per sequence / state / edge / k.
 * Numbers in tables are rounded for display only.
 */
import { tna, groupTna, plotNetwork, plotNetworkGrid } from 'ladyna/core';
import {
  centralities, plotCentralities, communities, bootstrapTna, estimateCSAcrossSeeds, csReading, plotStability,
  clusterSequences, mmm,
} from 'ladyna/analysis';
import { plotMCML } from 'ladyna/htna';
import {
  sequenceIndices, plotSequenceIndex, plotStateDistribution, plotEntropyProfile, plotMeanTimes, trimSummary,
} from 'ladyna/sequences';
import { lsa, plotLSA, plotPolar, transferEntropy } from 'ladyna/lagdynamics';
import { OyonViewError, matrixModel, paint, step, view } from './ladynaViews.js';
import { stateColors } from './patternViews.js';
import { OKABE_ITO, stateColourMap } from './stateColours.js';

export { stateColors, csReading };

export const DYNAMICS_SECTIONS = Object.freeze([
  { id: 'sequences', label: 'Sequences' },
  { id: 'network', label: 'Network' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'lag', label: 'Lag-sequential' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'transfer', label: 'Transfer entropy' },
]);

export const CENTRALITY_MEASURES = Object.freeze(['InStrength', 'OutStrength', 'Betweenness']);
export const COMMUNITY_METHODS = Object.freeze(['walktrap', 'louvain', 'leading_eigen', 'fast_greedy', 'label_prop', 'edge_betweenness']);
export const DISSIMILARITIES = Object.freeze(['lcs', 'hamming', 'lv', 'osa', 'dl']);

/**
 * How many positions the position-aligned plots (index, distribution,
 * entropy) show, as ladyna `trimSequences` options. Sessions differ a lot in
 * length; one long session otherwise stretches the axis until the positions
 * every session shares are a sliver. Mean times and the indices table always
 * use the whole sequences.
 */
export const POSITION_CUTS = Object.freeze([
  { id: 'p75', label: '75th percentile of lengths', trim: { mode: 'percentile', percentile: 75 } },
  { id: 'p50', label: 'median length', trim: { mode: 'percentile', percentile: 50 } },
  { id: 'p90', label: '90th percentile of lengths', trim: { mode: 'percentile', percentile: 90 } },
  { id: 'all', label: 'all positions', trim: { mode: 'none' } },
]);

const colorsFor = (labels, colorMap) => labels.map((l) => colorMap[l] ?? '#999999');

// ── input ──────────────────────────────────────────────────────────────────

/**
 * The usable sequences and their labels. Labels default to S1…Sn in input
 * order, so a row in a table points back at its sequence.
 *
 * `min_states` is 2 (the default) wherever a transition is needed (network,
 * reliability, lag, clusters, transfer entropy); the descriptive Sequences
 * section passes 1 so a one-state session still shows in the index plot, the
 * distribution, the mean times and the indices.
 */
export function usableSequences(sequences, labels = null, { min_states: minStates = 2 } = {}) {
  if (!Array.isArray(sequences)) throw new OyonViewError('`sequences` must be an array of state sequences', 'dynamics_bad_input');
  if (labels !== null && (!Array.isArray(labels) || labels.length !== sequences.length)) {
    throw new OyonViewError('`labels` must have one entry per sequence', 'dynamics_bad_input');
  }
  const out = { sequences: [], labels: [] };
  sequences.forEach((seq, i) => {
    if (!Array.isArray(seq)) return;
    const k = seq.filter((s) => s !== null && s !== undefined && s !== '').length;
    if (k < minStates) return;
    out.sequences.push(seq.map((s) => (s === undefined || s === '' ? null : s)));
    out.labels.push(labels ? String(labels[i]) : `S${i + 1}`);
  });
  if (!out.sequences.length) {
    throw new OyonViewError(minStates < 2 ? 'no sequence has a state' : 'no sequence has two or more states', 'dynamics_empty');
  }
  return out;
}

const round = (x, d = 3) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(d)) : x == null || Number.isNaN(x) ? '–' : x);

function fmtP(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '–';
  return p < 0.001 ? Number(p.toExponential(1)) : Number(p.toFixed(3));
}

const errorViews = (vs, error) => vs.map((v) => ({ ...v, error }));

// ── 1 · sequences ──────────────────────────────────────────────────────────

/**
 * Sequence descriptives: the index plot, the state distribution over time,
 * the entropy profile and mean time in each state; per-sequence indices
 * (ladyna `sequenceIndices`) as one row per sequence.
 */
export function sequenceDescViews(sequences, { labels = null, positions = 'p75', colorMap = null } = {}) {
  const v = [
    view('sequences-index', 'Sequence index plot', 'ladyna plotSequenceIndex: one row per sequence, one cell per state.'),
    view('sequences-distribution', 'State distribution by position', 'ladyna plotStateDistribution (TraMineR seqdplot): the share of sequences in each state at each position.'),
    view('sequences-entropy', 'Entropy profile', 'ladyna plotEntropyProfile (TraMineR seqHtplot): the cross-sectional entropy of the states at each position.'),
    view('sequences-meantimes', 'Mean time in each state', 'ladyna plotMeanTimes (TraMineR seqmtplot): mean number of positions spent in each state per sequence.'),
  ];
  // Descriptive: every nonempty sequence counts, a one-state session included.
  const input = step(() => usableSequences(sequences, labels, { min_states: 1 }));
  if (input.error) return { views: errorViews(v, input.error), rows: [], positions: null };
  const { sequences: seqs, labels: ids } = input.ok;
  const colors = colorMap ?? stateColors(seqs);
  const cut = POSITION_CUTS.find((c) => c.id === positions);
  if (!cut) {
    const error = { source: 'oyon', code: 'dynamics_bad_input', message: `unknown positions cut '${positions}'` };
    return { views: errorViews(v, error), rows: [], positions: null, error };
  }
  // ladyna trims and says what it cut (trimSummary; the painters' `trim` subtitle).
  const t = trimSummary(seqs, cut.trim);
  const positionsInfo = { cut: cut.id, label: t.description, shown: t.positions ?? t.longest, longest: t.longest, n_cut: t.nTrimmed, note: t.note };
  const views = [
    paint(v[0], () => plotSequenceIndex(seqs, { trim: cut.trim, rowLabels: ids, colorMap: colors, title: 'Sequence index plot' })),
    paint(v[1], () => plotStateDistribution(seqs, { trim: cut.trim, colorMap: colors, title: 'State distribution by position' })),
    paint(v[2], () => plotEntropyProfile(seqs, { trim: cut.trim, title: 'Entropy profile' })),
    paint(v[3], () => plotMeanTimes(seqs, { stateColorMap: colors, title: 'Mean time in each state' })),
  ];
  const idx = step(() => sequenceIndices(seqs));
  if (idx.error) return { views, rows: [], positions: positionsInfo, error: idx.error };
  const rows = idx.ok.map((r, i) => ({
    sequence: ids[i],
    length: r.validN,
    states: r.uniqueStates,
    first: r.firstState ?? '–',
    last: r.lastState ?? '–',
    dominant: r.dominantState ?? '–',
    dominant_share: round(r.dominantProportion),
    mean_spell: round(r.meanSpellDuration, 2),
    max_spell: r.maxSpellDuration,
    transition_rate: round(r.transitionRate),
    self_loop: round(r.selfLoopTendency),
    entropy: round(r.longitudinalEntropy),
    simpson: round(r.simpsonDiversity),
    complexity: round(r.complexityIndex),
  }));
  return { views, rows, positions: positionsInfo, error: null };
}

// ── 2 · network ────────────────────────────────────────────────────────────

/**
 * The transition network (ladyna `tna`, relative frequencies), its
 * centralities and its communities. Communities are computed by every method
 * for the table; the picture uses `community` (communities as plotMCML clusters).
 */
export function networkViews(sequences, {
  measures = CENTRALITY_MEASURES, community = 'walktrap', labels = null, colorMap = null,
} = {}) {
  const vNet = view('network-tna', 'Transition network', 'ladyna tna(sequences) (row-normalised transition probabilities) → plotNetwork.');
  const vCent = view('network-centralities', 'Centralities', `ladyna centralities(model) → plotCentralities (${measures.join(', ')}).`);
  const vComm = view(`network-communities-${community}`, 'Communities', `ladyna communities(model, { methods: ['${community}'] }) → plotMCML with each community as a cluster.`);
  const model = step(() => tna(usableSequences(sequences, labels).sequences));
  if (model.error) return { views: errorViews([vNet, vCent, vComm], model.error), centralities: [], communities: [], n_communities: null };
  const m = model.ok;
  const colors = colorMap ?? stateColourMap(m.labels);

  const views = [paint(vNet, () => plotNetwork(m, { colorMap: colors, title: 'Transition network' }))];

  const cent = step(() => centralities(m));
  let centRows = [];
  if (cent.error) views.push({ ...vCent, error: cent.error });
  else {
    views.push(paint(vCent, () => plotCentralities(cent.ok, { measures: [...measures], columns: Math.min(3, measures.length), colors: colorsFor(cent.ok.labels, colors) })));
    centRows = cent.ok.labels.map((state, i) => ({
      state,
      ...Object.fromEntries(Object.entries(cent.ok.measures).map(([k, vals]) => [k, round(vals[i])])),
    }));
  }

  // One method at a time: a method that throws (edge_betweenness on some
  // graphs) does not take the others with it.
  const byMethod = {};
  const nByMethod = {};
  const methodErrors = {};
  for (const method of COMMUNITY_METHODS) {
    const r = step(() => communities(m, { methods: [method] }));
    if (r.error) methodErrors[method] = r.error;
    else {
      byMethod[method] = r.ok.assignments[method];
      nByMethod[method] = r.ok.counts[method];
    }
  }
  const commRows = m.labels.map((state, i) => ({
    state,
    ...Object.fromEntries(COMMUNITY_METHODS.map((k) => [k, byMethod[k] ? byMethod[k][i] + 1 : '–'])),
  }));
  const chosen = byMethod[community];
  let nComm = null;
  if (!chosen) {
    views.push({ ...vComm, error: methodErrors[community] ?? { source: 'oyon', code: 'dynamics_bad_input', message: `unknown community method '${community}'` } });
  } else {
    nComm = nByMethod[community];
    const clusters = {};
    m.labels.forEach((state, i) => { (clusters[`C${chosen[i] + 1}`] ??= []).push(state); });
    views.push(nComm < 2
      ? { ...vComm, note: `${community} finds a single community: every state belongs to one group.` }
      : paint(vComm, () => plotMCML(m, { clusters, title: `Communities (${community})` })));
  }
  return { views, centralities: centRows, communities: commRows, n_communities: nComm, method_errors: methodErrors };
}

// ── 3 · reliability ────────────────────────────────────────────────────────

/**
 * How far the network can be trusted: bootstrap of the transitions (ladyna
 * `bootstrapTna`, R tna::bootstrap — edges whose weight is stable across
 * resamples) and case-dropping stability of the centralities (ladyna
 * `estimateCS`, the CS coefficient of Epskamp, Borsboom & Fried 2018), run
 * from three seeds so the spread of the CS coefficient is visible.
 */
export function reliabilityViews(sequences, { iter = 1000, cs_iter: csIter = 1000, seed = 42, labels = null, colorMap = null } = {}) {
  const vBs = view('reliability-bootstrap', 'Stable transitions',
    `ladyna bootstrapTna(model, { iter: ${iter}, seed: ${seed} }) → plotNetwork of the edges that stay within the stability range across resamples.`);
  const vCs = view('reliability-cs', 'Centrality stability (case-dropping)',
    `ladyna estimateCSAcrossSeeds(model, { iter: ${csIter}, seeds: [${seed}, ${seed + 1}, ${seed + 2}] }) → plotStability (first seed): correlation of centralities with the full-data values as sequences are dropped.`);
  const model = step(() => tna(usableSequences(sequences, labels).sequences));
  if (model.error) return { views: errorViews([vBs, vCs], model.error), edges: [], cs: [], counts: null };
  const m = model.ok;

  const views = [];
  let edges = [];
  let counts = null;
  const bs = step(() => bootstrapTna(m, { iter, seed }));
  if (bs.error) views.push({ ...vBs, error: bs.error });
  else {
    counts = { edges: bs.ok.nEdges, stable: bs.ok.nStable, iter, seed };
    views.push(counts.stable
      ? paint(vBs, () => plotNetwork(bs.ok.model, { colorMap: colorMap ?? stateColourMap(m.labels), title: 'Stable transitions' }))
      : { ...vBs, note: `None of the ${counts.edges} observed transitions is stable across ${iter} resamples.` });
    edges = bs.ok.edges
      .slice()
      .sort((a, b) => b.weight - a.weight || (a.from + a.to < b.from + b.to ? -1 : 1))
      .map((e) => ({
        from: e.from, to: e.to, weight: round(e.weight), ci_lower: round(e.ciLower), ci_upper: round(e.ciUpper),
        p: fmtP(e.pValue), stable: e.significant ? 'yes' : 'no',
      }));
  }

  const across = step(() => estimateCSAcrossSeeds(m, { iter: csIter, seeds: [seed, seed + 1, seed + 2] }));
  let cs = [];
  if (across.error) views.push({ ...vCs, error: across.error });
  else {
    views.push(paint(vCs, () => plotStability(across.ok.results[0], { title: 'Centrality stability' })));
    cs = across.ok.rows.map((r) => ({
      measure: r.measure, cs: round(r.cs, 2), cs_min: round(r.csMin, 2), cs_max: round(r.csMax, 2), seeds: r.seeds, reading: r.reading,
    }));
  }
  return { views, edges, cs, counts };
}

// ── 4 · lag-sequential ─────────────────────────────────────────────────────

/**
 * Lag-sequential analysis (ladyna `lsa`, Bakeman & Quera): each transition's
 * observed count against the count expected if the next state did not depend
 * on the current one; adjusted residuals and Yule's Q. ladyna's per-cell p is
 * unadjusted; the table adds `p_adj` over all cells (BH by default).
 */
export function lagViews(sequences, { lag = 1, alpha = 0.05, adjust = 'BH', labels = null } = {}) {
  const vHeat = view(`lag-heatmap-${lag}`, 'Adjusted residuals', `ladyna lsa(sequences, { lag: ${lag}, adjust: '${adjust}', alpha: ${alpha} }) → plotLSA(fit, 'heatmap').`);
  const vNet = view(`lag-network-${lag}`, 'Transitions above and below chance', `ladyna lsa(…) → plotLSA(fit, 'network').`);
  const vPolar = view(`lag-polar-${lag}`, 'Transition rose', `ladyna lsa(…) → plotPolar(fit, { style: 'rose', fill: 'prob', size: 'count' }): petal height = count, colour = probability.`);
  const fit = step(() => {
    const f = lsa(usableSequences(sequences, labels).sequences, { lag, adjust, alpha });
    if (f.kind !== 'lsa') throw new OyonViewError(`lsa returned '${f.kind}', expected one fit`, 'dynamics_bad_input');
    return f;
  });
  if (fit.error) return { views: errorViews([vHeat, vNet, vPolar], fit.error), rows: [], counts: null };
  const f = fit.ok;
  const views = [
    paint(vHeat, () => plotLSA(f, 'heatmap', { title: 'Adjusted residuals' })),
    paint(vNet, () => plotLSA(f, 'network', { title: 'Transitions above and below chance' })),
    paint(vPolar, () => plotPolar(f, { style: 'rose', fill: 'prob', size: 'count', labels: 'auto', title: 'Transition rose' })),
  ];
  // Table order only: strongest residual first. Every number is the fit's.
  const rows = f.edges
    .slice()
    .sort((a, b) => Math.abs(b.adjRes) - Math.abs(a.adjRes) || (a.from + a.to < b.from + b.to ? -1 : 1))
    .map((e) => ({
      from: e.from, to: e.to, count: e.count, expected: round(e.expected, 1), adj_res: round(e.adjRes, 2),
      yules_q: round(e.yulesQ), p: fmtP(e.p), p_adj: fmtP(e.pAdjusted),
      reading: e.significant ? (e.sign === 'over' ? 'above chance' : 'below chance') : 'as expected',
    }));
  const counts = { cells: f.summary.cells, above: f.summary.over, below: f.summary.under, lag, alpha: f.summary.alpha, adjust: f.summary.adjust };
  return { views, rows, counts };
}

// ── 5 · transfer entropy ───────────────────────────────────────────────────

/**
 * Transfer entropy between states (ladyna `transferEntropy`, Schreiber 2000):
 * how much being in state X now tells about entering state Y next, beyond Y's
 * own history, with a surrogate test (`iterations` shuffles). p is adjusted
 * over all pairs (BH by default); the picture keeps the pairs below `alpha`.
 * Slow (one surrogate set per ordered pair), so the page runs it on request.
 */
export function transferViews(sequences, {
  lag = 1, history = 1, iterations = 199, seed = 1, alpha = 0.05, adjust = 'BH', labels = null, colorMap = null,
} = {}) {
  const v = view(`transfer-${lag}-${history}`, 'Transfer entropy',
    `ladyna transferEntropy(sequences, null, { lag: ${lag}, history: ${history}, iterations: ${iterations}, seed: ${seed}, adjust: '${adjust}', alpha: ${alpha} }); the significant pairs, painted by ladyna plotNetwork (edge = TE in bits).`);
  const t0 = Date.now();
  const res = step(() => transferEntropy(usableSequences(sequences, labels).sequences, null, { lag, history, iterations, seed, adjust, alpha }));
  const elapsedMs = Date.now() - t0;
  if (res.error) return { views: [{ ...v, error: res.error }], rows: [], counts: null, elapsed_ms: elapsedMs };
  const rows = res.ok.map((r) => ({
    from: r.from, to: r.to, te: round(r.te, 4), te_effective: round(r.teEffective, 4), te_normalized: round(r.teNormalized),
    p: fmtP(r.p), p_adj: fmtP(r.pAdjusted), n: r.n, significant: r.significant ? 'yes' : 'no',
  }));
  const states = [...new Set(res.ok.flatMap((r) => [r.from, r.to]))].sort();
  const sig = res.ok.filter((r) => r.significant);
  const counts = { pairs: rows.length, significant: sig.length, iterations, lag, history, alpha, adjust };
  if (!sig.length) {
    return { views: [{ ...v, note: `No pair passes ${adjust}-adjusted p < ${alpha} with ${iterations} surrogates.` }], rows, counts, elapsed_ms: elapsedMs };
  }
  const W = states.map(() => states.map(() => 0));
  for (const r of sig) W[states.indexOf(r.from)][states.indexOf(r.to)] = r.te;
  const painted = paint(v, () => plotNetwork(matrixModel(states, W), {
    colorMap: colorMap ?? stateColors(sequences),
    title: 'Transfer entropy', initRing: false, decimals: 3,
  }));
  return { views: [painted], rows, counts, elapsed_ms: elapsedMs };
}

// ── 6 · clusters ───────────────────────────────────────────────────────────

/**
 * Groups of sequences that move alike. 'mmm': mixture Markov models (ladyna
 * `mmm`, EM from `n_starts` seeds) fitted for every k in `ks`, compared by
 * BIC / ICL; `k` picks the one drawn. 'pam': ladyna `clusterSequences` on a
 * string dissimilarity (PAM, silhouette). Each cluster's own transition
 * network (groupTna → plotNetworkGrid), mean times and index plot.
 */
export function clusterViews(sequences, {
  method = 'mmm', k = 2, ks = [2, 3, 4], dissimilarity = 'lcs', n_starts: nStarts = 10, seed = 42, labels = null, colorMap = null,
  positions = 'p75',
} = {}) {
  const vGrid = view(`clusters-${method}-${k}-networks`, 'Transition network per cluster', 'ladyna groupTna(sequences, cluster) → plotNetworkGrid (shared layout).');
  const vTimes = view(`clusters-${method}-${k}-meantimes`, 'Mean time in each state, by cluster', 'ladyna plotMeanTimes({ cluster: sequences }).');
  const input = step(() => {
    const u = usableSequences(sequences, labels);
    if (!Number.isInteger(k) || k < 2) throw new OyonViewError('`k` must be a whole number ≥ 2', 'dynamics_bad_input');
    if (u.sequences.length < 2 * k) {
      throw new OyonViewError(`${k} clusters need at least ${2 * k} sequences; there are ${u.sequences.length}`, 'dynamics_too_few_sequences');
    }
    return u;
  });
  if (input.error) return { views: errorViews([vGrid, vTimes], input.error), fits: [], assignments: [], sizes: [], chosen: null };
  const { sequences: seqs, labels: ids } = input.ok;

  let fits = [];
  let assign = null;
  let posterior = null;
  let fitSizes = null;
  let chosen = null;
  let fitError = null;
  if (method === 'mmm') {
    const usableKs = [...new Set([...ks, k])].filter((kk) => Number.isInteger(kk) && kk >= 2 && seqs.length >= 2 * kk).sort((a, b) => a - b);
    const results = usableKs.map((kk) => ({ kk, r: step(() => mmm(seqs, { k: kk, nStarts, seed })) }));
    fits = results.map(({ kk, r }) => (r.error
      ? { k: kk, log_lik: '–', aic: '–', bic: '–', icl: '–', converged: '–', avepp: '–', class_error: '–', starts_at_best: '–', error: r.error.message }
      : {
        k: kk,
        log_lik: round(r.ok.logLik, 1),
        aic: round(r.ok.aic, 1),
        bic: round(r.ok.bic, 1),
        icl: round(r.ok.icl, 1),
        converged: r.ok.converged ? 'yes' : 'no',
        avepp: round(r.ok.quality?.aveppOverall),
        class_error: round(r.ok.quality?.classificationError),
        // EM is local: how many of the starts reached the best log-likelihood (ladyna).
        starts_at_best: `${r.ok.startsAtBest}/${r.ok.nStarts}`,
        error: '',
      }));
    const mine = results.find((x) => x.kk === k)?.r;
    if (mine?.error) fitError = mine.error;
    else if (mine) {
      assign = Array.from(mine.ok.assignments);
      posterior = mine.ok.posterior;
      fitSizes = mine.ok.sizes;
      chosen = { starts_at_best: mine.ok.startsAtBest, n_starts: mine.ok.nStarts, converged: mine.ok.converged };
    }
  } else if (method === 'pam') {
    const usableKs = [...new Set([...ks, k])].filter((kk) => Number.isInteger(kk) && kk >= 2 && seqs.length >= 2 * kk).sort((a, b) => a - b);
    const results = usableKs.map((kk) => ({ kk, r: step(() => clusterSequences(seqs, kk, { dissimilarity })) }));
    fits = results.map(({ kk, r }) => (r.error
      ? { k: kk, silhouette: '–', sizes: '–', error: r.error.message }
      : { k: kk, silhouette: round(r.ok.silhouette), sizes: Array.from(r.ok.sizes).join(' / '), error: '' }));
    const mine = results.find((x) => x.kk === k)?.r;
    if (mine?.error) fitError = mine.error;
    else if (mine) {
      assign = Array.from(mine.ok.assignments);
      fitSizes = Array.from(mine.ok.sizes);
    }
  } else {
    fitError = { source: 'oyon', code: 'dynamics_bad_input', message: `unknown cluster method '${method}'` };
  }
  if (fitError || !assign) {
    const error = fitError ?? { source: 'oyon', code: 'dynamics_bad_input', message: 'no fit for this k' };
    return { views: errorViews([vGrid, vTimes], error), fits, assignments: [], sizes: [], chosen: null };
  }

  const names = assign.map((a) => `cluster ${a}`);
  const blocks = {};
  names.forEach((nm, i) => { (blocks[nm] ??= []).push(seqs[i]); });
  const order = Object.keys(blocks).sort((a, b) => Number(a.split(' ')[1]) - Number(b.split(' ')[1]));
  const sizes = fitSizes.map((n, c) => ({ cluster: `cluster ${c + 1}`, sequences: n }));
  const ordered = Object.fromEntries(order.map((nm) => [nm, blocks[nm]]));
  const label = method === 'mmm' ? `mixture Markov, k = ${k}` : `PAM on ${dissimilarity}, k = ${k}`;

  const views = [
    // groupTna orders groups by first appearance; hand it the sequences in cluster order so the panels read 1, 2, ….
    paint(vGrid, () => plotNetworkGrid(groupTna(order.flatMap((nm) => blocks[nm]), order.flatMap((nm) => blocks[nm].map(() => nm))), { colorMap: colorMap ?? stateColors(seqs), title: 'Transition network per cluster', subtitle: label, legend: true })),
    // Clusters coloured from Okabe–Ito (ladyna's default is Tableau), each named in the legend.
    paint(vTimes, () => plotMeanTimes(ordered, { colors: [...OKABE_ITO], title: 'Mean time in each state, by cluster', subtitle: label })),
  ];
  // The per-cluster index plots take the same positions cut as the Sequences
  // section (over all sequences, so every cluster shares one x range): one
  // long session would otherwise squeeze every other row to a sliver.
  const cut = POSITION_CUTS.find((c) => c.id === positions) ?? POSITION_CUTS[0];
  const index = step(() => plotSequenceIndex(ordered, { trim: cut.trim, colorMap: colorMap ?? stateColors(seqs), title: 'Sequences' }));
  for (const nm of order) {
    const vi = view(`clusters-${method}-${k}-index-${nm.replace(' ', '')}`, `Sequences in ${nm}`, 'ladyna plotSequenceIndex({ cluster: sequences }).');
    views.push(index.error ? { ...vi, error: index.error } : { ...vi, svg: index.ok[nm] ?? null });
  }
  const assignments = ids.map((id, i) => ({
    sequence: id, cluster: assign[i], ...(posterior ? { posterior: round(posterior[i]) } : {}),
  }));
  return { views, fits, assignments, sizes, chosen };
}
