/*
 * Group-synchrony dashboard — pure view-model layer (no React, node-testable).
 *
 * Rule: NO analysis code here. Every measure, null, event and sequence comes
 * from ladyna (`ladyna/synchrony`; the regime transition counts from
 * `ladyna/core` ftna). Oyon contributes only `groupTimeline()` — n members'
 * windows → one long table. This module parses inputs, keeps the live window
 * buffer, filters the time span (the brush), calls ladyna, shapes the results
 * for the panels and writes the export files.
 *
 * Data policy (Oyon CLAUDE.md): nothing is dropped. Low-quality ticks are
 * flagged (hatched spans), and a ladyna verb that refuses an input is reported
 * per panel in `errors` with its code — never swallowed.
 *
 * `oyon/group` is imported by relative path: the app reaches it through a Vite
 * alias, but this file must also run under plain node (tests/app-group-
 * dashboard.test.js), where the alias does not exist.
 */
import {
  pairwiseSynchrony,
  meanPairwise,
  groupSynchrony,
  arousalEvents,
  jointAttention,
  jointAttentionBreaks,
  surrogateNull,
  codeStates,
  regimeSequence,
  codingTable,
  listPairwiseMethods,
  channelMatrix,
  qualitySummary,
  channelInventory,
  simulateGroup,
  stimulusEnvelope,
  toSequences,
  DIRECTIONAL_MEASURES,
  normalizeTimeline,
} from 'ladyna/synchrony';
import { ftna, tna, plotNetwork } from 'ladyna/core';
import {
  groupTimeline,
  listGroupChannels,
  channelSpec,
  checkGroupContext,
} from '../../../../src/group/index.js';

export const BUNDLE_SCHEMA = 'oyon-group-bundle-v1';
export const CODING_SCHEMA = 'oyon-group-coding-v1';

/** Okabe-Ito, the only palette the dashboard draws with (always paired with a shape or label). */
export const OKABE_ITO = Object.freeze({
  orange: '#E69F00',
  sky: '#56B4E9',
  green: '#009E73',
  yellow: '#F0E442',
  blue: '#0072B2',
  vermillion: '#D55E00',
  purple: '#CC79A7',
  grey: '#999999',
  black: '#000000',
});

/** One colour per regime (Okabe–Ito), shared by the band and the transition network. */
export const REGIME_COLOURS = Object.freeze({
  convergent_positive: OKABE_ITO.green,
  convergent_negative: OKABE_ITO.vermillion,
  convergent_neutral: OKABE_ITO.sky,
  split: OKABE_ITO.yellow,
  out_of_sync: OKABE_ITO.purple,
  all_on_screen: OKABE_ITO.green,
  joint_partner: OKABE_ITO.blue,
  divided: OKABE_ITO.yellow,
  off: OKABE_ITO.vermillion,
  all_high: OKABE_ITO.orange,
  mixed: OKABE_ITO.sky,
  all_low: OKABE_ITO.blue,
  sparse: '#dddddd',
});

/** Tick quality below this is drawn hatched (flagged, never hidden). */
export const LOW_QUALITY = 0.5;

/** Surrogate count used by the dashboard: modest, so a null takes about a second. */
export const DEFAULT_NULL_N = 49;

/** The measure each method's strip and matrix show first. */
export const PRIMARY_MEASURE = Object.freeze({
  wcc: 'r_peak',
  pci: 'r',
  ssi: 'ssi',
  sync_cycles: 'sync_cycles',
  concordance: 'concordance',
  crqa: 'rr',
  plv: 'plv',
  dtw: 'dtw_norm',
  joint_attention: 'p_joint',
});


const GAZE_CHANNELS = ['screen_gaze.aoi', 'screen_gaze.zone', 'gaze.zone'];
const OSCILLATORY = /^(respiration\.|oscillator$)/;

export const TIMELINE_COLUMNS = Object.freeze([
  'group_id', 'member_id', 'seat', 't_s', 't_group_ms', 'channel', 'kind',
  'value', 'value_raw', 'state', 'quality', 'source',
]);
const NULL_COLUMNS = ['null_method', 'null_n', 'null_mean', 'null_sd', 'null_lo', 'null_hi', 'z', 'p_null'];
export const PAIR_COLUMNS = Object.freeze([
  'group_id', 'pair', 'member_a', 'member_b', 'channel', 'method', 'measure', 'scope',
  'window_start_s', 'window_end_s', 'value', 'lag_s', 'overlap', 'n', ...NULL_COLUMNS,
]);
export const GROUP_COLUMNS = Object.freeze([
  'group_id', 'channel', 'method', 'measure', 'member_id', 'scope', 'window_start_s', 'window_end_s',
  'value', 'overlap', 'n', 'n_pairs', 'params', ...NULL_COLUMNS,
]);
export const REGIME_COLUMNS = Object.freeze([
  'group_id', 'kind', 'channel', 'bin', 'bin_start_s', 'bin_end_s', 'regime', 'n_members', 'n_valid',
  'modal_state', 'modal_share', 'mean_valence', 'da',
]);

/** Classed error for inputs the dashboard cannot read; `code` is the contract. */
export class GroupDashboardError extends Error {
  constructor(message, code = 'group_dashboard_bad_input') {
    super(message);
    this.name = 'GroupDashboardError';
    this.code = code;
  }
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ── input ─────────────────────────────────────────────────────────────────

function isTimelineRow(r) {
  return isObj(r) && typeof r.member_id === 'string' && typeof r.channel === 'string' && isNum(r.t_s);
}

function isWindow(r) {
  return isObj(r) && typeof r.member_id === 'string'
    && (typeof r.window_start === 'string' || typeof r.window_end === 'string' || isObj(r.raw_streams));
}

/**
 * Read a dashboard input: an `oyon-group-bundle-v1` export of the group hub, a
 * bare array of Oyon window events, or a bare array of long-table rows
 * (`groupTimeline()` / ladyna `SyncRow`). Anything else is refused.
 *
 * @param {string|object|Array} input JSON text or the parsed value
 * @returns {{ source: 'bundle'|'windows'|'rows', schema_version: string|null, windows: object[], rows: object[], markers: object[], group_ids: string[] }}
 * @throws GroupDashboardError codes `group_dashboard_bad_json`, `group_dashboard_bad_schema`,
 *   `group_dashboard_bad_input`, `group_dashboard_empty`, `group_dashboard_missing_context`
 */
export function parseGroupInput(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      throw new GroupDashboardError(`the file is not JSON (${err.message})`, 'group_dashboard_bad_json');
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw new GroupDashboardError('the array is empty: no windows or timeline rows', 'group_dashboard_empty');
    if (value.every(isTimelineRow)) {
      const missing = value.findIndex((r) => typeof r.group_id !== 'string' || !r.group_id);
      if (missing >= 0) throw new GroupDashboardError(`timeline row ${missing} has no group_id`, 'group_dashboard_missing_context');
      return { source: 'rows', schema_version: null, windows: [], rows: value, markers: [], group_ids: distinct(value.map((r) => r.group_id)) };
    }
    if (value.every(isWindow)) return windowsInput('windows', null, value, []);
    const bad = value.findIndex((r) => !isTimelineRow(r) && !isWindow(r));
    throw new GroupDashboardError(
      bad >= 0
        ? `element ${bad} is neither an Oyon window (member_id + window_start/raw_streams) nor a timeline row (member_id, channel, t_s)`
        : 'the array mixes windows and timeline rows; give one kind',
      'group_dashboard_bad_input',
    );
  }
  if (isObj(value)) {
    if (value.schema_version !== BUNDLE_SCHEMA) {
      throw new GroupDashboardError(
        value.schema_version != null
          ? `unsupported schema_version '${String(value.schema_version)}'; expected '${BUNDLE_SCHEMA}'`
          : `expected an '${BUNDLE_SCHEMA}' bundle, a windows array, or a timeline rows array`,
        'group_dashboard_bad_schema',
      );
    }
    if (!Array.isArray(value.windows)) throw new GroupDashboardError('the bundle has no `windows` array', 'group_dashboard_bad_input');
    if (value.windows.length === 0) throw new GroupDashboardError('the bundle holds no windows', 'group_dashboard_empty');
    const notWindow = value.windows.findIndex((w) => !isWindow(w));
    if (notWindow >= 0) throw new GroupDashboardError(`bundle window ${notWindow} is not an Oyon window event`, 'group_dashboard_bad_input');
    const markers = Array.isArray(value.markers) ? value.markers : [];
    return windowsInput('bundle', BUNDLE_SCHEMA, value.windows, markers);
  }
  throw new GroupDashboardError(`expected an '${BUNDLE_SCHEMA}' bundle, a windows array, or a timeline rows array`, 'group_dashboard_bad_schema');
}

function windowsInput(source, schema, windows, markers) {
  const bad = checkGroupContext(windows);
  if (bad.length) {
    throw new GroupDashboardError(
      `${bad.length} window(s) lack group context (first: window ${bad[0].index}, missing ${bad[0].missing})`,
      'group_dashboard_missing_context',
    );
  }
  return { source, schema_version: schema, windows, rows: [], markers, group_ids: distinct(windows.map((w) => w.group_id)) };
}

function distinct(xs) {
  return [...new Set(xs)].sort();
}

// ── live accumulation ────────────────────────────────────────────────────

/** An empty live buffer for hub stream messages. */
export function createLiveStore() {
  return {
    windows: new Map(),
    markers: [],
    marker_ids: new Set(),
    hello: null,
    version: 0,
    replay_duplicates: 0,
    live_replaced: 0,
    errors: [],
  };
}

/** The hub's own window key (examples/group-hub/server.mjs). */
export function windowKey(w) {
  return `${w.member_id}|${w.window_start ?? w.window_id ?? w.hub_received_ms}`;
}

/**
 * Apply one hub WebSocket message (`hello` | `windows` | `marker` | `error`).
 * Windows de-duplicate on `member_id|window_start`: a replayed copy of a window
 * already held is ignored; a live re-send replaces it (the hub's latest-wins rule).
 *
 * @returns {{ changed: boolean, type: string }}
 */
export function applyHubMessage(store, message) {
  const msg = typeof message === 'string' ? safeParse(message) : message;
  if (!isObj(msg)) {
    store.errors.push({ type: 'bad_message', message: 'a stream message was not a JSON object' });
    return { changed: false, type: 'invalid' };
  }
  if (msg.type === 'hello') {
    store.hello = msg;
    return { changed: false, type: 'hello' };
  }
  if (msg.type === 'windows') {
    let changed = false;
    for (const w of Array.isArray(msg.events) ? msg.events : []) {
      if (!isObj(w) || typeof w.member_id !== 'string') continue;
      const key = windowKey(w);
      if (store.windows.has(key)) {
        if (msg.replay === true) { store.replay_duplicates += 1; continue; }
        store.live_replaced += 1;
        store.windows.delete(key);
      }
      store.windows.set(key, w);
      changed = true;
    }
    if (changed) store.version += 1;
    return { changed, type: 'windows' };
  }
  if (msg.type === 'marker') {
    const id = msg.marker_id ?? `${msg.group_ms}|${msg.label ?? ''}`;
    if (store.marker_ids.has(id)) return { changed: false, type: 'marker' };
    store.marker_ids.add(id);
    const { replay: _replay, ...marker } = msg;
    store.markers.push(marker);
    store.version += 1;
    return { changed: true, type: 'marker' };
  }
  if (msg.type === 'error') {
    store.errors.push({ type: String(msg.error ?? 'error'), message: String(msg.message ?? '') });
    return { changed: false, type: 'error' };
  }
  return { changed: false, type: String(msg.type ?? 'unknown') };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** The live buffer as a dashboard input (same shape as `parseGroupInput`). */
export function liveInput(store) {
  const windows = [...store.windows.values()].filter((w) => typeof w.group_id === 'string' && w.group_id);
  return { source: 'live', schema_version: null, windows, rows: [], markers: store.markers.slice(), group_ids: distinct(windows.map((w) => w.group_id)) };
}

/** ws(s)://host/groups/:id/stream from the hub's http(s) base URL. */
export function hubStreamUrl(hubUrl, groupId) {
  if (typeof hubUrl !== 'string' || !/^(https?|wss?):\/\//.test(hubUrl.trim())) {
    throw new GroupDashboardError('the hub URL must start with http://, https://, ws:// or wss://', 'group_dashboard_bad_input');
  }
  if (typeof groupId !== 'string' || !groupId.trim()) throw new GroupDashboardError('give a group id', 'group_dashboard_bad_input');
  const base = hubUrl.trim().replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${base}/groups/${encodeURIComponent(groupId.trim())}/stream`;
}

// ── timelines ────────────────────────────────────────────────────────────

/**
 * Catalogue channels the windows actually carry: a raw stream with rows, or a
 * window-level fallback value. `head.speed` comes with the head stream.
 */
export function availableChannels(windows) {
  const out = [];
  for (const c of listGroupChannels()) {
    const spec = channelSpec(c.channel);
    if (c.derived) {
      if (c.channel === 'head.speed' && windows.some((w) => hasStream(w, 'head'))) out.push(c.channel);
      continue;
    }
    const has = windows.some((w) => hasStream(w, spec.stream)
      || (typeof spec.fallback === 'function' && spec.fallback(w) != null));
    if (has) out.push(c.channel);
  }
  return out;
}

function hasStream(w, stream) {
  const s = w?.raw_streams?.[stream];
  return isObj(s) && Array.isArray(s.rows) && s.rows.length > 0;
}

/**
 * One long table per group from a parsed input. Windows go through Oyon's
 * `groupTimeline()` (alignment, physical units) and then, with
 * `normalize: 'person_z'` (default), ladyna's `normalizeTimeline()` — the
 * standardising is analysis, so it is ladyna's. Long-table rows are used as
 * they are.
 *
 * @returns {{ group_ids: string[], timelines: Record<string, object[]>, channels: string[], errors: Array<{group_id, code, message}> }}
 */
export function buildTimelines(input, { channels = null, normalize = 'person_z' } = {}) {
  if (!input || !Array.isArray(input.group_ids)) throw new GroupDashboardError('`input` must come from parseGroupInput() or liveInput()');
  const timelines = {};
  const errors = [];
  if (input.source === 'rows') {
    for (const g of input.group_ids) timelines[g] = input.rows.filter((r) => r.group_id === g);
    return { group_ids: input.group_ids, timelines, channels: distinct(input.rows.map((r) => r.channel)), errors };
  }
  const chans = channels ?? availableChannels(input.windows);
  if (!chans.length) {
    errors.push({ group_id: null, code: 'group_dashboard_no_channels', message: 'the windows carry no channel groupTimeline() can read' });
    return { group_ids: input.group_ids, timelines, channels: [], errors };
  }
  for (const g of input.group_ids) {
    try {
      const aligned = groupTimeline({ windows: input.windows, group_id: g, channels: chans });
      timelines[g] = normalize === 'person_z' ? normalizeTimeline(aligned, { method: 'person_z' }) : aligned;
    } catch (err) {
      errors.push({ group_id: g, code: err.code ?? 'error', message: err.message });
    }
  }
  return { group_ids: Object.keys(timelines).sort(), timelines, channels: chans, errors };
}

/** First and last tick of a long table, seconds. */
export function timeExtent(rows) {
  let min = Infinity; let max = -Infinity;
  for (const r of rows) {
    if (r.t_s < min) min = r.t_s;
    if (r.t_s > max) max = r.t_s;
  }
  return Number.isFinite(min) ? { min_s: min, max_s: max } : { min_s: 0, max_s: 0 };
}

/**
 * The brush: rows with `start_s ≤ t_s ≤ end_s`. A null bound is open.
 * @throws GroupDashboardError when start is after end
 */
export function filterSpan(rows, { start_s = null, end_s = null } = {}) {
  if (!Array.isArray(rows)) throw new GroupDashboardError('`rows` must be a long-table array');
  if (isNum(start_s) && isNum(end_s) && start_s > end_s) {
    throw new GroupDashboardError(`span start ${start_s} s is after its end ${end_s} s`, 'group_dashboard_bad_span');
  }
  const lo = isNum(start_s) ? start_s : -Infinity;
  const hi = isNum(end_s) ? end_s : Infinity;
  return rows.filter((r) => r.t_s >= lo && r.t_s <= hi);
}

/** Channels in a long table with kind, evidence (from `listGroupChannels()`) and class. */
export function channelsInTimeline(rows) {
  const catalogue = new Map(listGroupChannels().map((c) => [c.channel, c]));
  // Kind and counts are ladyna's (channelInventory); evidence and class are labels.
  return channelInventory(rows).map((c) => ({
    ...c,
    evidence: catalogue.get(c.channel)?.evidence ?? (c.channel.startsWith('au.') ? 'secondary' : null),
    channel_class: channelClass(c.channel, c.kind),
  }));
}

/** `categorical` | `oscillatory` | `continuous` — what decides the default measure. */
export function channelClass(channel, kind) {
  if (kind === 'categorical') return 'categorical';
  return OSCILLATORY.test(channel) ? 'oscillatory' : 'continuous';
}

/**
 * Measures that suit a channel class: ladyna's pairwise catalogue filtered by
 * the kinds it accepts, plus joint attention for categorical channels.
 * Defaults: WCC (slow continuous), PLV (oscillatory), joint attention (gaze
 * zones / AOIs), symbolic CRQA (other categorical channels).
 */
export function methodOptions(channel, kind) {
  const cls = channelClass(channel, kind);
  const fallback = cls === 'categorical' ? (GAZE_CHANNELS.includes(channel) || /aoi|zone/.test(channel) ? 'joint_attention' : 'crqa')
    : cls === 'oscillatory' ? 'plv' : 'wcc';
  const catalogue = listPairwiseMethods()
    .filter((m) => m.kinds.split(',').includes(cls === 'categorical' ? 'categorical' : 'continuous'))
    .map((m) => ({ method: m.method, measures: m.measures, reference: m.reference }));
  if (cls === 'categorical') {
    catalogue.unshift({ method: 'joint_attention', measures: 'p_joint,p_joint_expected,jva_cosine,initiation_balance', reference: 'Schneider et al. 2018; Golrang & Sharma 2026' });
  }
  return catalogue.map((m) => ({ ...m, is_default: m.method === fallback }));
}

export function defaultMethod(channel, kind) {
  return methodOptions(channel, kind).find((m) => m.is_default)?.method ?? 'wcc';
}

/** Regime kinds a timeline supports (ladyna `regimeSequence`), preferred first. */
export function regimeKinds(channels) {
  const names = new Set(channels.map((c) => (typeof c === 'string' ? c : c.channel)));
  const out = [];
  if (names.has('emotion')) out.push('affect');
  if (names.has('arousal')) out.push('arousal');
  if (attentionChannelOf(names)) out.push('attention');
  return out;
}

/** The channel ladyna's regimeSequence codes for a regime kind, or null when the timeline lacks it. */
export function regimeChannelFor(kind, channels) {
  const names = new Set(channels.map((c) => (typeof c === 'string' ? c : c.channel)));
  if (kind === 'affect') return names.has('emotion') ? 'emotion' : null;
  if (kind === 'arousal') return names.has('arousal') ? 'arousal' : null;
  if (kind === 'attention') return attentionChannelOf(names);
  return null;
}

function attentionChannelOf(names) {
  return GAZE_CHANNELS.find((c) => names.has(c)) ?? (names.has('head.yaw') ? 'head.yaw' : null);
}

// ── demo ─────────────────────────────────────────────────────────────────

/**
 * Synthetic demo rows straight from ladyna's `simulateGroup`: three members,
 * m1 driving m2 and m3 at a 2 s lag, a shared stimulus, blocks of missing data.
 * Channels: arousal and valence (VAR(1), 1 Hz), an oscillator (2 Hz), a
 * screen-gaze AOI stream (5 Hz) and emotion labels (ladyna kind 'states',
 * 1 Hz). Window-free: these rows ARE the long table.
 */
export function demoRows({ seed = 11, duration_s = 600, group_id = 'DEMO' } = {}) {
  const stimulus = stimulusEnvelope({ duration_s, n_events: 6, width_s: 10, seed });
  const coupling = [[0, 0, 0], [0.35, 0, 0], [0.3, 0.1, 0]];
  const common = { group_id, n_members: 3, duration_s, coupling, lag_s: 2, missing: 0.06, missing_block_s: 8 };
  return [
    ...simulateGroup({ ...common, kind: 'var', hz: 1, channel: 'arousal', ar: 0.6, stimulus, stimulus_gain: 1.5, seed }),
    ...simulateGroup({ ...common, kind: 'var', hz: 1, channel: 'valence', ar: 0.7, stimulus, stimulus_gain: 0.5, seed: seed + 1 }),
    ...simulateGroup({ ...common, kind: 'oscillator', hz: 2, channel: 'oscillator', seed: seed + 2 }),
    ...simulateGroup({ ...common, kind: 'gaze', hz: 5, channel: 'screen_gaze.aoi', aois: ['slide', 'code', 'chat', 'notes'], seed: seed + 3 }),
    // Emotion labels, neutral about half the time; members follow m1's switches as in the other channels.
    ...simulateGroup({
      ...common, kind: 'states', hz: 1, channel: 'emotion', dwell_s: 8, seed: seed + 4,
      states: ['anger', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
      state_weights: [0.06, 0.04, 0.04, 0.18, 0.5, 0.08, 0.1],
    }),
  ];
}

/**
 * Several demo groups doing the same task: `demoRows()` per group with its own
 * seed (`seed + 100·k`) and id `DEMO-<k>`. The other groups form the
 * pseudo-group null pool, and the groups-as-subjects VAR networks need ≥ 2.
 */
export function demoGroupRows({ n_groups: nGroups = 6, seed = 11, duration_s = 600 } = {}) {
  if (!Number.isInteger(nGroups) || nGroups < 1) throw new GroupDashboardError('`n_groups` must be a positive whole number');
  return Array.from({ length: nGroups }, (_, k) => demoRows({ seed: seed + 100 * k, duration_s, group_id: `DEMO-${k + 1}` })).flat();
}

// ── the dashboard ────────────────────────────────────────────────────────

function attempt(errors, panel, fn) {
  try {
    return fn();
  } catch (err) {
    errors.push({ panel, code: err?.code ?? 'error', message: err?.message ?? String(err) });
    return null;
  }
}

function pairStatistic(channel, method) {
  return method === 'joint_attention'
    ? (tl) => jointAttention(tl, { channel, level: 'pair' })
    : (tl) => pairwiseSynchrony(tl, { channel, method });
}

function nullKey(r) {
  return [r.pair ?? '', r.member_id ?? '', r.measure, r.scope, r.window_start_s, r.window_end_s].join('|');
}

function withNull(rows, nullRows) {
  const map = new Map((nullRows ?? []).map((r) => [nullKey(r), r]));
  return rows.map((r) => {
    const n = map.get(nullKey(r));
    const extra = {};
    for (const c of NULL_COLUMNS) extra[c] = n ? (n[c] ?? null) : null;
    return { ...r, ...extra };
  });
}

/**
 * Every panel's view model for one group, one channel and one measure, over
 * the brushed span. All numbers come from ladyna; a verb that throws is listed
 * in `errors` (panel, code, message) and its panel is empty.
 *
 * @param {object[]} timeline long table of ONE group (rows of groupTimeline / SyncRow)
 * @param {object}   opts see groupDashboard.d.ts `DashboardOptions`
 */
export function computeDashboard(timeline, opts = {}) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new GroupDashboardError('`timeline` must be a non-empty long-table array', 'group_dashboard_empty');
  }
  const groups = distinct(timeline.map((r) => r.group_id));
  if (groups.length !== 1) throw new GroupDashboardError(`the timeline holds ${groups.length} groups; pass one group's rows`, 'group_dashboard_ambiguous');
  const allChannels = channelsInTimeline(timeline);
  const channelInfo = allChannels.find((c) => c.channel === opts.channel);
  if (!channelInfo) throw new GroupDashboardError(`channel '${opts.channel}' is not in the timeline`, 'group_dashboard_unknown_channel');
  const channel = channelInfo.channel;
  const method = opts.method ?? defaultMethod(channel, channelInfo.kind);
  const binS = isNum(opts.bin_s) ? opts.bin_s : 5;
  const extent = timeExtent(timeline);
  const span = {
    start_s: isNum(opts.span?.start_s) ? opts.span.start_s : extent.min_s,
    end_s: isNum(opts.span?.end_s) ? opts.span.end_s : extent.max_s,
  };
  const rows = filterSpan(timeline, span);
  if (!rows.length) throw new GroupDashboardError('no ticks inside the selected span', 'group_dashboard_empty');
  const names = new Set(allChannels.map((c) => c.channel));
  const errors = [];
  const nullOpts = opts.null ?? null;

  // Pairwise (selected channel + method).
  const stat = pairStatistic(channel, method);
  const pairRows = attempt(errors, 'pairs', () => stat(rows)) ?? [];
  const measures = distinct(pairRows.map((r) => r.measure)).filter((m) => !DIRECTIONAL_MEASURES.includes(m));
  const measure = opts.measure && measures.includes(opts.measure) ? opts.measure
    : (measures.includes(PRIMARY_MEASURE[method]) ? PRIMARY_MEASURE[method] : (measures[0] ?? PRIMARY_MEASURE[method] ?? null));
  const meanRows = attempt(errors, 'strip', () => meanPairwise(pairRows)) ?? [];

  // Surrogate null (on demand): the strip's window means and the matrix's session pairs.
  let stripNull = null;
  let pairNull = null;
  let nullInfo = null;
  if (nullOpts) {
    const pool = Array.isArray(nullOpts.pool) && nullOpts.pool.length
      ? nullOpts.pool.map((tl) => filterSpan(tl, span).filter((r) => r.channel === channel)).filter((tl) => tl.length)
      : null;
    const nullMethod = nullOpts.method ?? (pool ? 'pseudo_group' : 'circular_shift');
    const base = { method: nullMethod, n: isNum(nullOpts.n) ? nullOpts.n : DEFAULT_NULL_N, seed: isNum(nullOpts.seed) ? nullOpts.seed : 1 };
    if (nullMethod === 'pseudo_group') base.pool = pool;
    if (isNum(nullOpts.min_shift_s)) base.min_shift_s = nullOpts.min_shift_s;
    const channelRows = rows.filter((r) => r.channel === channel);
    nullInfo = { method: nullMethod, n: base.n, seed: base.seed, pool_groups: pool ? pool.length : 0 };
    stripNull = attempt(errors, 'null', () => surrogateNull(channelRows, {
      ...base,
      statistic: (tl) => meanPairwise(stat(tl)).filter((r) => r.scope === 'window' && r.measure === measure),
      result_fields: ['value', 'n_pairs', 'overlap'],
    }));
    pairNull = attempt(errors, 'null', () => surrogateNull(channelRows, {
      ...base,
      statistic: (tl) => stat(tl).filter((r) => r.scope === 'session' && r.measure === measure),
    }));
  }

  const strip = (stripNull ?? meanRows.filter((r) => r.scope === 'window' && r.measure === measure)).map((r) => {
    const lo = r.null_lo ?? null; const hi = r.null_hi ?? null;
    return {
      window_start_s: r.window_start_s,
      window_end_s: r.window_end_s,
      t_mid_s: (r.window_start_s + r.window_end_s) / 2,
      value: r.value,
      overlap: r.overlap,
      n_pairs: r.n_pairs,
      null_lo: lo,
      null_hi: hi,
      null_mean: r.null_mean ?? null,
      z: r.z ?? null,
      p_null: r.p_null ?? null,
      outside: r.outside ?? null,
    };
  });

  // Session pairs + matrix.
  const sessionRows = pairNull ?? pairRows.filter((r) => r.scope === 'session' && r.measure === measure);
  // The leader is ladyna's (`leader`, from the sign of an estimated lag): the
  // row's own lag, else the method's session row that carries one (CRQA's
  // lag of maximum recurrence). Measures that estimate no lag have no leader.
  const lagRowOf = (r) => (r.lag_s !== null && r.lag_s !== undefined ? r
    : pairRows.find((x) => x.scope === 'session' && x.pair === r.pair && x.lag_s !== null) ?? null);
  const pairs = sessionRows.map((r) => {
    const lagRow = lagRowOf(r);
    return {
      pair: r.pair,
      member_a: r.member_a,
      member_b: r.member_b,
      value: r.value,
      lag_s: lagRow ? lagRow.lag_s : null,
      leader: lagRow ? lagRow.leader : null,
      lead_source: lagRow ? lagRow.measure : null,
      overlap: r.overlap,
      n: r.n,
      z: r.z ?? null,
      p_null: r.p_null ?? null,
      null_lo: r.null_lo ?? null,
      null_hi: r.null_hi ?? null,
    };
  });
  const members = distinct(rows.map((r) => r.member_id));
  const matrix = {
    members,
    cells: members.map((rowM) => members.map((colM) => {
      if (rowM === colM) return null;
      const p = pairs.find((x) => (x.member_a === rowM && x.member_b === colM) || (x.member_a === colM && x.member_b === rowM));
      if (!p) return null;
      return {
        pair: p.pair,
        value: p.value,
        overlap: p.overlap,
        z: p.z,
        p_null: p.p_null,
        // ladyna's leader, seen from this cell's row.
        lead: p.lead_source === null ? null : p.leader === rowM ? 'row' : p.leader === colM ? 'col' : 'none',
        lag_s: p.lag_s,
        lead_source: p.lead_source,
      };
    })),
  };

  // Ribbons + member quality on the selected channel.
  const ribbons = attempt(errors, 'ribbons', () => channelRibbons(rows, channel)) ?? [];
  const clocks = memberClock(opts.windows ?? [], groups[0]);
  const memberRows = members.map((m) => {
    const rb = ribbons.find((r) => r.member_id === m);
    return {
      member_id: m,
      seat: rb?.seat ?? rows.find((r) => r.member_id === m && r.seat != null)?.seat ?? null,
      n_ticks: rb?.n_ticks ?? 0,
      quality_share: rb?.quality_share ?? null,
      quality_reading: rb?.quality_reading ?? 'no data',
      ...(clocks[m] ?? { clock_offset_ms: null, clock_rtt_ms: null, clock_source: null }),
    };
  });

  // Events: shared arousal / out of sync (arousalEvents) and joint-attention breaks.
  const contNames = allChannels.filter((c) => c.kind === 'continuous').map((c) => c.channel);
  const eventsChannel = opts.events_channel !== undefined ? opts.events_channel
    : (names.has('arousal') ? 'arousal' : (channelInfo.kind === 'continuous' ? channel : (contNames[0] ?? null)));
  const attentionChannel = opts.attention_channel !== undefined ? opts.attention_channel : (GAZE_CHANNELS.find((c) => names.has(c)) ?? null);
  const arousalRows = eventsChannel ? (attempt(errors, 'events', () => arousalEvents(rows, { channel: eventsChannel })) ?? []) : [];
  const jaRows = attentionChannel
    ? (method === 'joint_attention' && attentionChannel === channel ? pairRows
      : (attempt(errors, 'joint_attention', () => jointAttention(rows, { channel: attentionChannel, level: 'pair' })) ?? []))
    : [];
  const jaBreaks = attentionChannel
    ? (attempt(errors, 'joint_attention', () => jointAttentionBreaks(rows, { channel: attentionChannel })) ?? [])
    : [];
  const events = buildEvents(arousalRows, jaBreaks, opts.markers ?? [], rows);

  // Joint attention pair table.
  const jointTable = jaRows.length ? pivotPairs(jaRows.filter((r) => r.scope === 'session')) : [];

  // Member indices: cluster phase on a continuous channel.
  const phaseChannel = channelInfo.kind === 'continuous' ? channel : eventsChannel;
  const phaseRows = phaseChannel ? (attempt(errors, 'member_indices', () => groupSynchrony(rows, { channel: phaseChannel, method: 'cluster_phase' })) ?? []) : [];
  const rhoGroup = phaseRows.find((r) => r.measure === 'rho_group' && r.member_id == null) ?? null;
  const memberIndices = members.map((m) => ({
    member_id: m,
    member_rho: phaseRows.find((r) => r.measure === 'member_rho' && r.member_id === m)?.value ?? null,
    mean_rel_phase: phaseRows.find((r) => r.measure === 'mean_rel_phase' && r.member_id === m)?.value ?? null,
  }));

  // Regimes (codeStates → regimeSequence) and their transition counts (ftna).
  const kinds = regimeKinds(allChannels);
  const regimeKind = opts.regime_kind && kinds.includes(opts.regime_kind) ? opts.regime_kind : (kinds[0] ?? null);
  const regime = regimeKind ? regimeFor(rows, regimeKind, names, binS, span, errors) : { channel: null, rows: [], transitions: [], model: null };
  const regimeChannel = regime.channel;
  const regimes = regime.rows;
  const transitions = regime.transitions;
  const coding = attempt(errors, 'coding', () => codingTable({ bin_s: binS })) ?? [];

  return {
    group_id: groups[0],
    channel,
    channel_kind: channelInfo.kind,
    channel_class: channelInfo.channel_class,
    evidence: channelInfo.evidence,
    channels: allChannels,
    method,
    methods: methodOptions(channel, channelInfo.kind),
    measure,
    measures,
    span: { ...span, min_s: extent.min_s, max_s: extent.max_s },
    members: memberRows,
    events,
    latest_event: latestEvent(events),
    events_channel: eventsChannel,
    attention_channel: attentionChannel,
    strip,
    null: nullInfo,
    pairs,
    matrix,
    ribbons,
    regime: { kind: regimeKind, kinds, channel: regimeChannel, bin_s: binS, rows: regimes, transitions },
    joint_attention: jointTable,
    rho_group: rhoGroup ? rhoGroup.value : null,
    member_indices: memberIndices,
    errors,
    tables: {
      timeline: rows,
      pairs: withNull(pairRows, pairNull),
      group: [
        ...withNull(meanRows.map((r) => ({ ...r, member_id: null, params: `mean_pairwise:${r.method}` })), stripNull),
        ...phaseRows.map((r) => ({ ...r, n_pairs: null })),
      ],
      regimes: regimes.map((r) => ({ ...r, kind: regimeKind, channel: regimeChannel })),
      coding: { schema_version: CODING_SCHEMA, generated_by: 'ladyna/synchrony codingTable', options: { bin_s: binS, regime_kind: regimeKind, regime_channel: regimeChannel }, rules: coding },
      arousal_events: arousalRows,
    },
  };
}

/**
 * Every member's ribbon on one channel of a (brushed) timeline: ladyna
 * channelMatrix, one ribbon per member. Throws ladyna's error for a channel
 * the rows lack.
 */
export function channelRibbons(rows, channel) {
  const mat = channelMatrix(rows, { channel });
  // Usable share and low-quality runs are ladyna's (qualitySummary); Oyon picks the threshold it hatches.
  const quality = qualitySummary(mat, { threshold: LOW_QUALITY });
  return mat.members.map((m, i) => ({
    member_id: m,
    seat: mat.seats[m] ?? null,
    kind: mat.kind,
    points: mat.t_s.map((t, k) => ({ t_s: t, value: mat.values[i][k], state: mat.states[i][k], quality: mat.quality[i][k] })),
    low_quality_spans: quality[i].low_quality_spans,
    n_ticks: quality[i].n_ticks,
    quality_share: quality[i].quality_share,
    quality_reading: quality[i].reading,
  }));
}

function pivotPairs(rows) {
  const byPair = new Map();
  for (const r of rows) {
    let p = byPair.get(r.pair);
    if (!p) {
      p = { pair: r.pair, member_a: r.member_a, member_b: r.member_b, p_joint: null, p_joint_expected: null, jva_cosine: null, initiation_balance: null, overlap: r.overlap };
      byPair.set(r.pair, p);
    }
    if (r.measure in p) p[r.measure] = r.value;
  }
  return [...byPair.values()];
}

/**
 * ladyna over the regime sequence: ftna for the counts, tna for the transition
 * probability (the share of the transitions out of `from`). Non-zero cells only.
 */
function transitionModel(regimes) {
  const seq = toSequences(regimes, { by: 'group_id', state: 'regime' });
  const model = ftna(seq.sequences);
  const rel = tna(seq.sequences);
  const transitions = [];
  model.labels.forEach((from, i) => model.labels.forEach((to, j) => {
    const count = model.weights.get(i, j);
    if (count > 0) transitions.push({ from, to, count, prob: rel.weights.get(rel.labels.indexOf(from), rel.labels.indexOf(to)) });
  }));
  return { model, transitions };
}

/** One regime kind over the span: ladyna codeStates → regimeSequence → ftna. Failures go to `errors`. */
function regimeFor(rows, kind, names, binS, span, errors) {
  const channel = kind === 'affect' ? 'emotion' : kind === 'arousal' ? 'arousal' : kind === 'attention' ? attentionChannelOf(names) : null;
  const coded = attempt(errors, 'regimes', () => codeStates(rows, { bin_s: binS, channels: [channel] }));
  const seq = coded ? (attempt(errors, 'regimes', () => regimeSequence(coded, { timeline: rows, kind, channel })) ?? []) : [];
  const inSpan = seq.filter((r) => r.bin_end_s > span.start_s && r.bin_start_s <= span.end_s);
  const fit = inSpan.length > 1 ? attempt(errors, 'regimes', () => transitionModel(inSpan)) : null;
  return { channel, rows: inSpan, transitions: fit?.transitions ?? [], model: fit?.model ?? null };
}

/**
 * Every regime kind the timeline supports, each with its band rows, the
 * transition counts and the transition network (ladyna plotNetwork of the
 * ftna model, regime colours) — the /group/regimes page, all kinds at once.
 */
export function regimePanels(timeline, { span = null, bin_s: binS = 5 } = {}) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new GroupDashboardError('`timeline` must be a non-empty long-table array', 'group_dashboard_empty');
  }
  const allChannels = channelsInTimeline(timeline);
  const names = new Set(allChannels.map((c) => c.channel));
  const extent = timeExtent(timeline);
  const sp = {
    start_s: isNum(span?.start_s) ? span.start_s : extent.min_s,
    end_s: isNum(span?.end_s) ? span.end_s : extent.max_s,
  };
  const rows = filterSpan(timeline, sp);
  return regimeKinds(allChannels).map((kind) => {
    const errors = [];
    const r = rows.length ? regimeFor(rows, kind, names, binS, sp, errors) : { channel: null, rows: [], transitions: [], model: null };
    let network = null;
    if (r.model) {
      network = attempt(errors, 'regimes', () => plotNetwork(r.model, {
        colorMap: Object.fromEntries(r.model.labels.map((l) => [l, REGIME_COLOURS[l] ?? OKABE_ITO.grey])),
        title: `${kind} regime transitions`, subtitle: `counts between consecutive ${binS} s bins`, decimals: 0,
      }));
    }
    return { kind, channel: r.channel, bin_s: binS, rows: r.rows, transitions: r.transitions, network, errors };
  });
}

function buildEvents(arousalRows, jaBreaks, markers, rows) {
  const events = [];
  for (const e of arousalRows) {
    if (e.event === 'shared_arousal') {
      events.push({ kind: 'shared_arousal', start_s: e.segment_start_s, end_s: e.segment_end_s, label: 'shared arousal', detail: `${e.n_aroused} of ${e.n_valid} aroused (${e.members_aroused})`, channel: e.channel });
    } else if (e.event === 'out_of_sync') {
      events.push({ kind: 'out_of_sync', start_s: e.segment_start_s, end_s: e.segment_end_s, label: 'out of sync', detail: `directional agreement ${fmt(e.da)}`, channel: e.channel });
    } else if (e.event === 'sparse') {
      events.push({ kind: 'sparse', start_s: e.segment_start_s, end_s: e.segment_end_s, label: 'sparse', detail: `${e.n_valid} member(s) with data`, channel: e.channel });
    }
  }
  // Joint-attention breaks are ladyna's (jointAttentionBreaks); this only draws them.
  for (const w of jaBreaks) {
    if (w.event === 'break') {
      events.push({ kind: 'attention_break', start_s: w.window_start_s, end_s: w.window_end_s, label: 'joint-attention break', detail: `p_joint ${fmt(w.p_joint)} < chance ${fmt(w.p_joint_expected)}`, channel: w.channel });
    }
  }
  const anchorRow = rows.find((r) => isNum(r.t_group_ms));
  const anchor = anchorRow ? anchorRow.t_group_ms - anchorRow.t_s * 1000 : null;
  for (const m of markers) {
    const t = isNum(m.group_ms) && anchor !== null ? (m.group_ms - anchor) / 1000 : null;
    events.push({ kind: 'marker', start_s: t, end_s: t, label: m.label ? `marker: ${m.label}` : 'marker', detail: m.marker_id ?? '', channel: null });
  }
  return events.sort((a, b) => (a.start_s ?? Infinity) - (b.start_s ?? Infinity));
}

function latestEvent(events) {
  const shared = events.filter((e) => e.kind === 'shared_arousal' || e.kind === 'out_of_sync' || e.kind === 'attention_break');
  return shared.reduce((best, e) => (!best || e.end_s > best.end_s || (e.end_s === best.end_s && e.start_s > best.start_s) ? e : best), null);
}

/** Last known clock state per member from its windows (`clock_offset_ms`, `clock_rtt_ms`, `clock_source`). */
export function memberClock(windows, groupId) {
  const out = {};
  for (const w of windows) {
    if (groupId && w.group_id !== groupId) continue;
    const prev = out[w.member_id];
    const end = String(w.window_end ?? '');
    if (prev && prev._end > end) continue;
    out[w.member_id] = {
      _end: end,
      clock_offset_ms: isNum(w.clock_offset_ms) ? w.clock_offset_ms : null,
      clock_rtt_ms: isNum(w.clock_rtt_ms) ? w.clock_rtt_ms : null,
      clock_source: typeof w.clock_source === 'string' ? w.clock_source : null,
    };
  }
  for (const k of Object.keys(out)) delete out[k]._end;
  return out;
}

function fmt(x, digits = 2) {
  return isNum(x) ? x.toFixed(digits) : '–';
}

// ── export ───────────────────────────────────────────────────────────────

function csvField(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'string') s = v;
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else s = JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * RFC 4180 CSV: header + one line per row, CRLF line ends, fields with a comma,
 * quote or line break quoted and inner quotes doubled; null → empty field.
 * Columns default to every key in first-seen order; given columns come first
 * and any further keys follow (nothing is dropped).
 */
export function toCsv(rows, columns = null) {
  const cols = [...(columns ?? [])];
  const seen = new Set(cols);
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const lines = [cols.map(csvField).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvField(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The export files of a dashboard view: timeline.csv, pairs.csv, group.csv,
 * regimes.csv and coding.json — every table one row per observation.
 */
export function exportFiles(view) {
  const t = view.tables;
  return [
    { name: 'timeline.csv', mime: 'text/csv', content: toCsv(t.timeline, TIMELINE_COLUMNS) },
    { name: 'pairs.csv', mime: 'text/csv', content: toCsv(t.pairs, PAIR_COLUMNS) },
    { name: 'group.csv', mime: 'text/csv', content: toCsv(t.group, GROUP_COLUMNS) },
    { name: 'regimes.csv', mime: 'text/csv', content: toCsv(t.regimes, REGIME_COLUMNS) },
    { name: 'coding.json', mime: 'application/json', content: `${JSON.stringify(t.coding, null, 2)}\n` },
  ];
}

/**
 * The loaded data as one file that `parseGroupInput` reads back: an
 * `oyon-group-bundle-v1` object for windows (one group, or all of them), the
 * bare long-table rows otherwise.
 */
export function bundleFile(input, groupId = null) {
  if (input.source === 'rows') {
    const rows = groupId ? input.rows.filter((r) => r.group_id === groupId) : input.rows;
    return { name: `group-${groupId ?? 'all'}-rows.json`, mime: 'application/json', content: `${JSON.stringify(rows)}\n` };
  }
  const windows = groupId ? input.windows.filter((w) => w.group_id === groupId) : input.windows;
  const bundle = { schema_version: BUNDLE_SCHEMA, group_id: groupId ?? (input.group_ids.length === 1 ? input.group_ids[0] : null), generator: 'oyon-app-group-dashboard', markers: input.markers ?? [], windows };
  return { name: `group-${groupId ?? 'all'}-bundle.json`, mime: 'application/json', content: `${JSON.stringify(bundle)}\n` };
}
