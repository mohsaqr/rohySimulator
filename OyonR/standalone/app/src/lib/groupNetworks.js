/*
 * Group networks — the dashboard's Networks section (view-model layer, node-testable).
 *
 * Rule: NO analysis code and NO hand-drawn networks. Every model comes from
 * ladyna (`codeStates`, `toCoOccurrence`, `ctna`, `toSequences`, `groupTna`,
 * `interactionSequence`, `htna`, `buildMCML`) or psychaj (via
 * `groupVarFit.js`); every picture is the SVG string a ladyna painter returns
 * (`plotNetwork`, `plotNetworkGrid`, `plotDifferenceNetwork`, `plotMCML`,
 * `plotHTNA`). This module chooses inputs, calls them, and labels the result.
 * The only glue is `matrixModel()`: a psychaj matrix wrapped with ladyna's
 * `createTNA` so ladyna's painter can draw it — no statistics.
 *
 * Every view is `{ id, title, caption, svg, note, error, file_name }`. A
 * ladyna/psychaj throw becomes that view's `error` ({ source, code, message })
 * — never swallowed, never fatal to the other views.
 */
import { codeStates, toCoOccurrence, interactionSequence, toSequences } from 'ladyna/synchrony';
import {
  ctna, groupTna, plotNetwork, plotNetworkGrid, plotDifferenceNetwork,
} from 'ladyna/core';
import { htna, plotHTNA, plotMCML } from 'ladyna/htna';
import { buildMCML, bootstrapTna, bootstrapPairs, cooccur, plotCooccurrence } from 'ladyna/analysis';
import { plotSequenceIndex, plotStateDistribution } from 'ladyna/sequences';
import { channelsInTimeline, filterSpan } from './groupDashboard.js';
import { stateColourMap } from './stateColours.js';
import { OyonViewError, matrixModel, paint, step, view } from './ladynaViews.js';

/** Bin for co-occurrence and per-member state networks (s). */
export const NETWORK_BIN_S = 5;
/** Bin and time gate for the interaction network (s); bins must be ≤ τ. */
export const INTERACTION_BIN_S = 1;
export const INTERACTION_TAU_S = 3;
/** Edges with |weight| ≤ this are hidden in the VAR pictures (visual only; the matrices are untouched). */
export const VAR_CUTOFF = 0.03;

export const NETWORK_TABS = Object.freeze([
  { id: 'sequences', label: 'Sequences' },
  { id: 'cooccurrence', label: 'Co-occurrence' },
  { id: 'var', label: 'Temporal & contemporaneous' },
  { id: 'member', label: 'Per-member' },
  { id: 'interaction', label: 'Interaction' },
]);

/** Continuous channels preferred as the VAR default, in order. */
const VAR_PREFERRED = ['arousal', 'valence'];

/** Classed error for inputs the Networks section cannot use; `code` is the contract. */
export class GroupNetworkError extends OyonViewError {
  constructor(message, code = 'group_networks_bad_input') {
    super(message, code);
    this.name = 'GroupNetworkError';
  }
}

// ── input ──────────────────────────────────────────────────────────────────

/**
 * The rows a network view works on: the selected group's long table, or every
 * group's (scope 'all'), cut to the brushed span.
 *
 * @param {Record<string, object[]>} timelines one long table per group (buildTimelines().timelines)
 * @param {{ group_id?: string|null, scope?: 'group'|'all', span?: {start_s, end_s}|null }} opts
 * @throws GroupNetworkError `group_networks_bad_input`, `group_networks_unknown_group`, `group_networks_empty`
 */
export function networkRows(timelines, { group_id: groupId = null, scope = 'group', span = null } = {}) {
  if (timelines === null || typeof timelines !== 'object' || Array.isArray(timelines)) {
    throw new GroupNetworkError('`timelines` must map group ids to long tables');
  }
  if (scope !== 'group' && scope !== 'all') throw new GroupNetworkError("`scope` must be 'group' or 'all'");
  let rows;
  if (scope === 'all') {
    rows = Object.keys(timelines).sort().flatMap((g) => timelines[g] ?? []);
  } else {
    if (!groupId || !Array.isArray(timelines[groupId])) {
      throw new GroupNetworkError(`group '${String(groupId)}' is not loaded`, 'group_networks_unknown_group');
    }
    rows = timelines[groupId];
  }
  const cut = filterSpan(rows, span ?? {});
  if (!cut.length) throw new GroupNetworkError('no rows in the selected span', 'group_networks_empty');
  return cut;
}

/**
 * Channels the network views can use: `state` (continuous → low/mid/high by
 * ladyna's per-person terciles, and categorical channels such as emotion and
 * gaze AOIs) and `continuous` (the VAR candidates, preferred defaults first).
 */
export function networkChannels(rows) {
  const all = channelsInTimeline(rows).filter((c) => c.n_valid > 0);
  const state = all
    .filter((c) => c.channel !== 'emotion.confidence')
    .map((c) => ({
      channel: c.channel,
      kind: c.kind,
      label: `${c.channel} · ${c.kind === 'continuous' ? 'low/mid/high' : 'states'}`,
    }));
  const continuous = all
    .filter((c) => c.kind === 'continuous')
    .map((c) => c.channel)
    .sort((a, b) => {
      const ia = VAR_PREFERRED.indexOf(a); const ib = VAR_PREFERRED.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  return { state, continuous, default_var: continuous.slice(0, 2) };
}

/** member → its `member:state` labels in `labels` (from the coded rows, so ids with ':' stay unambiguous). */
function memberClusters(codedOrEvents, labels, tokenOf) {
  const present = new Set(labels);
  const clusters = {};
  for (const r of codedOrEvents) {
    const t = tokenOf(r);
    if (t === null || !present.has(t)) continue;
    const list = (clusters[r.member_id] ??= []);
    if (!list.includes(t)) list.push(t);
  }
  return Object.fromEntries(Object.keys(clusters).sort().map((m) => [m, clusters[m].sort()]));
}

const NA = new Set(['n/a']);

/** One colour per member (Okabe-Ito), shared by all of that member's state nodes. */
const MEMBER_COLOURS = ['#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#0072B2', '#D55E00', '#F0E442', '#999999'];
/** Ordinal states first in their natural order; anything else after, alphabetically. */
const STATE_RANK = ['low', 'mid', 'high', 'uncertain'];

function stateRank(state) {
  const i = STATE_RANK.indexOf(state);
  return i < 0 ? STATE_RANK.length : i;
}

/**
 * Co-occurrence is symmetric: draw it undirected, one line per pair, nodes
 * ordered member by member (states low → mid → high) and coloured by member,
 * whole-number counts, no initial-state rings. Pure presentation of the
 * ladyna model's weights — the matrix is only reordered and halved for the
 * painter (`plotNetwork` has no undirected mode).
 */
function undirectedCooccurrence(model, { keepDiagonal }) {
  const labels = model.labels;
  const parsed = labels.map((lab, i) => {
    const k = lab.indexOf(':');
    return k < 0 ? { i, lab, member: '', state: lab } : { i, lab, member: lab.slice(0, k), state: lab.slice(k + 1) };
  });
  parsed.sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : 0)
    || stateRank(a.state) - stateRank(b.state) || (a.state < b.state ? -1 : a.state > b.state ? 1 : 0));
  const order = parsed.map((p) => p.i);
  const W = order.map((i, a) => order.map((j, b) => (b > a || (keepDiagonal && a === b) ? model.weights.get(i, j) : 0)));
  const members = [...new Set(parsed.map((p) => p.member))];
  const colorMap = Object.fromEntries(parsed.map((p) => [p.lab, MEMBER_COLOURS[members.indexOf(p.member) % MEMBER_COLOURS.length]]));
  return { model: matrixModel(parsed.map((p) => p.lab), W), colorMap };
}

const COOC_STYLE = { arrows: false, curvature: 0, decimals: 0, initRing: false };

// ── 0 · sequences ───────────────────────────────────────────────────────────

// State colours: the app-wide map (lib/stateColours.js) — fixed emotion colours,
// the Okabe–Ito low/mid/high ramp, ladyna's palette for anything else.

/**
 * Emotion labels by valence family, for grouping them on the co-occurrence
 * circle (the families the Affect tab's map uses). A label, not a statistic.
 */
const EMOTION_FAMILY = Object.freeze({
  happy: 'positive', surprise: 'positive', neutral: 'neutral',
  sad: 'negative', anger: 'negative', fear: 'negative', disgust: 'negative', contempt: 'negative',
});
const EMOTION_FAMILY_ORDER = Object.freeze(['positive', 'neutral', 'negative']);

/**
 * State sequences, one row per member: `codeStates` → `toSequences(by group ×
 * member, aligned on the group clock)` → ladyna `plotSequenceIndex` with the
 * member as each row's label, and the state distribution over time
 * (`plotStateDistribution`, TraMineR seqdplot). Missing bins stay grey.
 */
export function sequenceViews(rows, { channel, bin_s: binS = NETWORK_BIN_S } = {}) {
  const v1 = view(`sequences-index-${channel}`, 'Member state sequences',
    `codeStates(rows, { bin_s: ${binS}, channels: ['${channel}'] }) → toSequences(…, { by: ['group_id', 'member_id'], align: true }) → ladyna plotSequenceIndex, one row per member.`);
  const v2 = view(`sequences-distribution-${channel}`, 'State distribution over time',
    'The same sequences → ladyna plotStateDistribution: the share of members in each state per bin.');
  const seq = step(() => {
    const coded = codeStates(rows, { bin_s: binS, channels: [channel] });
    return toSequences(coded, { by: ['group_id', 'member_id'], channel, align: true });
  });
  if (seq.error) return [v1, v2].map((v) => ({ ...v, error: seq.error }));
  const groups = new Set(seq.ok.ids.map((id) => id.split('/')[0]));
  // One group: label rows by member; several: group/member.
  const rowLabels = groups.size === 1 ? seq.ok.ids.map((id) => id.split('/').slice(1).join('/')) : seq.ok.ids;
  const states = new Set(seq.ok.sequences.flat().filter((s) => s != null));
  const colorMap = stateColourMap([...states]);
  const xLabel = `bin (${binS} s)`;
  return [
    paint(v1, () => plotSequenceIndex(seq.ok.sequences, {
      rowLabels, xLabel, yLabel: groups.size === 1 ? 'member' : 'group / member', colorMap,
      rowHeight: 22, title: `${channel} state sequences`, subtitle: 'grey = no valid data',
    })),
    paint(v2, () => plotStateDistribution(seq.ok.sequences, { colorMap, title: `${channel} state distribution`, subtitle: 'share of members per bin' })),
  ];
}

// ── 1 · co-occurrence ───────────────────────────────────────────────────────

/**
 * Co-occurrence networks on one coded channel (bins of `bin_s`):
 * member:state co-occurrence (`ctna` → `plotNetwork`), the same model with
 * members as clusters (`plotMCML`), and state co-occurrence across members.
 */
export function cooccurrenceNetworks(rows, { channel, bin_s: binS = NETWORK_BIN_S } = {}) {
  const sub = `${channel}, held in the same ${binS} s bin`;
  const call = `codeStates(rows, { bin_s: ${binS}, channels: ['${channel}'] }) → toCoOccurrence`;
  const v1 = view(`cooccurrence-member-${channel}`, 'Member × state co-occurrence',
    `ctna model of ${call}(…, { label: 'member' }).sequences, painted by ladyna plotNetwork.`);
  const v2 = view(`cooccurrence-mcml-${channel}`, 'Co-occurrence, members as clusters',
    'The same ctna model, painted by ladyna plotMCML with clusters = each member\'s member:state nodes.');
  const v3 = view(`cooccurrence-state-${channel}`, 'State co-occurrence across members',
    `ctna model of ${call}(…, { label: 'state' }).sequences, painted by ladyna plotNetwork.`);

  const coded = step(() => codeStates(rows, { bin_s: binS, channels: [channel] }));
  if (coded.error) return [v1, v2, v3].map((v) => ({ ...v, error: coded.error }));
  const member = step(() => ctna(toCoOccurrence(coded.ok, { channel, label: 'member' }).sequences));
  const state = step(() => ctna(toCoOccurrence(coded.ok, { channel, label: 'state' }).sequences));

  const out = [];
  if (member.error) out.push({ ...v1, error: member.error }, { ...v2, error: member.error });
  else {
    out.push(paint(v1, () => {
      const u = undirectedCooccurrence(member.ok, { keepDiagonal: false });
      return plotNetwork(u.model, { ...COOC_STYLE, colorMap: u.colorMap, showSelfLoops: false, title: 'Member × state co-occurrence', subtitle: `${sub} · observed bins` });
    }));
    const clusters = memberClusters(coded.ok.filter((r) => r.channel === channel), member.ok.labels,
      (r) => (r.state == null || NA.has(r.state) ? null : `${r.member_id}:${r.state}`));
    out.push(paint(v2, () => plotMCML(member.ok, { clusters, title: 'Co-occurrence — members as clusters', subtitle: sub })));
  }
  out.push(state.error ? { ...v3, error: state.error }
    : paint(v3, () => {
      // Diagonal kept: "two members both high" is the high–high self-loop.
      const u = undirectedCooccurrence(state.ok, { keepDiagonal: true });
      return plotNetwork(u.model, { ...COOC_STYLE, colorMap: stateColourMap(u.model.labels), showSelfLoops: true, title: 'State co-occurrence across members', subtitle: `which ${channel} states the members hold together · observed bins` });
    }));

  // Categorical channels (emotion, AOI): which states two members hold in the
  // same bin more or less often than chance — each bin a site (ladyna cooccur,
  // Veech 2013 / R cooccur, BH over the pairs), drawn bundled by family.
  const kind = channelsInTimeline(rows).find((c) => c.channel === channel)?.kind;
  if (kind === 'categorical') {
    const v4 = view(`cooccurrence-bundled-${channel}`, `${channel === 'emotion' ? 'Emotion' : 'State'} co-occurrence against chance`,
      `${call}(…, { label: 'state' }).sequences, one site per bin → ladyna cooccur(sites, { adjust: 'BH' }) (Veech 2013; R cooccur) → plotCooccurrence.`);
    const sites = step(() => toCoOccurrence(coded.ok, { channel, label: 'state' }).sequences);
    const fit = sites.error ? sites : step(() => cooccur(sites.ok, { adjust: 'BH' }));
    out.push(fit.error ? { ...v4, error: fit.error }
      : paint(v4, () => plotCooccurrence(fit.ok, {
        colorMap: stateColourMap(fit.ok.species),
        ...(channel === 'emotion'
          ? { groups: EMOTION_FAMILY, groupOrder: EMOTION_FAMILY_ORDER, title: 'Emotion co-occurrence' }
          : { title: `${channel} co-occurrence` }),
      })));
  }
  return out;
}

/**
 * Bootstrap the member × state co-occurrence network with ladyna
 * `bootstrapTna` (R `tna::bootstrap`): resamples the co-occurrence bins and
 * keeps the edges whose weight is stable across resamples (default
 * 'stability' method: within ±25 % of the observed weight). This says which
 * edges are reliable — not that they exceed chance.
 *
 * @returns {{ view: object, edges: Array<{ pair, a, b, weight, ci_lower, ci_upper, p, significant }>, iter: number, seed: number, n_bins: number, n_significant: number, n_pairs: number, error: object|null }}
 */
export function bootstrapCooccurrence(rows, { channel, bin_s: binS = NETWORK_BIN_S, iter = 1000, seed = 42 } = {}) {
  const v = view(`cooccurrence-bootstrap-${channel}`, 'Member × state co-occurrence — stable edges',
    `ladyna bootstrapTna(ctna model, { iter: ${iter}, seed: ${seed} }) on the co-occurrence bins; drawn: edges significant under the stability rule (weight within ±25 % across resamples). Reliable edges, not a test against chance.`);
  const co = step(() => toCoOccurrence(codeStates(rows, { bin_s: binS, channels: [channel] }), { channel, label: 'member' }));
  const model = co.error ? co : step(() => ctna(co.ok.sequences));
  const nBins = co.ok ? co.ok.sequences.length : 0;
  if (model.error) return { view: { ...v, error: model.error }, edges: [], iter, seed, n_bins: nBins, n_significant: 0, n_pairs: 0, error: model.error };
  const bs = step(() => bootstrapTna(model.ok, { iter, seed }));
  if (bs.error) return { view: { ...v, error: bs.error }, edges: [], iter, seed, n_bins: nBins, n_significant: 0, n_pairs: 0, error: bs.error };
  // Symmetric model: report each unordered pair once.
  // One row per unordered member-state pair, strongest first, with the counts: ladyna bootstrapPairs.
  const read = step(() => bootstrapPairs(bs.ok));
  if (read.error) return { view: { ...v, error: read.error }, edges: [], iter, seed, n_bins: nBins, n_significant: 0, n_pairs: 0, error: read.error };
  const edges = read.ok.pairs.map((e) => ({ pair: e.pair, a: e.a, b: e.b, weight: e.weight, ci_lower: e.ciLower, ci_upper: e.ciUpper, p: e.pValue, significant: e.significant }));
  const painted = paint(v, () => {
    const u = undirectedCooccurrence(bs.ok.model, { keepDiagonal: false });
    return plotNetwork(u.model, { ...COOC_STYLE, colorMap: u.colorMap, showSelfLoops: false, title: 'Stable co-occurrence edges', subtitle: `${channel} · bootstrap ${iter} resamples, seed ${seed}` });
  });
  return { view: painted, edges, iter, seed, n_bins: nBins, n_significant: read.ok.nStable, n_pairs: read.ok.nPairs, error: null };
}

// ── 3 · per-member ──────────────────────────────────────────────────────────

/**
 * Each member's own state TNA (`toSequences` → `groupTna` → `plotNetworkGrid`)
 * and the difference network of two members (`plotDifferenceNetwork`).
 *
 * @returns {{ members: string[], member_a: string|null, member_b: string|null, views: object[] }}
 */
export function memberNetworks(rows, {
  channel, bin_s: binS = NETWORK_BIN_S, member_a: memberA = null, member_b: memberB = null,
} = {}) {
  const model = step(() => {
    const coded = codeStates(rows, { bin_s: binS, channels: [channel] });
    const seq = toSequences(coded, { by: ['group_id', 'member_id'], group: 'member_id', channel });
    return groupTna(seq.sequences, seq.groups);
  });
  const members = model.ok ? Object.keys(model.ok.models) : [];
  const a = memberA && members.includes(memberA) ? memberA : members[0] ?? null;
  const b = memberB && members.includes(memberB) && memberB !== a ? memberB : members.find((m) => m !== a) ?? null;
  const call = `codeStates(rows, { bin_s: ${binS} }) → toSequences(…, { by: ['group_id','member_id'], group: 'member_id', channel: '${channel}' }) → groupTna`;

  const grid = view(`members-grid-${channel}`, 'Per-member transition networks',
    `${call}, painted by ladyna plotNetworkGrid (shared layout and colours).`);
  const diff = view(`members-diff-${channel}-${a ?? 'a'}-${b ?? 'b'}`, `Difference ${a ?? '–'} − ${b ?? '–'}`,
    `ladyna plotDifferenceNetwork(groupTna, '${a ?? '–'}', '${b ?? '–'}'): positive edges = ${a ?? 'A'} transitions more often.`);
  const views = [];
  if (model.error) {
    views.push({ ...grid, error: model.error }, { ...diff, error: model.error });
  } else {
    const stateLabels = Object.values(model.ok.models)[0]?.labels ?? [];
    views.push(paint(grid, () => plotNetworkGrid(model.ok, {
      colorMap: stateColourMap(stateLabels),
      title: `Per-member ${channel} transition networks`, subtitle: `${binS} s bins`, legend: true,
    })));
    views.push(a && b
      ? paint(diff, () => plotDifferenceNetwork(model.ok, a, b, { title: `${channel}: ${a} − ${b}` }))
      : { ...diff, note: 'A difference network needs two members with a sequence in this span.' });
  }
  return { members, member_a: a, member_b: b, views };
}

// ── 4 · interaction ─────────────────────────────────────────────────────────

/**
 * Interaction networks: members' state changes interleaved on the group
 * clock (`interactionSequence`, roles 'member', τ-gated), one sequence per
 * group → `htna` (members as actors) → `plotHTNA`, and `buildMCML` → `plotMCML`.
 */
export function interactionNetworks(rows, {
  channel, bin_s: binS = INTERACTION_BIN_S, tau_s: tauS = INTERACTION_TAU_S,
} = {}) {
  const prep = step(() => {
    const coded = codeStates(rows, { bin_s: binS, channels: [channel] });
    const events = interactionSequence(coded, { channel, tau_s: tauS, roles: 'member' });
    if (!events.length) {
      throw new GroupNetworkError(`no ${channel} state changes in this span`, 'group_networks_no_events');
    }
    const sequences = toSequences(events, { by: 'group_id', state: 'token', order: 't_s' }).sequences;
    const present = new Set(sequences.flat().filter((t) => t !== null));
    const nodeGroups = memberClusters(events, [...present], (r) => r.token);
    return { sequences, nodeGroups, actorLevels: Object.keys(nodeGroups) };
  });
  const sub = `${channel} state changes, ${binS} s bins, τ = ${tauS} s`;
  const call = `codeStates(rows, { bin_s: ${binS} }) → interactionSequence(…, { roles: 'member', tau_s: ${tauS} }) → toSequences(…, { by: 'group_id', state: 'token', order: 't_s' })`;
  const v1 = view(`interaction-htna-${channel}`, 'Interaction network — members as actors',
    `${call} → htna(…, { nodeGroups: member → its tokens }), painted by ladyna plotHTNA.`);
  const v2 = view(`interaction-mcml-${channel}`, 'Interaction MCML — member → member',
    `The same sequences → ladyna buildMCML(sequences, nodeGroups), painted by plotMCML.`);
  if (prep.error) return [{ ...v1, error: prep.error }, { ...v2, error: prep.error }];
  const { sequences, nodeGroups, actorLevels } = prep.ok;
  return [
    paint(v1, () => plotHTNA(htna(sequences, { nodeGroups, actorLevels }), { title: 'Interaction network — members as actors', subtitle: sub })),
    paint(v2, () => plotMCML(buildMCML(sequences, nodeGroups), { title: 'Interaction MCML — member → member, states inside', subtitle: sub })),
  ];
}

// ── 2 · temporal & contemporaneous (painting psychaj results) ───────────────

/** matrixModel lives in ladynaViews.js (Dynamics paints transfer entropy with it too); re-exported here. */
export { matrixModel };

/** An all-zero matrix draws as an empty picture; say so instead. A display check, not a statistic. */
function allZero(m) {
  return Array.isArray(m) && m.length > 0 && m.every((row) => row.every((x) => x === 0));
}

/** Contemporaneous / between are symmetric: keep the upper triangle for the undirected picture. */
function upper(m) {
  return m.map((row, i) => row.map((x, j) => (j > i ? x : 0)));
}

const SIGNED = { edgeColorBy: 'sign', initRing: false, cutoff: VAR_CUTOFF, decimals: 2 };

/**
 * The cells psychaj left non-finite (its "not estimable"), as labels, and the
 * matrix with those cells out of the picture (0 = no edge drawn). A display
 * step on psychaj's own output, not a statistic: the finite coefficients go
 * to the painter unchanged. Undirected matrices are read on the upper
 * triangle (the picture's edges).
 */
function missingCells(labels, m, directed) {
  const missing = [];
  const drawable = m.map((row, i) => row.map((x, j) => {
    const counts = directed || j > i;
    if (Number.isFinite(x)) return x;
    if (counts) missing.push(directed ? `${labels[i]} → ${labels[j]}` : `${labels[i]} — ${labels[j]}`);
    return 0;
  }));
  const cells = directed ? m.length * m.length : (m.length * (m.length - 1)) / 2;
  return { missing, drawable, cells };
}

function matrixView(id, title, caption, labels, m, { directed, subtitle, estimable }) {
  const v = view(id, title, caption);
  if (!Array.isArray(m)) return { ...v, note: 'Not returned by the fit.' };
  // psychaj's verdict on the matrix (`estimable`), not a count of NaNs here.
  let draw = m;
  let partial = null;
  if (estimable === false) {
    const { missing, drawable, cells } = missingCells(labels, m, directed);
    // Wholly unavailable: nothing finite to draw.
    if (missing.length === 0 || missing.length >= cells) {
      return { ...v, missing_cells: missing, note: 'Not estimable: psychaj could not estimate this matrix (see the warnings).' };
    }
    draw = drawable;
    partial = {
      missing_cells: missing,
      warning: `Partly estimable: psychaj could not estimate ${missing.length} of ${cells} coefficients (${missing.join(', ')}). They are not drawn; an absent edge there is unknown, not zero.`,
    };
  }
  if (allZero(draw)) return { ...v, ...(partial ?? {}), note: partial ? 'No edge among the coefficients psychaj could estimate.' : 'No edge: every coefficient psychaj returned is zero.' };
  const opts = directed
    ? { ...SIGNED, title, subtitle }
    : { ...SIGNED, title, subtitle, arrows: false, curvature: 0, showSelfLoops: false };
  return paint({ ...v, ...(partial ?? {}) }, () => plotNetwork(matrixModel(labels, directed ? draw : upper(draw)), opts));
}

const FIT_TITLES = {
  members: 'Members as subjects (mlVAR)',
  groups: 'Groups as subjects (mlVAR, seats)',
  graphicalvar: 'Selected group (graphicalVAR)',
};

/**
 * Paint a `fitVarNetworks()` result: per set-up, temporal (from → to) and
 * contemporaneous pictures side by side (+ between for mlVAR, + seats as MCML
 * clusters for groups-as-subjects). A matrix psychaj could not estimate at all
 * becomes a "not estimable" note; a partly estimable one is drawn from its
 * finite cells with an on-page warning naming the missing ones.
 *
 * @returns {Array<{ id, title, call, status, reason, error, warnings, n_obs, n_subjects, n_rows, n_dropped, elapsed_ms, views }>}
 */
export function varNetworkViews(result) {
  if (!result || typeof result !== 'object' || !result.fits) throw new GroupNetworkError('`result` must come from fitVarNetworks()');
  const cut = `edges |w| ≤ ${VAR_CUTOFF} hidden`;
  return ['members', 'groups', 'graphicalvar'].map((key) => {
    const fit = result.fits[key];
    const section = {
      id: key,
      title: FIT_TITLES[key],
      call: fit.call,
      status: fit.status,
      reason: fit.reason,
      error: fit.error,
      warnings: fit.warnings ?? [],
      n_obs: fit.n_obs,
      n_subjects: fit.n_subjects,
      n_rows: fit.n_rows,
      n_dropped: fit.n_dropped,
      elapsed_ms: fit.elapsed_ms,
      views: [],
    };
    if (fit.status !== 'ok') return section;
    const isG = fit.model === 'graphicalvar';
    const base = `${key}-${result.group_id}-${result.channels.join('+')}`;
    const tName = isG ? 'PDC' : 'fixed effects';
    section.views.push(matrixView(`${base}-temporal`, 'Temporal',
      `psychaj ${isG ? 'fitGraphicalVAR PDC' : 'fitMlVAR temporal (transposed to from → to)'}, painted by ladyna plotNetwork (sign-coloured; ${cut}).`,
      fit.labels, fit.temporal, { directed: true, subtitle: `lag 1, ${tName}, from → to`, estimable: fit.estimable?.temporal }));
    section.views.push(matrixView(`${base}-contemporaneous`, 'Contemporaneous',
      `psychaj ${isG ? 'fitGraphicalVAR PCC' : 'fitMlVAR contemporaneous'} (partial correlations), painted by ladyna plotNetwork undirected (${cut}).`,
      fit.labels, fit.contemporaneous, { directed: false, subtitle: 'partial correlations, same tick', estimable: fit.estimable?.contemporaneous }));
    if (!isG) {
      section.views.push(matrixView(`${base}-between`, 'Between-subject',
        `psychaj fitMlVAR between (partial correlations of subject means), painted by ladyna plotNetwork undirected (${cut}).`,
        fit.labels, fit.between, { directed: false, subtitle: 'subject means', estimable: fit.estimable?.between }));
    }
    if (key === 'groups' && fit.clusters) {
      const v = view(`${base}-mcml`, 'Temporal, seats as clusters',
        'psychaj fitMlVAR temporal (from → to) wrapped by createTNA, painted by ladyna plotMCML (aggregation abs_sum: seat-to-seat influence is the sum of |coefficients|; edges inside a seat keep their sign).');
      // A partly estimable temporal matrix is clustered on its finite cells,
      // with the same warning as the temporal picture.
      const est = fit.estimable?.temporal === false ? missingCells(fit.labels, fit.temporal, true) : null;
      const t = est ? est.drawable : fit.temporal;
      const none = est && (est.missing.length === 0 || est.missing.length >= est.cells);
      const temporalView = section.views.find((x) => x.id === `${base}-temporal`);
      const vv = temporalView?.warning ? { ...v, warning: temporalView.warning, missing_cells: temporalView.missing_cells } : v;
      section.views.push(none || allZero(t)
        ? { ...vv, note: 'No temporal estimate to cluster (see the temporal picture).' }
        : paint(vv, () => plotMCML(matrixModel(fit.labels, t), {
          clusters: fit.clusters, mode: 'weights', aggregation: 'abs_sum', title: 'Temporal mlVAR — who drives whom', subtitle: 'seats as clusters · between seats: sum of |fixed effects|',
        })));
    }
    return section;
  });
}
