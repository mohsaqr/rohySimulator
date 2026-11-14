// Tests for the shared pattern library (standalone/app/src/lib/patternViews.js)
// and the group's pattern sources (groupPatterns.js). Plain node, throws on
// failure; resolves ladyna from standalone/app/node_modules, so it runs in the
// mini-ci `types` job beside app-group-networks.test.js.
//
// The statistics are ladyna's (kgramPathways / HYPA, discoverPatterns,
// markovOrderTest, contextTree — each tested there). This file checks that a
// planted structure comes through the views (an over-represented second-order
// pathway, Markov order 2), the hand-countable cases, the tables, the gap rule,
// and that every failure is a coded view error rather than a throw.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PATTERN_SECTIONS,
  sequenceSummary,
  pathwayViews,
  pathwayTable,
  subPatternViews,
  memoryViews,
  treeViews,
  stateColors,
  gapFreeRuns,
  hypaReading,
  memoryReading,
} from '../standalone/app/src/lib/patternViews.js';
import { PATTERN_SOURCES, groupPatternSequences, patternSourceOptions } from '../standalone/app/src/lib/groupPatterns.js';
import { OyonViewError } from '../standalone/app/src/lib/ladynaViews.js';
import { GroupNetworkError } from '../standalone/app/src/lib/groupNetworks.js';

const appRequire = createRequire(new URL('../standalone/app/package.json', import.meta.url));
const { simulateGroup } = appRequire('ladyna/synchrony');

const isSvg = (s) => typeof s === 'string' && s.includes('<svg') && s.includes('</svg>');

// Planted second order: after A→B comes C, after D→B comes D. A first-order
// model cannot know which, so both pathways are over-represented under HYPA.
let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const PLANTED = Array.from({ length: 20 }, () => {
  const out = [];
  while (out.length < 60) out.push(...(rnd() < 0.5 ? ['A', 'B', 'C'] : ['D', 'B', 'D']));
  return out;
});

// ─── sections and summary ───────────────────────────────────────────────────
{
  assert.deepEqual(PATTERN_SECTIONS.map((s) => s.id), ['pathways', 'subpatterns', 'memory', 'trees']);
  const sum = sequenceSummary([['a', 'b', null, 'c'], ['x'], [], [null, '']]);
  // 4 states over 4 sequences; only a→b is a transition (the null breaks b…c); four states once each → entropy 1.
  assert.deepEqual(sum, { n_sequences: 4, n_usable: 1, n_states: 4, alphabet: ['a', 'b', 'c', 'x'], mean_length: 1, n_transitions: 1, state_entropy: 1 });
  assert.throws(() => sequenceSummary('ab'), (e) => e instanceof OyonViewError && e.code === 'patterns_bad_input');
  // The group's error class is the shared one, so errorOf() labels it 'oyon'.
  assert.ok(new GroupNetworkError('x') instanceof OyonViewError);
}

// ─── pathways: the planted pathways are over-represented ──────────────────
{
  const pw = pathwayViews(PLANTED, { orders: [3] });
  assert.equal(pw.views.length, 2);
  assert.ok(pw.views.every((v) => isSvg(v.svg) && v.error === null), 'chains and simplicial view are ladyna SVGs');
  assert.deepEqual(pw.views.map((v) => v.id), ['pathways-chains', 'pathways-simplicial']);
  // States in the page colours, over / under in words, no red/blue blobs.
  const colorMap = stateColors(PLANTED);
  const coloured = pathwayViews(PLANTED, { orders: [3], colorMap }).views[0].svg;
  for (const hex of Object.values(colorMap)) assert.ok(coloured.includes(`fill="${hex}"`), `chip colour ${hex}`);
  assert.ok(coloured.includes('more often') && !/#dc2626|#2563eb/.test(coloured), 'over/under in words, not red/blue');
  const over = new Set(pw.rows.filter((r) => r.anomaly === 'over').map((r) => r.path));
  assert.ok(over.has('A -> B -> C') && over.has('D -> B -> D'), `planted pathways over-represented, got ${[...over]}`);
  assert.ok(!pw.rows.some((r) => r.path === 'A -> B -> D' && r.anomaly === 'over'), 'the path the data never takes is not over');
  assert.equal(pw.counts.tested, pw.counts.over + pw.counts.under + pw.counts.normal);
  // Counts are ladyna's summary over every pathway; 'too few' rows are ladyna's testable: false.
  assert.ok(pw.rows.every((r) => r.testable !== false || r.anomaly === 'normal'), 'an untestable row is never over/under');
  {
    const rare = { path: 'A -> B -> C', count: 3, observed: 3, expected: 0.7, ratio: 4.3, pAdjusted: 0.047, anomaly: 'normal', testable: false, rank: 1 };
    assert.equal(pathwayTable([rare])[0].anomaly, 'too few to test');
    assert.equal(pathwayTable([{ ...rare, testable: true }])[0].anomaly, 'normal');
  }
  // The figure's title and subtitle are ladyna's, from that summary.
  assert.ok(pw.views[0].svg.includes(`${pw.counts.over} more often · ${pw.counts.under} less often`), 'ladyna subtitle');
  // gaps 'split' (default): every count is HYPA's own observed count.
  for (const r of pw.rows) assert.equal(r.count, r.observed, r.path);
  // Ranked by adjusted p, ranks 1..n.
  pw.rows.forEach((r, i) => assert.equal(r.rank, i + 1));
  for (let i = 1; i < pw.rows.length; i++) assert.ok(pw.rows[i].pAdjusted >= pw.rows[i - 1].pAdjusted);
  // Table: one row per pathway, display strings.
  const table = pathwayTable(pw.rows);
  assert.equal(table.length, pw.rows.length);
  assert.deepEqual(Object.keys(table[0]), ['rank', 'path', 'count', 'expected', 'ratio', 'p_adj', 'anomaly']);
  // The anomaly filter keeps only that class (or says none).
  const under = pathwayViews(PLANTED, { orders: [3], anomaly: 'under' });
  assert.ok(under.rows.every((r) => r.anomaly === 'under'));
  if (!under.rows.length) assert.ok(under.views[0].note && !under.views[0].svg);
}

// ─── pathways: a missing state ends a pathway (gaps 'split') ────────────────
{
  const seqs = [['A', 'B', null, 'C', 'D', 'A'], ['A', 'B', 'C']];
  const split = pathwayViews(seqs, { orders: [3], min_count: 1 }).rows.map((r) => r.path).sort();
  assert.deepEqual(split, ['A -> B -> C', 'C -> D -> A'], 'no pathway spans the missing state');
  const drop = pathwayViews(seqs, { orders: [3], min_count: 1, gaps: 'drop' }).rows.map((r) => r.path);
  assert.ok(drop.includes('B -> C -> D'), "gaps 'drop' joins across it (R .hon_parse_input)");
}

// ─── every section turns bad input into a coded view error ─────────────────
{
  for (const fn of [pathwayViews, subPatternViews, memoryViews, treeViews]) {
    const out = fn([['A'], [null]]);
    assert.ok(out.views.length > 0);
    for (const v of out.views) {
      assert.equal(v.svg, null);
      assert.equal(v.error.code, 'patterns_empty', `${fn.name}: ${JSON.stringify(v.error)}`);
      assert.equal(v.error.source, 'oyon');
    }
  }
}

// ─── sub-patterns: hand count ──────────────────────────────────────────────
{
  const sp = subPatternViews([['a', 'b', 'a', 'b']], { min_freq: 1, min_support: 0 });
  const ab = sp.tables.short.find((r) => r.pattern === 'a → b');
  assert.equal(ab.frequency, 2, 'a→b occurs twice in a b a b');
  assert.equal(sp.tables.short.find((r) => r.pattern === 'b → a').frequency, 1);
  assert.ok(isSvg(sp.views[0].svg));
  const planted = subPatternViews(PLANTED);
  assert.ok(planted.views.every((v) => isSvg(v.svg)));
}

// ─── memory: the planted data is second order ──────────────────────────────
{
  const m = memoryViews(PLANTED, { max_order: 3, n_perm: 200 });
  assert.equal(m.summary.optimal, 2);
  assert.equal(m.summary.bic, 2);
  assert.equal(m.rows.length, 4, 'orders 0..3');
  assert.equal(m.rows[2].significant, 'yes');
  assert.ok(isSvg(m.views[0].svg));
  // Memoryless (first-order) data: the sequential test does not go past 1.
  let s2 = 17;
  const r2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  const markov1 = Array.from({ length: 20 }, () => {
    let cur = 'A';
    return Array.from({ length: 80 }, () => (cur = cur === 'A' ? (r2() < 0.8 ? 'B' : 'A') : (r2() < 0.7 ? 'A' : 'B')));
  });
  assert.ok(memoryViews(markov1, { n_perm: 200 }).summary.bic <= 1);
}

// ─── trees ─────────────────────────────────────────────────────────────────
{
  const t = treeViews(PLANTED);
  assert.ok(t.views.every((v) => isSvg(v.svg)));
  assert.ok(t.rows.length > 0 && t.rows.every((r) => r.depth > 0), 'the root is not a pathway');
  // Trees use the page's state colours (the network's palette and order).
  const colors = stateColors(PLANTED);
  for (const hex of Object.values(colors)) assert.ok(t.views[0].svg.includes(hex) && t.views[1].svg.includes(hex), `tree uses ${hex}`);
  const ab = t.rows.find((r) => r.pathway === 'A → B');
  assert.ok(ab && ab.likely_next === 'C' && ab.p_next === 1, 'after A → B the tree predicts C with certainty');
}

// ─── a missing bin ends a run: no transition invented across it (Codex #7) ──
{
  // ladyna gapFreeRuns (re-exported by patternViews; the cut is ladyna's, not hand-rolled here).
  assert.deepEqual(gapFreeRuns([['A', 'B', null, 'C', 'D'], ['E', '', 'F'], [null], 'x']), [['A', 'B'], ['C', 'D'], ['E'], ['F']]);
  assert.throws(() => gapFreeRuns('A'), TypeError);
  // Each gapped sequence has B then C only across the gap: B → C must not appear.
  const gapped = Array.from({ length: 6 }, () => ['A', 'B', null, 'C', 'D', 'A', 'B', null, 'C', 'D']);
  const t = treeViews(gapped, { min_count: 1 });
  assert.equal(t.views[0].error ?? null, null);
  const b = t.rows.find((r) => r.pathway === 'B');
  assert.ok(!b || b.likely_next !== 'C', 'no B → C across a gap');
  assert.ok(!t.rows.some((r) => / → B$/.test(r.pathway) && r.likely_next === 'C'), 'no path into B predicts C');
  const m = memoryViews(gapped, { n_perm: 50 });
  assert.equal(m.views[0].error ?? null, null);
  assert.equal(m.summary.n_sequences, 18, 'each sequence is three runs (A B | C D A B | C D), not one joined sequence');
  // A sequence whose only transitions cross gaps has nothing to test.
  const allGaps = memoryViews([['A', null, 'B', null, 'C']], { n_perm: 50 });
  assert.equal(allGaps.views[0].error.code, 'patterns_empty');
}

// ─── readings never affirm the memoryless null (Codex #22) ────────────────
{
  const untested = hypaReading({ tested: 0, too_few: 2, over: 0, under: 0, normal: 0, pathways: 2 });
  assert.match(untested, /No pathway is common enough to test/);
  assert.match(untested, /2 pathways are too rare to test/);
  assert.doesNotMatch(untested, /explained by the current|memoryless\)? alone|carries/);
  const none = hypaReading({ tested: 5, too_few: 1, over: 0, under: 0, normal: 5, pathways: 6 });
  assert.match(none, /Of 5 pathways tested, 0 occur more often and 0 less often/);
  assert.match(none, /no evidence of memory beyond the current state, which is not evidence that there is none/);
  assert.match(none, /1 pathway is too rare to test/);
  const some = hypaReading({ tested: 4, too_few: 0, over: 1, under: 1, normal: 2, pathways: 4 });
  assert.match(some, /1 occurs more often and 1 less often/);
  assert.doesNotMatch(some, /no evidence/);
  assert.equal(hypaReading(null), '');
  const m1 = memoryReading({ optimal: 1, bic: 1, aic: 2, n_sequences: 3, n_observations: 40 });
  assert.match(m1, /No evidence that states before the current one shape the next/);
  assert.doesNotMatch(m1, /carries what the past says/);
}

// ─── group sources ─────────────────────────────────────────────────────────
{
  assert.deepEqual(PATTERN_SOURCES.map((s) => s.id), ['members', 'regime', 'interaction']);
  const rows = [
    ...simulateGroup({ group_id: 'G1', channel: 'arousal', coupling: [[0, 0, 0], [0.5, 0, 0], [0, 0, 0]], lag_s: 1, ar: 0.3, seed: 1, normalize: 'none', missing: 0.05 }),
    ...simulateGroup({ group_id: 'G1', kind: 'gaze', hz: 5, channel: 'screen_gaze.aoi', seed: 91 }),
  ];
  const opts = patternSourceOptions(rows);
  assert.deepEqual(opts.channels.map((c) => c.channel).sort(), ['arousal', 'screen_gaze.aoi']);
  assert.deepEqual(opts.regime_kinds, ['arousal', 'attention']);

  const members = groupPatternSequences(rows, { source: 'members', channel: 'arousal' });
  assert.equal(members.error, null);
  assert.deepEqual(members.ids, ['G1/m1', 'G1/m2', 'G1/m3']);
  assert.ok(members.sequences.flat().every((s) => s === null || ['low', 'mid', 'high'].includes(s)));

  const regime = groupPatternSequences(rows, { source: 'regime', regime_kind: 'arousal' });
  assert.equal(regime.error, null);
  assert.deepEqual(regime.ids, ['G1']);
  const states = new Set(regime.sequences.flat().filter((s) => s !== null));
  assert.ok(!states.has('sparse') && !states.has('n/a'), "'sparse' bins are gaps, not a state");
  assert.ok([...states].every((s) => ['all_high', 'all_low', 'mixed'].includes(s)), [...states].join());

  const inter = groupPatternSequences(rows, { source: 'interaction', channel: 'arousal' });
  assert.equal(inter.error, null);
  assert.ok(inter.sequences.flat().filter(Boolean).every((t) => /^m\d:(low|mid|high)$/.test(t)), 'tokens are member:state');

  // Every source feeds the library.
  for (const s of [members, regime, inter]) assert.ok(isSvg(pathwayViews(s.sequences).views[0].svg ?? ''));

  // Errors come back coded, never thrown.
  assert.equal(groupPatternSequences(rows, { source: 'nope' }).error.code, 'patterns_bad_input');
  assert.equal(groupPatternSequences(rows, { source: 'members' }).error.code, 'patterns_bad_input');
  assert.equal(groupPatternSequences([], { source: 'members', channel: 'arousal' }).error.code, 'patterns_empty');
  const noRegime = rows.filter((r) => r.channel === 'screen_gaze.aoi').map((r) => ({ ...r }));
  assert.equal(groupPatternSequences(noRegime, { source: 'regime', regime_kind: 'arousal' }).error.code, 'patterns_no_regime');
}

console.log('app-patterns tests passed');
