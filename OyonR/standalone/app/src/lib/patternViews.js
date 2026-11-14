/*
 * Pattern views — the one pattern library both Patterns pages call
 * (/analyze/patterns-next on a person's sessions, /group/patterns on a
 * group's sequences). View-model layer, node-testable.
 *
 * Input is always plain state sequences, `(string|null)[][]`; the page decides
 * where they come from. Every number comes from ladyna and every picture is
 * the SVG a ladyna painter returns:
 *
 *   pathways     kgramPathways (ordered k-grams + HYPA) → plotPathwayChains,
 *                buildSimplicialKgrams → plotSimplicial (the set view)
 *   subpatterns  discoverPatterns → plotPatterns (short and long n-grams)
 *   memory       markovOrderTest → plotMarkovOrder
 *   trees        contextTree → plotTree, plotPathways, commonPathways
 *
 * Views follow lib/ladynaViews.js: `{ id, title, caption, svg, note, error,
 * file_name }`, plus `rows` (a tidy table) where a section has one.
 */
import {
  kgramPathways, plotPathwayChains, buildSimplicialKgrams, plotSimplicial,
  markovOrderTest, plotMarkovOrder,
} from 'ladyna/analysis';
import { discoverPatterns, plotPatterns, describeSequences, gapFreeRuns } from 'ladyna/sequences';
import { contextTree, plotTree, plotPathways, commonPathways } from 'ladyna/transitiontrees';
import { stateColourMap } from './stateColours.js';
import { OyonViewError, errorOf, paint, step, view } from './ladynaViews.js';

export const PATTERN_SECTIONS = Object.freeze([
  { id: 'pathways', label: 'Pathways' },
  { id: 'subpatterns', label: 'Sub-patterns' },
  { id: 'memory', label: 'Memory' },
  { id: 'trees', label: 'Trees' },
]);

/** Pathway lengths (states) pooled by default: 3 and 4. */
export const DEFAULT_ORDERS = Object.freeze([3, 4]);

/**
 * Count of usable states and sequences, for the page's header line and for
 * the gate: the sections need at least one sequence with two states.
 */
export function sequenceSummary(sequences) {
  if (!Array.isArray(sequences)) throw new OyonViewError('`sequences` must be an array of state sequences', 'patterns_bad_input');
  // ladyna describeSequences; a non-array entry is no sequence.
  const d = describeSequences(sequences.map((seq) => (Array.isArray(seq) ? seq : [])));
  return {
    n_sequences: sequences.length, n_usable: d.nUsable, n_states: d.nStates, alphabet: d.alphabet,
    mean_length: d.meanLength, n_transitions: d.nTransitions, state_entropy: d.stateEntropy,
  };
}

/**
 * One colour per state for every figure on a page — and across pages: the
 * app-wide map (lib/stateColours.js: fixed emotion colours, the Okabe–Ito
 * low/mid/high ramp, ladyna createColorMap for any other states).
 */
export function stateColors(sequences) {
  return stateColourMap(sequenceSummary(sequences).alphabet);
}

function requireSequences(sequences) {
  const sum = sequenceSummary(sequences);
  if (!sum.n_usable) throw new OyonViewError('no sequence has two or more states', 'patterns_empty');
  return sum;
}

/*
 * Gaps: a null (or empty) state is a bin with no reading, so no transition
 * crosses it. The Memory and Trees sections, whose ladyna methods would
 * otherwise drop the null and join B to C across the gap, get ladyna's
 * gapFreeRuns(sequences) — the same cut kgramPathways makes with
 * `gaps: 'split'`. Re-exported for the panels and tests.
 */
export { gapFreeRuns };

function fmtP(p) {
  if (p === null || !Number.isFinite(p)) return '–';
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}

// ── pathways ────────────────────────────────────────────────────────────────

/**
 * Ordered pathways with HYPA (over/under-represented against a first-order
 * null), and the same pathways as a simplicial (set) view.
 *
 * `gaps` defaults to 'split': a missing bin ends a pathway, which is right for
 * time-binned states and makes each count equal HYPA's observed count.
 *
 * @returns {{ views: object[], rows: object[], counts: {over, under, normal, tested}, alphabet: string[] }}
 */
export function pathwayViews(sequences, {
  orders = DEFAULT_ORDERS, min_count: minCount = 2, max_pathways: maxPathways = 12,
  alpha = 0.05, adjust = 'BH', gaps = 'split', anomaly = 'all', colorMap = null,
} = {}) {
  const hypa = { alpha, pAdjustMethod: adjust };
  const call = `kgramPathways(sequences, { orders: [${orders.join(', ')}], minCount: ${minCount}, hypa: { alpha: ${alpha}, pAdjustMethod: '${adjust}' }, gaps: '${gaps}', sort: 'p' })`;
  const v = view('pathways-chains', 'Ordered pathways',
    `${call} → ladyna plotPathwayChains: one row per pathway, states in order; n, HYPA expected count, observed / expected on a log2 scale, BH-adjusted p.`);

  const all = step(() => {
    requireSequences(sequences);
    return kgramPathways(sequences, { orders, minCount, hypa, gaps, sort: 'p' });
  });
  if (all.error) return { views: [{ ...v, error: all.error }], rows: [], counts: null, alphabet: [] };

  // Counts over every pathway: ladyna's summary (taken before any filtering).
  const sm = all.ok.summary;
  const counts = { over: sm.over, under: sm.under, normal: sm.normal, too_few: sm.untestable, tested: sm.tested, pathways: sm.pathways };
  // Which rows to show: the class picked (by ladyna's own label), strongest first, capped.
  const chosen = anomaly === 'all' ? all.ok.rows : all.ok.rows.filter((r) => r.anomaly === anomaly);
  const rows = chosen.slice(0, maxPathways).map((r, i) => ({ ...r, rank: i + 1 }));
  const alphabet = all.ok.alphabet;

  // ladyna writes the title and subtitle from the summary.
  const chains = rows.length
    ? paint(v, () => plotPathwayChains(rows, { summary: sm, layoutStates: alphabet, ...(colorMap ? { colorMap } : {}) }))
    : { ...v, note: anomaly === 'all' ? 'No pathway reached the minimum count.' : `No pathway occurs ${anomaly === 'over' ? 'more' : 'less'} often than expected at α = ${alpha}.` };
  const v2 = view('pathways-simplicial', 'Simplicial view',
    'buildSimplicialKgrams(…same options) → ladyna plotSimplicial (dismantled, by rank). Set-based: pathways over the same states share one blob, so their order is not shown.');
  const simplicial = rows.length
    ? paint(v2, () => plotSimplicial(
      buildSimplicialKgrams(sequences, { orders, minCount, hypa, gaps, sort: 'p', anomaly, maxPathways }),
      { mode: 'dismantled', sort: 'rank', layoutStates: alphabet },
    ))
    : { ...v2, note: chains.note };
  return { views: [chains, simplicial], rows, counts, alphabet };
}

/**
 * One plain reading of the HYPA counts. It never affirms the null: no
 * detected deviation is "no evidence of longer memory", and pathways too rare
 * to test are said to be untested, not memoryless.
 */
export function hypaReading(counts, { alpha = 0.05 } = {}) {
  if (!counts) return '';
  const tooFew = counts.too_few ?? 0;
  const rare = tooFew ? ` ${tooFew} pathway${tooFew === 1 ? ' is' : 's are'} too rare to test.` : '';
  if (!counts.tested) {
    return `No pathway is common enough to test, so nothing can be said here about memory beyond the current state.${rare}`;
  }
  const lead = `Of ${counts.tested} pathway${counts.tested === 1 ? '' : 's'} tested, ${counts.over} occur${counts.over === 1 ? 's' : ''} more often and ${counts.under} less often than a first-order (memoryless) model expects, BH-adjusted at α = ${alpha}.${rare}`;
  if (counts.over + counts.under === 0) {
    return `${lead} No tested pathway differs from that model: no evidence of memory beyond the current state, which is not evidence that there is none.`;
  }
  return lead;
}

/** One plain sentence on the Markov-order evidence; says so when the criteria disagree. Never affirms order 1. */
export function memoryReading(m) {
  const base = `The sequential permutation test selects order ${m.optimal}; BIC prefers ${m.bic}, AIC ${m.aic} (${m.n_observations} states in ${m.n_sequences} sequence${m.n_sequences === 1 ? '' : 's'}).`;
  if (m.optimal <= 1 && m.bic <= 1) return `${base} No evidence that states before the current one shape the next; with few transitions such a test has little power.`;
  if (m.optimal > 1 && m.bic > 1) return `${base} The state before the current one also shapes what comes next; the Pathways and Trees show which paths carry it.`;
  return `${base} The criteria disagree, so the evidence for memory beyond the current state is mixed.`;
}

/** The pathway rows as a display table (strings), one row per pathway. */
export function pathwayTable(rows) {
  return rows.map((r) => ({
    rank: r.rank,
    path: r.path,
    count: r.count,
    expected: r.expected === null ? '–' : r.expected.toFixed(1),
    ratio: r.ratio === null ? '–' : r.ratio.toFixed(2),
    p_adj: fmtP(r.pAdjusted),
    anomaly: r.anomaly === null ? '–' : r.testable === false ? 'too few to test' : r.anomaly,
  }));
}

// ── sub-patterns ────────────────────────────────────────────────────────────

/**
 * Frequent n-grams: short (2–3 states) and long (4–6), each ranked by support
 * (the share of sequences containing it) → plotPatterns.
 */
export function subPatternViews(sequences, {
  short = [2, 3], long = [4, 5, 6], min_freq: minFreq = 2, min_support: minSupport = 0.05, top = 15,
} = {}) {
  const ok = step(() => requireSequences(sequences));
  const make = (id, title, len) => {
    const v = view(id, title,
      `discoverPatterns(sequences, { type: 'ngram', len: [${len.join(', ')}], minFreq: ${minFreq}, minSupport: ${minSupport} }) → ladyna plotPatterns (top ${top}).`);
    if (ok.error) return { view: { ...v, error: ok.error }, rows: [] };
    let result;
    try {
      result = discoverPatterns(sequences, { type: 'ngram', len, minFreq, minSupport });
    } catch (err) {
      return { view: { ...v, error: errorOf(err) }, rows: [] };
    }
    const rows = result.patterns.slice(0, top).map((p) => ({
      pattern: p.pattern.replaceAll('->', ' → '),
      length: p.length,
      frequency: p.frequency,
      support: Number(p.support.toFixed(3)),
      lift: Number(p.lift.toFixed(2)),
    }));
    if (!result.patterns.length) return { view: { ...v, note: `No ${len.join('–')}-state pattern reached frequency ${minFreq} and support ${minSupport}.` }, rows };
    return { view: paint(v, () => plotPatterns(result, { top, title })), rows };
  };
  const s = make('subpatterns-short', 'Short patterns (2–3 states)', short);
  const l = make('subpatterns-long', 'Long patterns (4–6 states)', long);
  return { views: [s.view, l.view], tables: { short: s.rows, long: l.rows } };
}

// ── memory (Markov order) ───────────────────────────────────────────────────

/**
 * Does the next state depend on more than the current one? markovOrderTest
 * (sequential likelihood-ratio tests, permutation p) → plotMarkovOrder.
 */
export function memoryViews(sequences, { max_order: maxOrder = 3, n_perm: nPerm = 500, seed = 1 } = {}) {
  const v = view('memory-order', 'Markov order',
    `markovOrderTest(gap-free runs, { maxOrder: ${maxOrder}, nPerm: ${nPerm}, seed: ${seed} }) → ladyna plotMarkovOrder. Order 1 = only the current state matters; higher = the path before it carries information.`);
  const res = step(() => {
    requireSequences(sequences);
    const runs = gapFreeRuns(sequences);
    if (!runs.some((r) => r.length >= 2)) throw new OyonViewError('no run of two or more states without a gap', 'patterns_empty');
    return markovOrderTest(runs, { maxOrder, nPerm, seed });
  });
  if (res.error) return { views: [{ ...v, error: res.error }], rows: [], summary: null };
  const r = res.ok;
  const rows = r.testTable.map((t) => ({
    order: t.order,
    loglik: Number(t.loglik.toFixed(1)),
    AIC: Number(t.AIC.toFixed(1)),
    BIC: Number(t.BIC.toFixed(1)),
    df: Number.isFinite(t.df) ? t.df : '–',
    G2: Number.isFinite(t.g2) ? Number(t.g2.toFixed(2)) : '–',
    p_perm: fmtP(Number.isFinite(t.pPermutation) ? t.pPermutation : null),
    significant: t.order === 0 ? '–' : t.significant ? 'yes' : 'no',
  }));
  const summary = { optimal: r.optimalOrder, bic: r.bicOrder, aic: r.aicOrder, n_sequences: r.nSequences, n_observations: r.nObservations };
  return { views: [paint(v, () => plotMarkovOrder(r, { type: 'both' }))], rows, summary };
}

// ── trees ───────────────────────────────────────────────────────────────────

/**
 * Transition (context) tree: which preceding paths change what comes next →
 * plotTree, plotPathways, and the most common pathways as a table.
 */
export function treeViews(sequences, { max_depth: maxDepth = 3, min_count: minCount = 3, max_nodes: maxNodes = 40, top = 15, colorMap = null } = {}) {
  const call = `contextTree(gap-free runs, { maxDepth: ${maxDepth}, minCount: ${minCount} })`;
  const v1 = view('trees-tree', 'Transition tree', `${call} → ladyna plotTree (${maxNodes} nodes at most).`);
  const v2 = view('trees-pathways', 'Pathways', `The same tree → ladyna plotPathways (top ${top} by count).`);
  const tree = step(() => {
    requireSequences(sequences);
    return contextTree(gapFreeRuns(sequences), { maxDepth, minCount });
  });
  if (tree.error) return { views: [{ ...v1, error: tree.error }, { ...v2, error: tree.error }], rows: [] };
  const rows = commonPathways(tree.ok, { top: top + 1 })
    .filter((p) => p.depth > 0)
    .slice(0, top)
    .map((p) => ({
      pathway: p.pathway.replaceAll('->', '→'),
      depth: p.depth,
      count: p.count,
      likely_next: p.likelyNext,
      p_next: Number(p.nextProbability.toFixed(2)),
      divergence: Number.isFinite(p.divergence) ? Number(p.divergence.toFixed(3)) : '–',
    }));
  return {
    views: [
      paint(v1, () => plotTree(tree.ok, { style: 'horizontal', maxNodes, colorMap: colorMap ?? stateColors(sequences) })),
      paint(v2, () => plotPathways(tree.ok, { top, sortBy: 'count', colorMap: colorMap ?? stateColors(sequences) })),
    ],
    rows,
  };
}
