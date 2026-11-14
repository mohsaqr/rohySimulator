// Pure-logic tests for the group-synchrony dashboard's view-model layer
// (standalone/app/src/lib/groupDashboard.js). Plain node, throws on failure.
//
// It resolves `ladyna` from standalone/app/node_modules, so it runs in the
// mini-ci `types` job (after `npm --prefix standalone/app ci`), not in the
// main `npm test` chain. ladyna's own numbers are ladyna's tests; this file
// checks parsing, live de-dup, the brush, CSV format and the view-model shape.

import assert from 'node:assert/strict';
import {
  parseGroupInput,
  GroupDashboardError,
  createLiveStore,
  applyHubMessage,
  liveInput,
  hubStreamUrl,
  buildTimelines,
  filterSpan,
  timeExtent,
  toCsv,
  computeDashboard,
  channelRibbons,
  regimePanels,
  REGIME_COLOURS,
  exportFiles,
  bundleFile,
  demoRows,
  methodOptions,
  defaultMethod,
  channelClass,
  memberClock,
  BUNDLE_SCHEMA,
} from '../standalone/app/src/lib/groupDashboard.js';

const throwsCode = (fn, code) => assert.throws(fn, (err) => err instanceof GroupDashboardError && err.code === code, `expected ${code}`);

// ─── windows fixture: two members, raw affect streams ───────────────────────
const T0 = Date.parse('2026-11-13T10:00:00.000Z');
function win(member, k, { group = 'G1', offset = 0, rtt = 20 } = {}) {
  const start = T0 + k * 10000;
  const rows = Array.from({ length: 10 }, (_, i) => {
    const ts = start + i * 1000;
    const a = Math.sin((k * 10 + i) / 4) + (member === 'b' ? 0.2 : 0);
    return [ts, ts + offset, 0.1 * i, a, member === 'b' && i < 3 ? 0.3 : 0.9, i % 2 ? 'happy' : 'neutral', 1];
  });
  return {
    group_id: group,
    member_id: member,
    seat: member === 'a' ? 'left' : 'right',
    session_id: `s-${member}`,
    window_start: new Date(start).toISOString(),
    window_end: new Date(start + 10000).toISOString(),
    clock_offset_ms: offset,
    clock_rtt_ms: rtt,
    clock_source: 'hub',
    raw_streams: {
      affect: { fields: ['ts_ms', 'ts_group_ms', 'valence', 'arousal', 'confidence', 'label', 'face_present'], rows },
    },
  };
}
const WINDOWS = [0, 1, 2, 3, 4, 5].flatMap((k) => [win('a', k), win('b', k)]);

// ─── parsing ───────────────────────────────────────────────────────────────
{
  const bundle = { schema_version: BUNDLE_SCHEMA, group_id: 'G1', windows: WINDOWS, markers: [{ type: 'marker', marker_id: 'G1-k1', group_ms: T0 + 5000, label: 'start' }] };
  const p = parseGroupInput(JSON.stringify(bundle));
  assert.equal(p.source, 'bundle');
  assert.equal(p.windows.length, 12);
  assert.equal(p.markers.length, 1);
  assert.deepEqual(p.group_ids, ['G1']);

  const bare = parseGroupInput(WINDOWS);
  assert.equal(bare.source, 'windows');
  assert.equal(bare.schema_version, null);

  const rows = parseGroupInput([{ group_id: 'X', member_id: 'm1', channel: 'arousal', t_s: 0, value: 1 }]);
  assert.equal(rows.source, 'rows');
  assert.equal(rows.rows.length, 1);

  throwsCode(() => parseGroupInput('{not json'), 'group_dashboard_bad_json');
  throwsCode(() => parseGroupInput({ schema_version: 'oyon-group-bundle-v0', windows: WINDOWS }), 'group_dashboard_bad_schema');
  throwsCode(() => parseGroupInput({ windows: WINDOWS }), 'group_dashboard_bad_schema');
  throwsCode(() => parseGroupInput(42), 'group_dashboard_bad_schema');
  throwsCode(() => parseGroupInput([]), 'group_dashboard_empty');
  throwsCode(() => parseGroupInput({ schema_version: BUNDLE_SCHEMA, windows: [] }), 'group_dashboard_empty');
  throwsCode(() => parseGroupInput([{ foo: 1 }]), 'group_dashboard_bad_input');
  throwsCode(() => parseGroupInput([WINDOWS[0], { group_id: 'G1', member_id: 'm1', channel: 'arousal', t_s: 0 }]), 'group_dashboard_bad_input');
  throwsCode(() => parseGroupInput([{ ...WINDOWS[0], group_id: undefined }]), 'group_dashboard_missing_context');
  throwsCode(() => parseGroupInput([{ member_id: 'm1', channel: 'arousal', t_s: 0 }]), 'group_dashboard_missing_context');
}

// ─── live accumulation: replay duplicates ignored, live re-sends replace ─────
{
  const store = createLiveStore();
  assert.equal(applyHubMessage(store, { type: 'hello', group_id: 'G1', n_buffered: 2 }).type, 'hello');
  assert.equal(applyHubMessage(store, { type: 'windows', replay: true, events: [WINDOWS[0], WINDOWS[1]] }).changed, true);
  assert.equal(store.windows.size, 2);
  // The same windows replayed again (a reconnect): ignored.
  const again = applyHubMessage(store, JSON.stringify({ type: 'windows', replay: true, events: [WINDOWS[0], WINDOWS[1]] }));
  assert.equal(again.changed, false);
  assert.equal(store.windows.size, 2);
  assert.equal(store.replay_duplicates, 2);
  // A live re-send of a held window replaces it (the hub's latest-wins rule).
  const resent = { ...WINDOWS[0], note: 'resent' };
  assert.equal(applyHubMessage(store, { type: 'windows', replay: false, events: [resent, WINDOWS[2]] }).changed, true);
  assert.equal(store.windows.size, 3);
  assert.equal(store.live_replaced, 1);
  assert.equal(liveInput(store).windows.find((w) => w.member_id === 'a' && w.window_start === WINDOWS[0].window_start).note, 'resent');
  // Markers de-duplicate on marker_id.
  applyHubMessage(store, { type: 'marker', marker_id: 'G1-k1', group_ms: T0, label: 'go', replay: true });
  applyHubMessage(store, { type: 'marker', marker_id: 'G1-k1', group_ms: T0, label: 'go' });
  assert.equal(store.markers.length, 1);
  assert.equal('replay' in store.markers[0], false);
  // Codex #15: the content revision moves on a replacement (count unchanged)
  // and on a marker; the dashboard keys every analysis on it, not on the count.
  const before = { size: store.windows.size, version: store.version };
  applyHubMessage(store, { type: 'windows', replay: false, events: [{ ...WINDOWS[1], note: 'replaced' }] });
  assert.equal(store.windows.size, before.size, 'a replacement keeps the window count');
  assert.equal(store.version, before.version + 1, 'but moves the version');
  applyHubMessage(store, { type: 'marker', marker_id: 'G1-k2', group_ms: T0 + 1000, label: 'two' });
  assert.equal(store.version, before.version + 2, 'a marker moves it too');
  {
    const { readFileSync } = await import('node:fs');
    const model = readFileSync(new URL('../standalone/app/src/routes/group/model.tsx', import.meta.url), 'utf8');
    const groupStore = readFileSync(new URL('../standalone/app/src/lib/groupStore.ts', import.meta.url), 'utf8');
    assert.match(model, /`live:\$\{hubRevision\}`/, 'live dataKey is the content revision');
    assert.doesNotMatch(model, /live:\$\{hubWindows\}/, 'not the window count');
    assert.match(groupStore, /revision: `\$\{connectionSeq\}:\$\{buffer\.version\}`/, 'revision = connection + buffer version');
  }
  // Garbage is recorded, not thrown.
  assert.equal(applyHubMessage(store, 'not json').type, 'invalid');
  assert.equal(store.errors.length, 1);
  const input = liveInput(store);
  assert.equal(input.source, 'live');
  assert.deepEqual(input.group_ids, ['G1']);

  assert.equal(hubStreamUrl('http://127.0.0.1:8787/', 'G 7'), 'ws://127.0.0.1:8787/groups/G%207/stream');
  assert.equal(hubStreamUrl('https://hub.example', 'G1'), 'wss://hub.example/groups/G1/stream');
  throwsCode(() => hubStreamUrl('ftp://x', 'G1'), 'group_dashboard_bad_input');
  throwsCode(() => hubStreamUrl('http://x', ' '), 'group_dashboard_bad_input');
}

// ─── timelines from windows (via oyon/group groupTimeline) and the brush ────
{
  const built = buildTimelines(parseGroupInput(WINDOWS));
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.group_ids, ['G1']);
  for (const c of ['valence', 'arousal', 'emotion', 'emotion.confidence']) assert.ok(built.channels.includes(c), `channel ${c}`);
  const tl = built.timelines.G1;
  assert.ok(tl.length > 0);
  const ext = timeExtent(tl);
  assert.equal(ext.min_s, 0);
  assert.equal(ext.max_s, 59);

  const brushed = filterSpan(tl, { start_s: 10, end_s: 20 });
  assert.ok(brushed.length > 0);
  assert.ok(brushed.every((r) => r.t_s >= 10 && r.t_s <= 20));
  // Bounds are inclusive and every channel × member keeps its ticks.
  assert.equal(brushed.filter((r) => r.channel === 'arousal' && r.member_id === 'a').length, 11);
  assert.equal(filterSpan(tl, {}).length, tl.length);
  assert.equal(filterSpan(tl, { start_s: 30 }).every((r) => r.t_s >= 30), true);
  throwsCode(() => filterSpan(tl, { start_s: 20, end_s: 10 }), 'group_dashboard_bad_span');

  // Person-z is ladyna normalizeTimeline over Oyon's physical-unit rows: each
  // member × continuous channel has mean 0 and SD 1, value_raw is untouched.
  const ar = tl.filter((r) => r.channel === 'arousal' && r.member_id === 'a' && typeof r.value === 'number');
  const m = ar.reduce((a, r) => a + r.value, 0) / ar.length;
  const sdv = Math.sqrt(ar.reduce((a, r) => a + (r.value - m) ** 2, 0) / (ar.length - 1));
  assert.ok(Math.abs(m) < 1e-9 && Math.abs(sdv - 1) < 1e-9, `person-z: mean ${m}, sd ${sdv}`);
  const raw = buildTimelines(parseGroupInput(WINDOWS), { normalize: 'none' }).timelines.G1;
  assert.ok(raw.filter((r) => r.kind === 'continuous').every((r) => r.value === r.value_raw));

  const clocks = memberClock(WINDOWS, 'G1');
  assert.deepEqual(clocks.a, { clock_offset_ms: 0, clock_rtt_ms: 20, clock_source: 'hub' });
}

// ─── CSV: RFC 4180 quoting, CRLF, null → empty, extra keys kept ─────────────
{
  const csv = toCsv([
    { a: 1, b: 'plain', c: null },
    { a: 2.5, b: 'has,comma', c: 'say "hi"' },
    { a: -0, b: 'line\nbreak', c: true, extra: 'x' },
  ], ['a', 'b', 'c']);
  assert.equal(csv,
    'a,b,c,extra\r\n'
    + '1,plain,,\r\n'
    + '2.5,"has,comma","say ""hi""",\r\n'
    + '0,"line\nbreak",true,x\r\n');
  assert.equal(toCsv([{ v: NaN, w: undefined, o: { k: 'v,w' } }]), 'v,w,o\r\n,,"{""k"":""v,w""}"\r\n');
  assert.equal(toCsv([], ['x', 'y']), 'x,y\r\n');
}

// ─── method selection per channel class ─────────────────────────────────────
{
  assert.equal(channelClass('arousal', 'continuous'), 'continuous');
  assert.equal(channelClass('respiration.brpm', 'continuous'), 'oscillatory');
  assert.equal(channelClass('screen_gaze.aoi', 'categorical'), 'categorical');
  assert.equal(defaultMethod('arousal', 'continuous'), 'wcc');
  assert.equal(defaultMethod('respiration.brpm', 'continuous'), 'plv');
  assert.equal(defaultMethod('screen_gaze.aoi', 'categorical'), 'joint_attention');
  assert.equal(defaultMethod('emotion', 'categorical'), 'crqa');
  const cat = methodOptions('emotion', 'categorical').map((m) => m.method);
  assert.ok(cat.includes('crqa') && cat.includes('joint_attention') && !cat.includes('wcc'));
  assert.equal(methodOptions('arousal', 'continuous').filter((m) => m.is_default).length, 1);
}

// ─── computeDashboard on simulated data: view-model shapes ──────────────────
{
  const rows = demoRows({ seed: 5, duration_s: 300 });
  assert.ok(rows.length > 0);
  assert.deepEqual([...new Set(rows.map((r) => r.channel))].sort(), ['arousal', 'emotion', 'oscillator', 'screen_gaze.aoi', 'valence']);
  // The emotion channel is categorical labels, neutral the most common.
  const emotion = rows.filter((r) => r.channel === 'emotion' && r.state !== null);
  assert.ok(emotion.every((r) => r.kind === 'categorical' && r.value === null));
  const counts = {};
  for (const r of emotion) counts[r.state] = (counts[r.state] ?? 0) + 1;
  assert.equal(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0], 'neutral');
  const input = parseGroupInput(rows);
  const { timelines, group_ids } = buildTimelines(input);
  assert.deepEqual(group_ids, ['DEMO']);
  const tl = timelines.DEMO;

  const view = computeDashboard(tl, { channel: 'arousal', method: 'wcc', null: { n: 19, seed: 3 } });
  // The members page: ribbons for every channel, the dashboard's own for the selected one.
  assert.deepEqual(channelRibbons(tl, 'arousal'), view.ribbons);
  for (const c of ['arousal', 'emotion', 'oscillator', 'screen_gaze.aoi', 'valence']) {
    const rb = channelRibbons(tl, c);
    assert.deepEqual(rb.map((r) => r.member_id), ['m1', 'm2', 'm3'], c);
    assert.equal(rb[0].kind, ['emotion', 'screen_gaze.aoi'].includes(c) ? 'categorical' : 'continuous', c);
  }
  assert.throws(() => channelRibbons(tl, 'nope'));
  // The regimes page: every kind at once, each the dashboard's own when selected, with a ladyna network.
  const panels = regimePanels(tl);
  assert.deepEqual(panels.map((p) => p.kind), ['affect', 'arousal', 'attention']);
  const arousal = panels.find((p) => p.kind === 'arousal');
  const viewArousal = computeDashboard(tl, { channel: 'arousal', method: 'wcc', regime_kind: 'arousal' }).regime;
  assert.deepEqual(arousal.transitions, viewArousal.transitions);
  assert.deepEqual(arousal.rows, viewArousal.rows);
  for (const p of panels) {
    assert.ok(p.rows.length > 1 && p.network && p.network.startsWith('<svg'), p.kind);
    assert.deepEqual(p.errors, [], p.kind);
    const seen = new Set(p.rows.map((r) => r.regime));
    for (const s of seen) if (REGIME_COLOURS[s]) assert.ok(p.network.includes(REGIME_COLOURS[s]), `${p.kind}: ${s} coloured`);
  }
  assert.throws(() => regimePanels([]), (e) => e.code === 'group_dashboard_empty');
  assert.deepEqual(view.errors, [], JSON.stringify(view.errors));
  assert.equal(view.group_id, 'DEMO');
  assert.equal(view.method, 'wcc');
  assert.equal(view.measure, 'r_peak');
  assert.ok(view.measures.includes('r_zero_lag'));
  assert.equal(view.channel_class, 'continuous');
  assert.equal(view.evidence, 'primary');
  assert.deepEqual(view.members.map((m) => m.member_id), ['m1', 'm2', 'm3']);
  for (const m of view.members) {
    assert.ok(m.quality_share >= 0 && m.quality_share <= 1);
    assert.equal(m.clock_offset_ms, null); // window-free rows carry no clock
  }
  // Strip: one row per window, with the null band when a null was computed.
  assert.ok(view.strip.length > 0);
  assert.deepEqual(view.null, { method: 'circular_shift', n: 19, seed: 3, pool_groups: 0 });
  for (const s of view.strip) {
    assert.ok(s.window_end_s > s.window_start_s);
    assert.ok('null_lo' in s && 'null_hi' in s && 'outside' in s);
  }
  assert.ok(view.strip.some((s) => s.null_lo !== null && s.null_hi !== null && s.null_lo <= s.null_hi));
  // Matrix: n × n, diagonal empty, symmetric values, lead flips with the side.
  assert.equal(view.matrix.cells.length, 3);
  view.matrix.cells.forEach((row, i) => {
    assert.equal(row.length, 3);
    assert.equal(row[i], null);
  });
  const c01 = view.matrix.cells[0][1]; const c10 = view.matrix.cells[1][0];
  assert.equal(c01.value, c10.value);
  if (c01.lead === 'row') assert.equal(c10.lead, 'col');
  if (c01.lead === 'col') assert.equal(c10.lead, 'row');
  assert.equal(view.pairs.length, 3);
  // The leader is ladyna's, from the WCC lag: m1 drives m2 and m3 in the demo.
  for (const p of view.pairs) {
    assert.equal(p.lead_source, 'r_peak');
    if (p.lag_s !== null && p.lag_s !== 0) assert.equal(p.leader, p.lag_s > 0 ? p.member_a : p.member_b);
  }
  assert.equal(view.pairs.find((p) => p.pair === 'm1~m2').leader, 'm1');
  // The strip's outside flag is surrogateNull's.
  for (const s of view.strip) if (s.outside !== null) assert.equal(s.outside, s.value < s.null_lo || s.value > s.null_hi);
  // Ribbon quality is ladyna's qualitySummary.
  for (const rb of view.ribbons) assert.equal(rb.quality_share, rb.points.filter((p) => p.quality >= 0.5).length / rb.points.length);
  for (const m of view.members) assert.equal(m.quality_reading, m.quality_share >= 0.8 ? 'good' : m.quality_share >= 0.5 ? 'fair' : 'poor');
  assert.ok(view.pairs.every((p) => 'z' in p && 'p_null' in p && 'overlap' in p));
  // Ribbons: one per member; low-quality spans are listed, not removed.
  assert.equal(view.ribbons.length, 3);
  for (const r of view.ribbons) {
    assert.equal(r.points.length, r.n_ticks);
    assert.ok(Array.isArray(r.low_quality_spans));
  }
  assert.ok(view.ribbons.some((r) => r.low_quality_spans.length > 0), 'simulated missing blocks must show as hatched spans');
  // Events, regimes, joint attention, member indices.
  assert.ok(Array.isArray(view.events));
  for (const e of view.events) assert.ok(['shared_arousal', 'out_of_sync', 'sparse', 'attention_break', 'marker'].includes(e.kind) && typeof e.label === 'string');
  assert.equal(view.events_channel, 'arousal');
  assert.equal(view.attention_channel, 'screen_gaze.aoi');
  // The demo has emotion labels, so the affect regime is available and comes first.
  assert.equal(view.regime.kind, 'affect');
  assert.deepEqual(view.regime.kinds, ['affect', 'arousal', 'attention']);
  assert.ok(view.regime.rows.length > 0);
  assert.ok(view.regime.transitions.every((t) => typeof t.from === 'string' && t.count > 0));
  // The row share is ladyna tna's transition probability: count / transitions out of `from`.
  for (const t of view.regime.transitions) {
    const out = view.regime.transitions.filter((u) => u.from === t.from).reduce((a, u) => a + u.count, 0);
    assert.ok(Math.abs(t.prob - t.count / out) < 1e-12, `prob ${t.from}→${t.to}`);
  }
  assert.equal(view.joint_attention.length, 3);
  assert.ok(view.joint_attention.every((p) => 'p_joint' in p && 'initiation_balance' in p));
  assert.equal(view.member_indices.length, 3);
  assert.ok(typeof view.rho_group === 'number');

  // Exports: the five files, headers as documented.
  const files = exportFiles(view);
  assert.deepEqual(files.map((f) => f.name), ['timeline.csv', 'pairs.csv', 'group.csv', 'regimes.csv', 'coding.json']);
  assert.ok(files[0].content.startsWith('group_id,member_id,seat,t_s,t_group_ms,channel,kind,value,value_raw,state,quality,source'));
  assert.ok(files[1].content.startsWith('group_id,pair,member_a,member_b,channel,method,measure,scope,window_start_s,window_end_s,value,lag_s,overlap,n,null_method'));
  assert.ok(files[3].content.startsWith('group_id,kind,channel,bin,bin_start_s,bin_end_s,regime'));
  const coding = JSON.parse(files[4].content);
  assert.equal(coding.schema_version, 'oyon-group-coding-v1');
  assert.ok(coding.rules.length > 0);
  // The rows file reads back through the parser.
  assert.equal(parseGroupInput(bundleFile(input, 'DEMO').content).source, 'rows');

  // Brushed: every panel recomputes on the span.
  const brushed = computeDashboard(tl, { channel: 'arousal', span: { start_s: 60, end_s: 180 } });
  assert.equal(brushed.span.start_s, 60);
  assert.equal(brushed.span.end_s, 180);
  assert.ok(brushed.tables.timeline.every((r) => r.t_s >= 60 && r.t_s <= 180));
  assert.ok(brushed.strip.every((s) => s.window_start_s >= 60));
  assert.ok(brushed.regime.rows.every((r) => r.bin_end_s > 60));
  assert.equal(brushed.null, null);
  assert.ok(brushed.strip.every((s) => s.outside === null));

  // Categorical channel: joint attention by default. It estimates no lag, so no one leads.
  const ja = computeDashboard(tl, { channel: 'screen_gaze.aoi' });
  assert.deepEqual(ja.errors, [], JSON.stringify(ja.errors));
  assert.equal(ja.method, 'joint_attention');
  assert.equal(ja.measure, 'p_joint');
  assert.equal(ja.pairs.length, 3);
  assert.ok(ja.pairs.every((p) => p.leader === null && p.lead_source === null));
  assert.ok(ja.matrix.cells.flat().every((c) => c === null || c.lead === null));
  // PLV: a phase difference is not a lead either.
  const plv = computeDashboard(tl, { channel: 'oscillator', method: 'plv' });
  assert.ok(plv.pairs.every((p) => p.leader === null));

  // A verb's refusal is reported per panel, never thrown away silently.
  const bad = computeDashboard(tl, { channel: 'arousal', method: 'nope' });
  assert.ok(bad.errors.some((e) => e.panel === 'pairs' && e.code === 'synchrony_unknown_method'), JSON.stringify(bad.errors));

  throwsCode(() => computeDashboard(tl, { channel: 'missing' }), 'group_dashboard_unknown_channel');
  throwsCode(() => computeDashboard([], { channel: 'arousal' }), 'group_dashboard_empty');
  throwsCode(() => computeDashboard(tl, { channel: 'arousal', span: { start_s: 900, end_s: 950 } }), 'group_dashboard_empty');

  // Several groups: pseudo-group null with the other groups as the pool.
  const pool = [1, 2, 3, 4].map((g) => demoRows({ seed: 20 + g, duration_s: 300, group_id: `P${g}` }));
  const pg = computeDashboard(tl, { channel: 'arousal', null: { n: 9, pool } });
  assert.deepEqual(pg.errors, [], JSON.stringify(pg.errors));
  assert.equal(pg.null.method, 'pseudo_group');
  assert.equal(pg.null.pool_groups, 4);
}

// ─── windows → dashboard end to end (markers placed on the group clock) ─────
{
  const input = parseGroupInput({ schema_version: BUNDLE_SCHEMA, group_id: 'G1', windows: WINDOWS, markers: [{ marker_id: 'G1-k1', group_ms: T0 + 5000, label: 'start' }] });
  const { timelines } = buildTimelines(input);
  const view = computeDashboard(timelines.G1, { channel: 'arousal', windows: input.windows, markers: input.markers });
  const marker = view.events.find((e) => e.kind === 'marker');
  assert.equal(marker.start_s, 5);
  assert.equal(marker.label, 'marker: start');
  assert.equal(view.members.find((m) => m.member_id === 'a').clock_rtt_ms, 20);
  assert.equal(view.regime.kind, 'affect');
  const bundle = JSON.parse(bundleFile(input, 'G1').content);
  assert.equal(bundle.schema_version, BUNDLE_SCHEMA);
  assert.equal(bundle.windows.length, 12);
}

console.log('app-group-dashboard: ok');
