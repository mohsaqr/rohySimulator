import { GroupInputError, isNum, median } from './stats.js';
import { channelSpec } from './channels.js';
import { joinRawParts } from '../records/rawParts.js';

/**
 * Context keys a window must carry to take part in group work. They ride on
 * every window through the host's `getContext()` / `contextProvider` — no
 * schema change, just more context keys (see docs/GROUP_SYNCHRONY.md §1).
 */
export const GROUP_CONTEXT_KEYS = Object.freeze(['group_id', 'member_id', 'seat']);
export const GROUP_REQUIRED_CONTEXT_KEYS = Object.freeze(['group_id', 'member_id']);

/**
 * Check that windows carry the group context keys. Returns a tidy table, one
 * row per window that fails, with the missing keys; empty when every window
 * is usable. `seat` is optional (reported, never required).
 *
 * @param {object[]} windows
 * @returns {Array<{index:number, session_id:string|null, missing:string}>}
 */
export function checkGroupContext(windows) {
  if (!Array.isArray(windows)) throw new GroupInputError('`windows` must be an array of Oyon window events');
  const out = [];
  windows.forEach((w, index) => {
    const missing = GROUP_REQUIRED_CONTEXT_KEYS.filter(k => typeof w?.[k] !== 'string' || !w[k]);
    if (missing.length) out.push({ index, session_id: w?.session_id ?? null, missing: missing.join(',') });
  });
  return out;
}

/**
 * Turn n members' Oyon windows into ONE long table on a shared grid:
 * one row per member × channel × grid tick.
 *
 * Resampling is last-observation-carried-forward within a tolerance
 * (default 1.5 × the member's median source interval for that channel);
 * beyond it the tick is missing (`value: null`, `quality: 0`). Missing faces
 * are never interpolated into invented values.
 *
 * Time: each point's group time is its `ts_group_ms` when the member had a
 * group clock, otherwise `ts_ms + clock_offset_ms` of its window (0 when the
 * window has none — then members are only as aligned as their laptop clocks).
 *
 * @param {object}   args
 * @param {object[]} args.windows      window events of the members (any order, any mix of groups)
 * @param {string}   [args.group_id]   keep only this group; required when windows span several groups
 * @param {string[]} [args.channels]   channel names from `listGroupChannels()` or `au.<name>`; default valence, arousal, emotion
 * @param {number|object} [args.grid_hz] one rate for every channel, or `{ channel: hz }`; default per channel
 * @param {number}   [args.anchor_ms]  group-time origin of the grid; default the windows' `window_anchor_ms`, else the earliest point
 * @param {number}   [args.tolerance_s] override the LOCF tolerance for every channel
 * @param {'none'}   [args.normalize='none'] only 'none'. Person-standardising is a
 *   statistic and lives in ladyna: `normalizeTimeline(rows, { method: 'person_z' })`
 *   from `ladyna/synchrony`. 'person_z' throws `oyon_group_normalize_moved`.
 * @returns {Array<object>} rows `{ group_id, member_id, seat, t_s, t_group_ms, channel, kind, value, value_raw, state, quality, source }`;
 *   on continuous rows `value` and `value_raw` both hold the physical reading.
 */
export function groupTimeline({
  windows,
  group_id: groupId = null,
  channels = ['valence', 'arousal', 'emotion'],
  grid_hz: gridHz = null,
  anchor_ms: anchorMs = null,
  tolerance_s: toleranceS = null,
  normalize = 'none',
} = {}) {
  if (!Array.isArray(windows)) throw new GroupInputError('`windows` must be an array of Oyon window events');
  if (!Array.isArray(channels) || channels.length === 0) throw new GroupInputError('`channels` must be a non-empty array of channel names');
  if (normalize === 'person_z') {
    throw new GroupInputError("person-z standardising moved to ladyna: normalizeTimeline(groupTimeline(...), { method: 'person_z' }) from 'ladyna/synchrony'", 'oyon_group_normalize_moved');
  }
  if (normalize !== 'none') throw new GroupInputError("`normalize` must be 'none' (standardise with ladyna normalizeTimeline)");
  const specs = channels.map((c) => {
    const spec = channelSpec(c);
    if (!spec) throw new GroupInputError(`unknown channel '${c}'; see listGroupChannels()`, 'oyon_group_unknown_channel');
    return [c, spec];
  });

  // Windows split across POSTs are joined back first; raw-only envelopes
  // (`modality: 'raw'`) then contribute their rows like any window's.
  windows = joinRawParts(windows);
  const bad = checkGroupContext(windows);
  if (bad.length) {
    throw new GroupInputError(`${bad.length} window(s) lack group context (${bad[0].missing}); set group_id and member_id through the host context`, 'oyon_group_missing_context');
  }
  const groups = [...new Set(windows.map(w => w.group_id))];
  if (!groupId && groups.length > 1) {
    throw new GroupInputError(`windows span ${groups.length} groups; pass group_id`, 'oyon_group_ambiguous');
  }
  const gid = groupId || groups[0] || null;
  const mine = windows.filter(w => w.group_id === gid);
  if (!mine.length) throw new GroupInputError(`no windows for group '${gid}'`, 'oyon_group_empty');

  const members = [...new Set(mine.map(w => w.member_id))].sort();
  const seats = Object.fromEntries(members.map(m => [m, mine.find(w => w.member_id === m && w.seat != null)?.seat ?? null]));

  // Collect observations per member × base channel: [{ t, value, quality, source }]
  const needHead = specs.some(([c]) => c === 'head.speed');
  const baseChannels = [...new Set([
    ...specs.filter(([, s]) => !s.derived).map(([c]) => c),
    ...(needHead ? ['head.yaw', 'head.pitch', 'head.roll'] : []),
  ])];
  const obs = new Map(); // key member|channel → array
  for (const w of mine) {
    for (const channel of baseChannels) {
      const key = `${w.member_id}|${channel}`;
      if (!obs.has(key)) obs.set(key, []);
      readChannel(w, channel, channelSpec(channel), obs.get(key));
    }
  }

  // Grid origin.
  let anchor = isNum(anchorMs) ? anchorMs : null;
  if (anchor === null) {
    const anchors = mine.map(w => w.window_anchor_ms).filter(isNum);
    if (anchors.length) anchor = Math.min(...anchors);
  }
  if (anchor === null) {
    let min = Infinity;
    for (const list of obs.values()) for (const o of list) if (o.t < min) min = o.t;
    if (!Number.isFinite(min)) throw new GroupInputError('the windows carry no observations for the requested channels', 'oyon_group_empty');
    anchor = Math.floor(min);
  }
  let maxT = -Infinity;
  for (const list of obs.values()) for (const o of list) if (o.t > maxT) maxT = o.t;

  const rows = [];
  const resampled = new Map(); // member|channel → { values, quality, states, hz }
  for (const channel of baseChannels) {
    const spec = channelSpec(channel);
    const hz = rateFor(channel, spec, gridHz);
    const step = 1000 / hz;
    const nTicks = maxT >= anchor ? Math.floor((maxT - anchor) / step) + 1 : 0;
    for (const member of members) {
      const list = (obs.get(`${member}|${channel}`) || []).sort((a, b) => a.t - b.t);
      // Event channels hold their state until the next event; sampled
      // channels expire after a tolerance so a gap stays a gap.
      const tolMs = spec.hold ? Infinity : (isNum(toleranceS) ? toleranceS * 1000 : 1.5 * sourceInterval(list, step));
      resampled.set(`${member}|${channel}`, locf(list, anchor, step, nTicks, tolMs, spec.kind));
    }
  }
  if (needHead) {
    // Speed is differenced on ITS OWN grid: the three angles are resampled at
    // head.speed's rate here (they may be requested, or default, at another
    // rate), so speed rows and their timestamps share one step.
    const hz = rateFor('head.speed', channelSpec('head.speed'), gridHz);
    const step = 1000 / hz;
    const nTicks = maxT >= anchor ? Math.floor((maxT - anchor) / step) + 1 : 0;
    const onSpeedGrid = (member, channel) => {
      const list = (obs.get(`${member}|${channel}`) || []).sort((a, b) => a.t - b.t);
      const tolMs = isNum(toleranceS) ? toleranceS * 1000 : 1.5 * sourceInterval(list, step);
      return locf(list, anchor, step, nTicks, tolMs, 'continuous');
    };
    for (const member of members) {
      resampled.set(`${member}|head.speed`, headSpeed(
        onSpeedGrid(member, 'head.yaw'), onSpeedGrid(member, 'head.pitch'), onSpeedGrid(member, 'head.roll'), hz,
      ));
    }
  }

  for (const [channel, spec] of specs) {
    const hz = rateFor(channel, spec, gridHz);
    const step = 1000 / hz;
    for (const member of members) {
      const series = resampled.get(`${member}|${channel}`);
      if (!series) continue;
      for (let k = 0; k < series.values.length; k += 1) {
        const raw = series.values[k];
        const value = spec.kind === 'continuous' && isNum(raw) ? raw : null;
        rows.push({
          group_id: gid,
          member_id: member,
          seat: seats[member],
          t_s: round6((k * step) / 1000),
          t_group_ms: anchor + k * step,
          channel,
          kind: spec.kind,
          value,
          value_raw: spec.kind === 'continuous' ? (isNum(raw) ? raw : null) : null,
          state: spec.kind === 'categorical' ? series.states[k] : null,
          quality: series.quality[k],
          source: series.sources[k],
        });
      }
    }
  }
  return rows;
}

/**
 * The timeline for one channel as aligned arrays — the shape every synchrony
 * verb works on internally. Members are sorted; index i of `values[m]` is
 * tick `t_s[i]`.
 *
 * @param {object[]} timeline rows from `groupTimeline()`
 * @param {object}   args
 * @param {string}   args.channel
 * @param {string[]} [args.members] restrict / order members
 * @param {boolean}  [args.raw=false] use `value_raw` (physical units) instead of `value`
 * @returns {{ group_id, channel, kind, members: string[], seats: object, t_s: number[], step_s: number,
 *             values: (number|null)[][], states: (string|null)[][], quality: number[][] }}
 */
export function channelMatrix(timeline, { channel, members = null, raw = false } = {}) {
  if (!Array.isArray(timeline)) throw new GroupInputError('`timeline` must be the array returned by groupTimeline()');
  const rows = timeline.filter(r => r.channel === channel);
  if (!rows.length) throw new GroupInputError(`channel '${channel}' is not in the timeline`, 'oyon_group_unknown_channel');
  const all = [...new Set(rows.map(r => r.member_id))].sort();
  const ms = members ? members.filter(m => all.includes(m)) : all;
  const ticks = [...new Set(rows.map(r => r.t_s))].sort((a, b) => a - b);
  const index = new Map(ticks.map((t, i) => [t, i]));
  const mi = new Map(ms.map((m, i) => [m, i]));
  const values = ms.map(() => new Array(ticks.length).fill(null));
  const states = ms.map(() => new Array(ticks.length).fill(null));
  const quality = ms.map(() => new Array(ticks.length).fill(0));
  const seats = {};
  for (const r of rows) {
    const m = mi.get(r.member_id);
    if (m === undefined) continue;
    const i = index.get(r.t_s);
    values[m][i] = raw ? r.value_raw : r.value;
    states[m][i] = r.state;
    quality[m][i] = isNum(r.quality) ? r.quality : 0;
    seats[r.member_id] = r.seat;
  }
  return {
    group_id: rows[0].group_id,
    channel,
    kind: rows[0].kind,
    members: ms,
    seats,
    t_s: ticks,
    step_s: ticks.length > 1 ? round6(ticks[1] - ticks[0]) : null,
    values,
    states,
    quality,
  };
}

// ── internals ───────────────────────────────────────────────────────────────

function rateFor(channel, spec, gridHz) {
  let hz = spec.grid_hz;
  if (isNum(gridHz)) hz = gridHz;
  else if (gridHz && typeof gridHz === 'object' && isNum(gridHz[channel])) hz = gridHz[channel];
  if (!(hz > 0)) throw new GroupInputError(`grid rate for '${channel}' must be positive`);
  return hz;
}

function readChannel(w, channel, spec, out) {
  const offset = isNum(w.clock_offset_ms) ? w.clock_offset_ms : 0;
  const stream = w.raw_streams?.[spec.stream];
  if (stream && Array.isArray(stream.fields) && Array.isArray(stream.rows)) {
    const idx = Object.fromEntries(stream.fields.map((f, i) => [f, i]));
    if (idx.ts_ms === undefined) return;
    for (const row of stream.rows) {
      const rec = {};
      for (const f of stream.fields) rec[f] = row[idx[f]];
      const t = isNum(rec.ts_group_ms) ? rec.ts_group_ms : (isNum(rec.ts_ms) ? rec.ts_ms + offset : null);
      if (t === null) continue;
      const value = spec.read ? spec.read(rec) : rec[spec.field];
      let q = 1;
      if (spec.quality) {
        const qv = rec[spec.quality];
        q = qv === true ? 1 : qv === false ? 0 : (isNum(qv) ? Math.max(0, Math.min(1, qv)) : (value == null ? 0 : 1));
      }
      const usable = spec.kind === 'continuous' ? isNum(value) : (typeof value === 'string' && value.length > 0);
      out.push({ t, value: usable ? value : null, quality: usable ? q : 0, source: `raw:${spec.stream}` });
    }
    return;
  }
  // A raw-only envelope has no window values: without the stream it has
  // nothing for this channel (a window-level fallback would write missing
  // observations over the real windows' span).
  if (w.modality === 'raw') return;
  if (typeof spec.fallback === 'function') {
    const start = Date.parse(w.window_start); const end = Date.parse(w.window_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const value = spec.fallback(w);
    const usable = spec.kind === 'continuous' ? isNum(value) : (typeof value === 'string' && value.length > 0);
    const q = usable ? (isNum(w.missing_face_ratio) ? 1 - w.missing_face_ratio : 1) : 0;
    // A window value describes the whole window: one observation at the start
    // and one at the end, so LOCF covers the window and nothing past it.
    out.push({ t: start + offset, value: usable ? value : null, quality: q, source: 'window' });
    out.push({ t: end + offset - 1, value: usable ? value : null, quality: q, source: 'window' });
  }
}

function sourceInterval(list, gridStepMs) {
  if (list.length < 2) return gridStepMs;
  const diffs = [];
  for (let i = 1; i < list.length; i += 1) {
    const d = list[i].t - list[i - 1].t;
    if (d > 0) diffs.push(d);
  }
  const med = median(diffs);
  return Math.max(gridStepMs, isNum(med) ? med : gridStepMs);
}

function locf(list, anchor, step, nTicks, tolMs, kind) {
  const values = new Array(nTicks).fill(null);
  const states = new Array(nTicks).fill(null);
  const quality = new Array(nTicks).fill(0);
  const sources = new Array(nTicks).fill(null);
  let j = -1;
  for (let k = 0; k < nTicks; k += 1) {
    const t = anchor + k * step;
    while (j + 1 < list.length && list[j + 1].t <= t) j += 1;
    if (j < 0) continue;
    const o = list[j];
    if (t - o.t > tolMs || o.value === null) continue;
    if (kind === 'continuous') values[k] = o.value; else states[k] = o.value;
    quality[k] = o.quality;
    sources[k] = o.source;
  }
  return { values, states, quality, sources };
}

function headSpeed(yaw, pitch, roll, hz) {
  const n = yaw ? yaw.values.length : 0;
  const values = new Array(n).fill(null);
  const quality = new Array(n).fill(0);
  const sources = new Array(n).fill(null);
  for (let k = 1; k < n; k += 1) {
    const a = [yaw, pitch, roll].map(s => s?.values[k]);
    const b = [yaw, pitch, roll].map(s => s?.values[k - 1]);
    if (a.every(isNum) && b.every(isNum)) {
      values[k] = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) * hz;
      quality[k] = 1;
      sources[k] = 'derived:head';
    }
  }
  return { values, states: new Array(n).fill(null), quality, sources };
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}
