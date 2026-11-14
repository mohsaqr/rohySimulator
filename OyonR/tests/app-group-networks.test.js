// Tests for the group dashboard's Networks section
// (standalone/app/src/lib/groupNetworks.js + groupVarFit.js). Plain node,
// throws on failure.
//
// Like app-group-dashboard.test.js it resolves `ladyna` and `psychaj` from
// standalone/app/node_modules, so it runs in the mini-ci `types` job. The
// numbers are ladyna's and psychaj's (their own tests); this file checks the
// plumbing: every view comes back as a ladyna SVG, the VAR matrices have the
// right size and orientation (a built-in m1 → m2 coupling reads from m1 to
// m2), psychaj's warnings and NaN pass through, and errors carry codes.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  networkRows,
  networkChannels,
  cooccurrenceNetworks,
  bootstrapCooccurrence,
  sequenceViews,
  memberNetworks,
  interactionNetworks,
  varNetworkViews,
  matrixModel,
  GroupNetworkError,
  NETWORK_TABS,
} from '../standalone/app/src/lib/groupNetworks.js';
import { fitVarNetworks, GroupVarError } from '../standalone/app/src/lib/groupVarFit.js';
import { demoGroupRows, parseGroupInput, buildTimelines } from '../standalone/app/src/lib/groupDashboard.js';

// ladyna and psychaj live in the app's node_modules, not the repo root's: resolve them from there.
// Test-side check only: the app reads psychaj's `estimable` instead of counting.
const nonFiniteCells = (m) => (Array.isArray(m) ? m.reduce((n, row) => n + row.filter((x) => !Number.isFinite(x)).length, 0) : 0);

const appRequire = createRequire(new URL('../standalone/app/package.json', import.meta.url));
const { simulateGroup, toVarRows } = appRequire('ladyna/synchrony');
const { fitMlVAR } = appRequire('psychaj');

const isSvg = (s) => typeof s === 'string' && s.includes('<svg') && s.includes('</svg>');
const throwsCode = (fn, cls, code) => assert.throws(fn, (err) => err instanceof cls && err.code === code, `expected ${code}`);

// ─── fixture: 6 groups × 3 members; arousal m1 → m2 at lag 1 s; valence; gaze AOIs ──
// simulateGroup: coupling[i][j] = effect of member j on member i, so [1][0] = m1 → m2.
const N_GROUPS = 6;
function group(g) {
  const gid = `G${g + 1}`;
  return [
    ...simulateGroup({ group_id: gid, channel: 'arousal', coupling: [[0, 0, 0], [0.5, 0, 0], [0, 0, 0]], lag_s: 1, ar: 0.3, seed: 1 + g, normalize: 'none', missing: 0.05 }),
    ...simulateGroup({ group_id: gid, channel: 'valence', lag_s: 1, ar: 0.5, seed: 51 + g, normalize: 'none' }),
    ...simulateGroup({ group_id: gid, kind: 'gaze', hz: 5, channel: 'screen_gaze.aoi', seed: 91 + g }),
  ];
}
const TIMELINES = Object.fromEntries(Array.from({ length: N_GROUPS }, (_, g) => [`G${g + 1}`, group(g)]));
const ALL = Object.values(TIMELINES).flat();

// ─── rows and channels ─────────────────────────────────────────────────────
{
  const g1 = networkRows(TIMELINES, { group_id: 'G1' });
  assert.ok(g1.every((r) => r.group_id === 'G1'));
  assert.equal(g1.length, TIMELINES.G1.length);
  const cut = networkRows(TIMELINES, { group_id: 'G1', span: { start_s: 100, end_s: 200 } });
  assert.ok(cut.length > 0 && cut.length < g1.length);
  assert.ok(cut.every((r) => r.t_s >= 100 && r.t_s <= 200), 'the brush cuts every view');
  const all = networkRows(TIMELINES, { scope: 'all' });
  assert.equal(all.length, ALL.length);
  assert.equal(new Set(all.map((r) => r.group_id)).size, N_GROUPS);

  throwsCode(() => networkRows(TIMELINES, { group_id: 'nope' }), GroupNetworkError, 'group_networks_unknown_group');
  throwsCode(() => networkRows(TIMELINES, { group_id: 'G1', span: { start_s: 5000, end_s: 6000 } }), GroupNetworkError, 'group_networks_empty');
  throwsCode(() => networkRows(TIMELINES, { group_id: 'G1', scope: 'some' }), GroupNetworkError, 'group_networks_bad_input');
  throwsCode(() => networkRows(null), GroupNetworkError, 'group_networks_bad_input');

  const ch = networkChannels(g1);
  assert.deepEqual(ch.continuous, ['arousal', 'valence']);
  assert.deepEqual(ch.default_var, ['arousal', 'valence']);
  assert.deepEqual(ch.state.map((c) => c.channel).sort(), ['arousal', 'screen_gaze.aoi', 'valence']);
  assert.equal(ch.state.find((c) => c.channel === 'screen_gaze.aoi').kind, 'categorical');
  assert.deepEqual(NETWORK_TABS.map((t) => t.id), ['sequences', 'cooccurrence', 'var', 'member', 'interaction']);
}

// ─── 1 · co-occurrence: three ladyna SVGs, continuous and categorical ──────
{
  const rows = networkRows(TIMELINES, { group_id: 'G1' });
  for (const channel of ['arousal', 'screen_gaze.aoi']) {
    const views = cooccurrenceNetworks(rows, { channel });
    // A categorical channel adds the against-chance view (ladyna cooccur → plotCooccurrence).
    assert.equal(views.length, channel === 'screen_gaze.aoi' ? 4 : 3);
    for (const v of views) {
      assert.ok(isSvg(v.svg), `${v.id} is an SVG`);
      assert.equal(v.error, null);
      assert.ok(v.caption.length > 20 && /plotNetwork|plotMCML|plotCooccurrence/.test(v.caption), 'caption names the painter');
      assert.ok(v.file_name.endsWith('.svg'));
    }
    assert.match(views[1].caption, /plotMCML/);
  }
  // Emotion (the demo's categorical labels): grouped by valence family, ladyna's subtitle.
  {
    const demo = buildTimelines(parseGroupInput(demoGroupRows({ n_groups: 1, duration_s: 300 })));
    const emo = cooccurrenceNetworks(networkRows(demo.timelines, { group_id: demo.group_ids[0] }), { channel: 'emotion' });
    assert.equal(emo.length, 4);
    const bundled = emo[3];
    assert.equal(bundled.id, 'cooccurrence-bundled-emotion');
    assert.ok(isSvg(bundled.svg) && bundled.error === null, JSON.stringify(bundled.error));
    assert.match(bundled.svg, /Emotion co-occurrence/);
    assert.match(bundled.svg, /\d+ sites · \d+ pairs? more often, \d+ less often than chance \(BH, α = 0\.05\)/);
    assert.match(bundled.svg, /dashed = less often/);
  }
  // A ladyna refusal lands in every view of the tab, with ladyna's code.
  const bad = cooccurrenceNetworks(rows, { channel: 'nope' });
  assert.equal(bad.length, 3);
  for (const v of bad) {
    assert.equal(v.svg, null);
    assert.deepEqual([v.error.source, v.error.code], ['ladyna', 'synchrony_unknown_channel']);
  }
  // Pooled over groups.
  const pooled = cooccurrenceNetworks(networkRows(TIMELINES, { scope: 'all' }), { channel: 'arousal' });
  assert.ok(pooled.every((v) => isSvg(v.svg)));
}

// ─── 0 · sequences: one labelled row per member ────────────────────────────
{
  const one = sequenceViews(networkRows(TIMELINES, { group_id: 'G1' }), { channel: 'arousal' });
  assert.equal(one.length, 2);
  for (const v of one) { assert.ok(isSvg(v.svg), v.id); assert.equal(v.error, null); }
  const rowLabels = (svg) => [...svg.matchAll(/x="-6"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(rowLabels(one[0].svg), ['m1', 'm2', 'm3'], 'one group: rows labelled by member');
  assert.match(one[0].svg, />bin \(5 s\)</);
  assert.match(one[0].caption, /plotSequenceIndex/);
  assert.match(one[1].caption, /plotStateDistribution/);
  const all = sequenceViews(networkRows(TIMELINES, { scope: 'all' }), { channel: 'arousal' });
  const labels = rowLabels(all[0].svg);
  assert.equal(labels.length, N_GROUPS * 3, 'all groups: one row per group × member');
  assert.ok(labels.every((l) => /^G\d+\/m\d$/.test(l)), `group/member labels: ${labels.slice(0, 3).join(' ')}`);
  const bad = sequenceViews(networkRows(TIMELINES, { group_id: 'G1' }), { channel: 'nope' });
  assert.ok(bad.every((v) => v.error && v.error.code === 'synchrony_unknown_channel'));
}

// ─── 1b · co-occurrence drawn undirected; bootstrap of stable edges ─────────
{
  const rows = networkRows(TIMELINES, { group_id: 'G1' });
  const [memberView, , stateView] = cooccurrenceNetworks(rows, { channel: 'arousal' });
  // Symmetric counts: no arrowheads, whole-number labels, nodes ordered member by member.
  assert.ok(!/marker-end/.test(memberView.svg), 'member × state co-occurrence has no arrows');
  assert.ok(!/\d\.\d\d</.test(memberView.svg), 'counts are drawn without decimals');
  assert.ok(!/marker-end/.test(stateView.svg));
  const order = [...memberView.svg.matchAll(/>(m\d):(low|mid|high)</g)].map((m) => `${m[1]}:${m[2]}`);
  const firstSeen = [...new Set(order)];
  assert.deepEqual(firstSeen.slice(0, 3), ['m1:low', 'm1:mid', 'm1:high'], `nodes ordered by member then state: ${firstSeen.join(' ')}`);

  const boot = bootstrapCooccurrence(rows, { channel: 'arousal', iter: 200, seed: 7 });
  assert.equal(boot.error, null);
  assert.ok(isSvg(boot.view.svg));
  assert.match(boot.view.caption, /bootstrapTna/);
  assert.equal(new Set(boot.edges.map((e) => e.pair)).size, boot.edges.length, 'each unordered pair reported once');
  assert.ok(boot.edges.every((e) => e.a.split(':')[0] !== e.b.split(':')[0]), 'no within-member pairs (one state per member per bin)');
  assert.ok(boot.n_significant >= 0 && boot.n_significant <= boot.n_pairs);
  assert.equal(boot.n_bins, 120, 'one group, 600 s in 5 s bins');
  // One group's 120 bins are too few for the ±25 % stability rule; pooled groups are not.
  const pooledBoot = bootstrapCooccurrence(networkRows(TIMELINES, { scope: 'all' }), { channel: 'arousal', iter: 200, seed: 7 });
  assert.ok(pooledBoot.n_significant >= 1, `pooled: ${pooledBoot.n_significant} of ${pooledBoot.n_pairs} stable from ${pooledBoot.n_bins} bins`);
  assert.deepEqual(bootstrapCooccurrence(rows, { channel: 'arousal', iter: 200, seed: 7 }).edges, boot.edges, 'reproducible from the seed');
  const bad = bootstrapCooccurrence(rows, { channel: 'nope' });
  assert.equal(bad.error.code, 'synchrony_unknown_channel');
}

// ─── 3 · per-member: grid + difference, member pickers honoured ───────────
{
  const rows = networkRows(TIMELINES, { group_id: 'G1' });
  const m = memberNetworks(rows, { channel: 'arousal' });
  assert.deepEqual(m.members, ['m1', 'm2', 'm3']);
  assert.deepEqual([m.member_a, m.member_b], ['m1', 'm2']);
  assert.equal(m.views.length, 2);
  assert.ok(m.views.every((v) => isSvg(v.svg)));
  const picked = memberNetworks(rows, { channel: 'arousal', member_a: 'm3', member_b: 'm1' });
  assert.deepEqual([picked.member_a, picked.member_b], ['m3', 'm1']);
  assert.match(picked.views[1].title, /m3 − m1/);
  // Same member twice → B moves to another member, never a self-difference.
  const same = memberNetworks(rows, { channel: 'arousal', member_a: 'm2', member_b: 'm2' });
  assert.notEqual(same.member_a, same.member_b);
  const bad = memberNetworks(rows, { channel: 'nope' });
  assert.deepEqual(bad.members, []);
  assert.ok(bad.views.every((v) => v.error?.code === 'synchrony_unknown_channel'));
}

// ─── 4 · interaction: HTNA + MCML ─────────────────────────────────────────
{
  const rows = networkRows(TIMELINES, { group_id: 'G1' });
  const views = interactionNetworks(rows, { channel: 'arousal' });
  assert.equal(views.length, 2);
  assert.ok(views.every((v) => isSvg(v.svg)), 'plotHTNA and plotMCML return SVGs');
  assert.match(views[0].caption, /plotHTNA/);
  assert.match(views[1].caption, /buildMCML/);
  assert.ok(interactionNetworks(rows, { channel: 'screen_gaze.aoi' }).every((v) => isSvg(v.svg)));

  // No state change in the span → a coded Oyon error in both views.
  const still = ['a', 'b'].flatMap((m) => Array.from({ length: 30 }, (_, t) => ({
    group_id: 'S', member_id: m, t_s: t, channel: 'mood', kind: 'categorical', state: 'calm', value: null, quality: 1,
  })));
  const none = interactionNetworks(still, { channel: 'mood' });
  assert.ok(none.every((v) => v.svg === null && v.error.code === 'group_networks_no_events' && v.error.source === 'oyon'));
}

// ─── 2 · VAR fits: sizes, orientation, pass-through ───────────────────────
const FIT = fitVarNetworks({ rows: ALL, group_id: 'G1', channels: ['arousal', 'valence'] });
{
  assert.equal(FIT.n_groups, N_GROUPS);
  assert.deepEqual(Object.keys(FIT.fits), ['members', 'groups', 'graphicalvar']);
  const finiteSquare = (m, n) => m.length === n && m.every((row) => row.length === n && row.every(Number.isFinite));

  // members as subjects (group G1): the channels are the variables.
  const mem = FIT.fits.members;
  assert.equal(mem.status, 'ok', JSON.stringify(mem.error));
  assert.deepEqual(mem.labels, ['arousal', 'valence']);
  assert.ok(finiteSquare(mem.temporal, 2) && finiteSquare(mem.contemporaneous, 2));
  assert.equal(mem.n_subjects, 3);

  // groups as subjects: seats × channels; m1 → m2 reads from '#1 arousal' to '#2 arousal'.
  const grp = FIT.fits.groups;
  assert.equal(grp.status, 'ok', JSON.stringify(grp.error));
  assert.deepEqual(grp.labels, ['#1 arousal', '#1 valence', '#2 arousal', '#2 valence', '#3 arousal', '#3 valence']);
  assert.ok(finiteSquare(grp.temporal, 6) && finiteSquare(grp.contemporaneous, 6));
  assert.equal(grp.n_subjects, N_GROUPS);
  const i1 = grp.labels.indexOf('#1 arousal');
  const i2 = grp.labels.indexOf('#2 arousal');
  assert.ok(grp.temporal[i1][i2] > 0.2, `mlVAR m1 → m2 shows from m1 to m2 (got ${grp.temporal[i1][i2]})`);
  assert.ok(Math.abs(grp.temporal[i2][i1]) < 0.1, `and not from m2 to m1 (got ${grp.temporal[i2][i1]})`);
  assert.deepEqual(grp.clusters, { '#1': ['#1 arousal', '#1 valence'], '#2': ['#2 arousal', '#2 valence'], '#3': ['#3 arousal', '#3 valence'] });

  // psychaj's warnings and NaN pass through verbatim: compare with a direct call on the same rows.
  const wide = toVarRows(ALL, { channels: ['arousal', 'valence'], subject: 'group', label: 'index', raw: true });
  const direct = fitMlVAR(wide.rows, { vars: wide.vars, idvar: wide.idvar, beepvar: wide.beepvar });
  assert.deepEqual(grp.warnings, direct.warnings);
  assert.equal(nonFiniteCells(grp.between), nonFiniteCells(direct.between));
  // psychaj's per-matrix verdict passes through.
  assert.deepEqual(grp.estimable, direct.estimable);
  assert.equal(grp.estimable.between, nonFiniteCells(direct.between) === 0);
  assert.equal(grp.n_rows, wide.rows.length);
  assert.equal(grp.n_dropped, wide.n_dropped);

  // graphicalVAR on G1: members × channels; PDC m1 → m2 from m1 to m2.
  const gv = FIT.fits.graphicalvar;
  assert.equal(gv.status, 'ok', JSON.stringify(gv.error));
  assert.equal(gv.labels.length, 6);
  assert.ok(finiteSquare(gv.temporal, 6) && finiteSquare(gv.contemporaneous, 6));
  const a = gv.labels.indexOf('m1 arousal');
  const b = gv.labels.indexOf('m2 arousal');
  assert.ok(gv.temporal[a][b] > 0.2, `graphicalVAR m1 → m2 shows from m1 to m2 (got ${gv.temporal[a][b]})`);
  assert.ok(Math.abs(gv.temporal[b][a]) < 0.1, `and not from m2 to m1 (got ${gv.temporal[b][a]})`);
  // Contemporaneous partial correlations are symmetric.
  assert.ok(gv.contemporaneous.every((row, i) => row.every((x, j) => Math.abs(x - gv.contemporaneous[j][i]) < 1e-9)));
}

// ─── VAR painting: SVGs, NaN → "not estimable", warnings kept ─────────────
{
  const sections = varNetworkViews(FIT);
  assert.deepEqual(sections.map((s) => s.id), ['members', 'groups', 'graphicalvar']);
  for (const s of sections) {
    const t = s.views.find((v) => v.title === 'Temporal');
    const c = s.views.find((v) => v.title === 'Contemporaneous');
    assert.ok(isSvg(t.svg) && isSvg(c.svg), `${s.id} temporal + contemporaneous are ladyna SVGs`);
  }
  const groups = sections.find((s) => s.id === 'groups');
  const mcml = groups.views.find((v) => v.title === 'Temporal, seats as clusters');
  assert.ok(isSvg(mcml.svg), 'plotMCML of the temporal network');
  assert.match(mcml.caption, /abs_sum/, 'seat-to-seat influence summed by magnitude in ladyna, not |coefficients| taken in Oyon');
  assert.deepEqual(groups.warnings, FIT.fits.groups.warnings);

  // A hand-made result: NaN between, a warning, an all-zero temporal.
  const nan = [[NaN, NaN], [NaN, NaN]];
  const fake = structuredClone(FIT);
  fake.fits.members = {
    ...fake.fits.members, between: nan, warnings: ['psychaj said so'], temporal: [[0, 0], [0, 0]],
    estimable: { ...fake.fits.members.estimable, between: false },
  };
  const [mem] = varNetworkViews(fake);
  assert.deepEqual(mem.warnings, ['psychaj said so']);
  const between = mem.views.find((v) => v.title === 'Between-subject');
  assert.equal(between.svg, null);
  assert.match(between.note, /Not estimable: psychaj could not estimate/);
  const zero = mem.views.find((v) => v.title === 'Temporal');
  assert.equal(zero.svg, null);
  assert.match(zero.note, /No edge/);
  throwsCode(() => varNetworkViews({}), GroupNetworkError, 'group_networks_bad_input');

  // Codex #14: a partly estimable matrix is drawn from its finite cells, the
  // missing ones named on the page; wholly non-finite stays "not estimable".
  const labels = fake.fits.members.labels;
  const k = labels.length;
  const partT = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === 0 && j === 1 ? NaN : 0.2 + 0.01 * (i + j))));
  const part = structuredClone(FIT);
  part.fits.members = { ...part.fits.members, temporal: partT, estimable: { ...part.fits.members.estimable, temporal: false } };
  const pt = varNetworkViews(part)[0].views.find((v) => v.title === 'Temporal');
  assert.ok(isSvg(pt.svg), 'the finite coefficients are still drawn');
  assert.deepEqual(pt.missing_cells, [`${labels[0]} → ${labels[1]}`]);
  assert.match(pt.warning, new RegExp(`Partly estimable: psychaj could not estimate 1 of ${k * k} coefficients`));
  assert.ok(Number.isNaN(part.fits.members.temporal[0][1]), "psychaj's matrix is not changed");
  const allNaN = structuredClone(FIT);
  allNaN.fits.members = { ...allNaN.fits.members, temporal: partT.map((r) => r.map(() => NaN)), estimable: { ...allNaN.fits.members.estimable, temporal: false } };
  const wt = varNetworkViews(allNaN)[0].views.find((v) => v.title === 'Temporal');
  assert.equal(wt.svg, null);
  assert.match(wt.note, /Not estimable/);
  assert.equal(wt.missing_cells.length, k * k);
  // Groups-as-subjects MCML carries the same warning on a partial temporal.
  const partG = structuredClone(FIT);
  const gl = partG.fits.groups.labels.length;
  if (partG.fits.groups.status === 'ok' && partG.fits.groups.clusters) {
    partG.fits.groups = { ...partG.fits.groups, temporal: partG.fits.groups.temporal.map((r, i) => r.map((x, j) => (i === 0 && j === gl - 1 ? NaN : x))), estimable: { ...partG.fits.groups.estimable, temporal: false } };
    const gm = varNetworkViews(partG)[1].views.find((v) => v.title === 'Temporal, seats as clusters');
    assert.ok(isSvg(gm.svg) && /Partly estimable/.test(gm.warning), 'MCML drawn from the finite cells, warned');
  }

  // matrixModel is glue only: the weights go in as given, [from][to].
  const model = matrixModel(['x', 'y'], [[0, 0.4], [-0.2, 0]]);
  assert.deepEqual(model.labels, ['x', 'y']);
  assert.equal(model.weights.get(0, 1), 0.4);
  assert.equal(model.weights.get(1, 0), -0.2);
}

// ─── VAR errors carry codes; one group → groups-as-subjects unavailable ────
{
  const cat = fitVarNetworks({ rows: ALL, group_id: 'G1', channels: ['arousal', 'screen_gaze.aoi'] });
  for (const k of ['members', 'groups', 'graphicalvar']) {
    assert.equal(cat.fits[k].status, 'error');
    assert.deepEqual([cat.fits[k].error.source, cat.fits[k].error.code], ['ladyna', 'synchrony_bad_input']);
  }
  const one = fitVarNetworks({ rows: ALL, group_id: 'G1', channels: ['arousal'] });
  assert.equal(one.fits.members.status, 'error');
  assert.deepEqual([one.fits.members.error.source, one.fits.members.error.code], ['psychaj', 'psychaj_error']);
  assert.match(one.fits.members.error.message, /at least 2 variables/);

  const single = fitVarNetworks({ rows: TIMELINES.G1, group_id: 'G1', channels: ['arousal', 'valence'] });
  assert.equal(single.fits.groups.status, 'unavailable');
  assert.match(single.fits.groups.reason, /at least 2 groups/);
  assert.equal(single.fits.graphicalvar.status, 'ok');
  const unavailable = varNetworkViews(single).find((s) => s.id === 'groups');
  assert.equal(unavailable.views.length, 0);

  throwsCode(() => fitVarNetworks({ rows: ALL, group_id: 'nope', channels: ['arousal'] }), GroupVarError, 'group_var_unknown_group');
  throwsCode(() => fitVarNetworks({ rows: [], group_id: 'G1', channels: ['arousal'] }), GroupVarError, 'group_var_empty');
  throwsCode(() => fitVarNetworks({ rows: ALL, group_id: 'G1', channels: [] }), GroupVarError, 'group_var_bad_input');
  throwsCode(() => fitVarNetworks({ rows: ALL, group_id: 'G1', channels: ['arousal'], scope: 'x' }), GroupVarError, 'group_var_bad_input');
  throwsCode(() => fitVarNetworks(null), GroupVarError, 'group_var_bad_input');

  // The result survives structured cloning (the worker's postMessage), NaN included.
  const cloned = structuredClone(FIT);
  assert.equal(nonFiniteCells(cloned.fits.groups.between), nonFiniteCells(FIT.fits.groups.between));
}

// ─── the six-group demo loads as six groups ───────────────────────────────
{
  const built = buildTimelines(parseGroupInput(demoGroupRows({ n_groups: 3, duration_s: 120 })));
  assert.deepEqual(built.group_ids, ['DEMO-1', 'DEMO-2', 'DEMO-3']);
  assert.notDeepEqual(
    built.timelines['DEMO-1'].slice(0, 5).map((r) => r.value),
    built.timelines['DEMO-2'].slice(0, 5).map((r) => r.value),
    'each demo group has its own seed',
  );
}

console.log('app-group-networks: OK');
