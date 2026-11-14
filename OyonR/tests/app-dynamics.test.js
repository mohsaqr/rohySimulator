// Tests for the Dynamics library (standalone/app/src/lib/dynamicsViews.js).
// Plain node, throws on failure; resolves ladyna from standalone/app, so it
// runs in the mini-ci `types` job beside app-patterns.test.js.
//
// The statistics are ladyna's (tna, centralities, communities, bootstrapTna,
// estimateCS, lsa, transferEntropy, mmm, clusterSequences — each tested
// there). This file checks that planted structure comes through the views
// (a cycle A→B→C is above chance and carries transfer entropy; two planted
// regimes are recovered as two clusters), the hand-checkable plumbing (labels,
// gaps, the NA-aware p adjustment against R), and that every failure is a
// coded view error rather than a throw.

import assert from 'node:assert/strict';
import {
  DYNAMICS_SECTIONS,
  COMMUNITY_METHODS,
  usableSequences,
  sequenceDescViews,
  networkViews,
  reliabilityViews,
  csReading,
  lagViews,
  transferViews,
  clusterViews,
  stateColors,
  POSITION_CUTS,
} from '../standalone/app/src/lib/dynamicsViews.js';
import { sequenceSummary } from '../standalone/app/src/lib/patternViews.js';
import { OyonViewError } from '../standalone/app/src/lib/ladynaViews.js';
import { matrixModel } from '../standalone/app/src/lib/groupNetworks.js';

const isSvg = (s) => typeof s === 'string' && s.includes('<svg') && s.includes('</svg>');

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const NEXT = { A: 'B', B: 'C', C: 'A' };
// Regime 1 ("sticky"): stays put 85 % of the time. Regime 2 ("cycling"): A→B→C→A 80 % of the time.
const sticky = () => { let c = 'A'; return Array.from({ length: 60 }, () => (c = rnd() < 0.85 ? c : 'ABC'[Math.floor(rnd() * 3)])); };
const cycling = () => { let c = 'A'; return Array.from({ length: 60 }, () => (c = rnd() < 0.8 ? NEXT[c] : c)); };
const TWO = [...Array.from({ length: 12 }, sticky), ...Array.from({ length: 12 }, cycling)];
const CYCLE = Array.from({ length: 12 }, cycling);

// ─── sections, input, labels ───────────────────────────────────────────────
{
  assert.deepEqual(DYNAMICS_SECTIONS.map((s) => s.id), ['sequences', 'network', 'reliability', 'lag', 'clusters', 'transfer'], 'clusters before transfer entropy, which comes last');
  // The counts dashboard (ladyna describeSequences via sequenceSummary).
  {
    const sm = sequenceSummary([['A', 'B', 'A'], ['B', null, 'B', 'A']]);
    assert.deepEqual([sm.n_usable, sm.n_states, sm.n_transitions], [2, 6, 3]);
    assert.equal(sm.mean_length, 3);
    assert.ok(Math.abs(sm.state_entropy - 1) < 1e-12, 'A and B equally common → 1');
  }
  const u = usableSequences([['a', 'b'], ['x'], ['c', '', 'd'], [null, 'e']], ['s1', 's2', 's3', 's4']);
  assert.deepEqual(u.labels, ['s1', 's3'], 'only sequences with two or more states, labels kept with them');
  assert.deepEqual(u.sequences[1], ['c', null, 'd'], "'' is a gap (null), not a state");
  assert.deepEqual(usableSequences([['a', 'b'], ['c', 'd']]).labels, ['S1', 'S2']);
  assert.throws(() => usableSequences('ab'), (e) => e instanceof OyonViewError && e.code === 'dynamics_bad_input');
  assert.throws(() => usableSequences([['a', 'b']], ['x', 'y']), (e) => e.code === 'dynamics_bad_input');
  assert.throws(() => usableSequences([['a'], []]), (e) => e.code === 'dynamics_empty');
}

// ─── sequences: one row per usable sequence, hand-checkable fields ─────────
{
  const out = sequenceDescViews([['a', 'a', 'b', null, 'b'], ['b'], ['b', 'a']], { labels: ['one', 'two', 'three'] });
  assert.equal(out.views.length, 4);
  assert.ok(out.views.every((v) => isSvg(v.svg) && v.error === null), JSON.stringify(out.views.map((v) => v.error)));
  // Codex #21: a one-state session is a sequence for the descriptives.
  assert.deepEqual(out.rows.map((r) => r.sequence), ['one', 'two', 'three']);
  const one = out.rows[0];
  assert.equal(one.length, 4, 'four valid states; the gap is not one');
  assert.equal(one.states, 2);
  assert.equal(one.first, 'a');
  assert.equal(one.last, 'b');
  assert.equal(one.max_spell, 2);
}

// ─── a singleton session stays in the descriptives, not in the network ────
{
  const seqs = [['A', 'B'], ['C']];
  const d = sequenceDescViews(seqs);
  assert.deepEqual(d.rows.map((r) => r.sequence), ['S1', 'S2']);
  assert.equal(d.rows[1].length, 1);
  const cColour = stateColors(seqs).C;
  assert.ok(cColour, 'C has a colour');
  assert.ok(d.views[0].svg.includes(cColour), 'C drawn in the index plot');
  assert.ok(d.views[3].svg.includes('>C<') || d.views[3].svg.includes(cColour), 'C in the mean times');
  // Transitions still need two states: the network sees S1 only.
  assert.deepEqual(usableSequences(seqs).labels, ['S1']);
  assert.deepEqual(usableSequences(seqs, null, { min_states: 1 }).labels, ['S1', 'S2']);
  assert.throws(() => usableSequences([[null], []], null, { min_states: 1 }), (e) => e.code === 'dynamics_empty');
}

// ─── sequences: the positions cut (ladyna trimSequences, percentile) ──────
{
  // Lengths 4, 5, 6, 100. 75th percentile: ceil(0.75·4) − 1 = index 2 of the sorted lengths → 6.
  const mk = (n) => Array.from({ length: n }, (_, i) => 'AB'[i % 2]);
  const seqs = [mk(4), mk(5), mk(6), mk(100)];
  const p75 = sequenceDescViews(seqs);
  assert.deepEqual(p75.positions, {
    cut: 'p75', label: '75th percentile of lengths', shown: 6, longest: 100, n_cut: 1,
    note: 'positions 1–6 (75th percentile of lengths); 1 longer sequence cut',
  }, 'ladyna trimSummary');
  assert.equal(p75.rows[3].length, 100, 'the indices table keeps the whole sequence');
  assert.match(p75.views[0].svg, /1 longer sequence cut/);
  assert.deepEqual(sequenceDescViews(seqs, { positions: 'all' }).positions.n_cut, 0);
  assert.deepEqual(POSITION_CUTS.map((c) => c.id), ['p75', 'p50', 'p90', 'all']);
  const bad = sequenceDescViews(seqs, { positions: 'nope' });
  assert.ok(bad.views.every((v) => v.error?.code === 'dynamics_bad_input'));
}

// ─── one colour per state across the page ─────────────────────────────────
{
  const colors = stateColors(CYCLE);
  assert.deepEqual(Object.keys(colors), ['A', 'B', 'C']);
  assert.equal(new Set(Object.values(colors)).size, 3);
  const seqSvg = sequenceDescViews(CYCLE, { colorMap: colors }).views[0].svg;
  const netSvg = networkViews(CYCLE, { colorMap: colors }).views[0].svg;
  const timesSvg = sequenceDescViews(CYCLE, { colorMap: colors }).views[3].svg;
  for (const [state, hex] of Object.entries(colors)) {
    assert.ok(timesSvg.toLowerCase().includes(hex.toLowerCase()), `mean times bar for ${state} is ${hex}`);
    assert.ok(seqSvg.toLowerCase().includes(hex.toLowerCase()), `index plot uses ${hex} for ${state}`);
    assert.ok(netSvg.toLowerCase().includes(hex.toLowerCase()), `network uses ${hex} for ${state}`);
  }
}

// ─── network: three states, a picture per view, every community method ────
{
  const out = networkViews(CYCLE);
  assert.ok(out.views.every((v) => isSvg(v.svg) || v.note), JSON.stringify(out.views.map((v) => v.error)));
  assert.deepEqual(out.centralities.map((r) => r.state), ['A', 'B', 'C']);
  assert.ok('InStrength' in out.centralities[0] && 'Betweenness' in out.centralities[0]);
  assert.deepEqual(Object.keys(out.communities[0]), ['state', ...COMMUNITY_METHODS]);
  const bad = networkViews(CYCLE, { community: 'nope' });
  assert.equal(bad.views[2].error.code, 'dynamics_bad_input', 'an unknown method is a coded error on its own view');
  assert.ok(isSvg(bad.views[0].svg), 'and the other views still draw');
}

// ─── reliability: a strong cycle is stable; CS from three seeds ────────────
{
  const out = reliabilityViews(CYCLE, { iter: 300, cs_iter: 200 });
  assert.equal(out.counts.edges, out.edges.length);
  const ab = out.edges.find((e) => e.from === 'A' && e.to === 'B');
  assert.equal(ab.stable, 'yes', 'A→B (p = .8) is stable across resamples');
  assert.ok(out.edges.every((e) => e.ci_lower <= e.weight && e.weight <= e.ci_upper), 'weight inside its CI');
  assert.ok(out.cs.length > 0 && out.cs.every((r) => r.seeds === 3 && r.cs_min <= r.cs && r.cs <= r.cs_max));
  assert.ok(out.cs.every((r) => r.reading === csReading(r.cs)), 'the reading is ladyna csReading');
  assert.equal(out.counts.stable, out.edges.filter((e) => e.stable === 'yes').length);
  assert.ok(out.views.every((v) => isSvg(v.svg) || v.note));
  assert.equal(csReading(0.6), 'stable');
  assert.equal(csReading(0.3), 'acceptable');
  assert.equal(csReading(0.1), 'unstable');
}

// ─── lag-sequential: the cycle's transitions are above chance ──────────────
{
  const out = lagViews(CYCLE);
  assert.ok(out.views.every((v) => isSvg(v.svg)), JSON.stringify(out.views.map((v) => v.error)));
  const cell = (f, t) => out.rows.find((r) => r.from === f && r.to === t);
  assert.equal(cell('A', 'B').reading, 'above chance');
  assert.equal(cell('A', 'C').reading, 'below chance', 'the cycle never goes A→C directly');
  assert.equal(out.counts.cells, 9);
  assert.equal(out.counts.above, out.rows.filter((r) => r.reading === 'above chance').length, 'ladyna lsa summary');
  assert.equal(out.counts.adjust, 'BH');
  for (const r of out.rows) assert.ok(r.p_adj === '–' || r.p_adj >= r.p, `${r.from}→${r.to}: adjusted p not below raw p`);
  // Sorted by |adjusted residual|.
  for (let i = 1; i < out.rows.length; i++) assert.ok(Math.abs(out.rows[i].adj_res) <= Math.abs(out.rows[i - 1].adj_res));
}

// ─── transfer entropy: the cycle carries information A → B ─────────────────
{
  const out = transferViews(CYCLE, { iterations: 99, seed: 1 });
  assert.equal(out.counts.pairs, 6, 'every ordered pair of three states');
  const ab = out.rows.find((r) => r.from === 'A' && r.to === 'B');
  assert.equal(ab.significant, 'yes');
  assert.ok(isSvg(out.views[0].svg));
  assert.equal(out.counts.significant, out.rows.filter((r) => r.significant === 'yes').length);
  for (const r of out.rows) assert.ok(r.p_adj >= r.p, `${r.from}→${r.to}: adjusted p not below raw p`);
  // Same seed, same numbers.
  assert.deepEqual(transferViews(CYCLE, { iterations: 99, seed: 1 }).rows, out.rows);
}

// ─── clusters: the two planted regimes come back as two clusters ───────────
{
  const out = clusterViews(TWO, { k: 2, ks: [2, 3] });
  assert.deepEqual(out.fits.map((f) => f.k), [2, 3]);
  const a = out.assignments.map((r) => r.cluster);
  const first = new Set(a.slice(0, 12));
  const second = new Set(a.slice(12));
  assert.ok(first.size === 1 && second.size === 1 && [...first][0] !== [...second][0], `planted split recovered, got ${a.join('')}`);
  assert.equal(out.fits[0].converged, 'yes');
  assert.match(String(out.fits[0].starts_at_best), /^\d+\/10$/);
  assert.deepEqual(out.sizes.map((s) => s.sequences), [12, 12]);
  assert.ok(out.views.every((v) => isSvg(v.svg)), JSON.stringify(out.views.map((v) => v.error)));
  assert.equal(out.views.length, 4, 'networks, mean times, one index plot per cluster');
  const grid = out.views[0].svg;
  assert.ok(grid.indexOf('cluster 1') < grid.indexOf('cluster 2'), 'per-cluster panels in cluster order');
  // Codex #23: clusters in the grouped mean times take Okabe–Ito, not ladyna's Tableau default.
  const times = out.views[1].svg.toLowerCase();
  assert.ok(times.includes('#e69f00') && times.includes('#56b4e9'), 'cluster colours are Okabe–Ito');
  for (const tableau of ['#4e79a7', '#f28e2b', '#e15759']) assert.ok(!times.includes(tableau), `no Tableau ${tableau}`);

  // Index plots take the positions cut: one very long sequence is cut, and the plots say so.
  const longOne = TWO.map((q, i) => (i === 0 ? Array.from({ length: 400 }, (_, j) => q[j % q.length]) : q));
  const cutOut = clusterViews(longOne, { k: 2, ks: [2] });
  const indexSvgs = cutOut.views.slice(2).map((v) => v.svg);
  assert.ok(indexSvgs.every((svg) => isSvg(svg) && svg.includes('1 longer sequence cut')), 'cluster index plots are cut at the 75th percentile');
  const allPositions = clusterViews(longOne, { k: 2, ks: [2], positions: 'all' }).views.slice(2).map((v) => v.svg);
  assert.ok(allPositions.every((svg) => !svg.includes('longer sequence cut')), "positions 'all' keeps every position");

  const pam = clusterViews(TWO, { method: 'pam', k: 2, ks: [2] });
  assert.equal(pam.assignments.length, 24);
  assert.ok(typeof pam.fits[0].silhouette === 'number');

  // Too few sequences for k, unknown method, k < 2: coded, not thrown.
  assert.equal(clusterViews(TWO.slice(0, 5), { k: 3 }).views[0].error.code, 'dynamics_too_few_sequences');
  assert.equal(clusterViews(TWO, { method: 'nope' }).views[0].error.code, 'dynamics_bad_input');
  assert.equal(clusterViews(TWO, { k: 1 }).views[0].error.code, 'dynamics_bad_input');
}

// ─── every section turns empty input into a coded view error ───────────────
{
  // Transitions need two states: one-state input is empty for these.
  for (const fn of [networkViews, reliabilityViews, lagViews, transferViews, clusterViews]) {
    const out = fn([['A'], [null]]);
    assert.ok(out.views.length > 0, fn.name);
    for (const v of out.views) {
      assert.equal(v.svg, null);
      assert.equal(v.error.code, 'dynamics_empty', `${fn.name}: ${JSON.stringify(v.error)}`);
      assert.equal(v.error.source, 'oyon');
    }
  }
}

// The descriptives draw a one-state sequence (Codex #21); only no state at all is empty.
{
  const one = sequenceDescViews([['A'], [null]]);
  assert.ok(one.views.every((v) => isSvg(v.svg)), 'a single state is drawn');
  assert.deepEqual(one.rows.map((r) => r.sequence), ['S1']);
  const none = sequenceDescViews([[null], []]);
  assert.ok(none.views.every((v) => v.svg === null && v.error.code === 'dynamics_empty' && v.error.source === 'oyon'));
}

// ─── matrixModel moved to ladynaViews; groupNetworks still re-exports it ───
{
  const m = matrixModel(['x', 'y'], [[0, 0.4], [-0.2, 0]]);
  assert.deepEqual(m.labels, ['x', 'y']);
}

console.log('app-dynamics tests passed');
