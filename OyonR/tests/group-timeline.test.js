// groupTimeline: n members' windows → one long table on a shared grid.
// This is data out (alignment + reshaping), not analysis — the synchrony
// measures that consume the table live in ladyna (ladyna/synchrony).
import assert from 'node:assert/strict';
import { groupTimeline, channelMatrix, checkGroupContext } from '../src/group/timeline.js';
import { listGroupChannels, channelSpec, screenZone } from '../src/group/channels.js';

const T0 = Date.UTC(2026, 0, 1);
const AFFECT = ['ts_ms', 'ts_group_ms', 'valence', 'arousal', 'confidence', 'label', 'face_present'];

/** One 10 s window of 1 Hz affect rows for a member whose clock is `skew` ms off. */
function win(member, k, valences, { skew = 0, group = 'G1', stamped = false } = {}) {
  const rows = valences.map((v, i) => {
    const local = T0 + k * 10_000 + i * 1000 + skew;
    return [local, stamped ? local - skew : null, v, v === null ? null : -v, v === null ? null : 0.9, v === null ? null : (v > 0 ? 'happy' : 'neutral'), v === null ? 0 : 1];
  });
  return {
    group_id: group, member_id: member, seat: `seat-${member}`,
    clock_offset_ms: -skew,
    window_start: new Date(T0 + k * 10_000 + skew).toISOString(),
    window_end: new Date(T0 + k * 10_000 + skew + 9_999).toISOString(),
    raw_streams: { affect: { fields: AFFECT, rows } },
  };
}

// ---------- alignment: per-window clock offsets put members on one grid ----------
{
  const windows = [
    win('a', 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { skew: 300 }),
    win('b', 0, [1, 1, 1, null, 1, 2, 2, 2, 2, 2], { skew: -2000 }),
    win('b', 2, [5, 5]),
  ];
  const tl = groupTimeline({ windows, channels: ['valence', 'emotion'], normalize: 'none' });
  const series = (m, c, f = 'value') => tl.filter(r => r.member_id === m && r.channel === c).map(r => r[f]);
  // a: values land on ticks 0..9 after removing its +300 ms skew; LOCF carries 9 one tick (≤ 1.5 s).
  assert.deepEqual(series('a', 'valence').slice(0, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, null]);
  // b: the missing face at tick 3 stays missing; the gap between windows is missing, not invented.
  assert.deepEqual(series('b', 'valence').slice(0, 12), [1, 1, 1, null, 1, 2, 2, 2, 2, 2, 2, null]);
  assert.deepEqual(series('b', 'valence').slice(20), [5, 5]);
  assert.equal(series('b', 'valence', 'quality')[3], 0, 'missing tick has quality 0');
  assert.equal(series('a', 'valence', 'quality')[0], 0.9, 'quality is the source confidence');
  assert.deepEqual(series('a', 'emotion', 'state').slice(0, 3), ['neutral', 'happy', 'happy']);
  // One row per member × channel × tick, identical tick sets for every member.
  const ticks = (m, c) => tl.filter(r => r.member_id === m && r.channel === c).map(r => r.t_s).join();
  assert.equal(ticks('a', 'valence'), ticks('b', 'valence'));
  assert.equal(tl.length, 2 * 2 * 22);
  assert.equal(tl[0].seat, 'seat-a');
}

// ---------- ts_group_ms wins over the window offset when present ----------
{
  const w = win('a', 0, [1, 2, 3], { skew: 4_000, stamped: true });
  w.clock_offset_ms = 0; // wrong on purpose: the per-row group stamp must be used
  const tl = groupTimeline({ windows: [w], channels: ['valence'], normalize: 'none' });
  assert.deepEqual(tl.map(r => r.value), [1, 2, 3]);
  assert.equal(tl[0].t_group_ms, T0);
}

// ---------- no statistic in Oyon: value is the physical reading; person_z moved to ladyna ----------
{
  const windows = [win('a', 0, [1, 2, 3, 4, 5]), win('b', 0, [10, 20, 30, 40, 50])];
  const tl = groupTimeline({ windows, channels: ['valence'] });
  assert.deepEqual(tl.filter(r => r.member_id === 'b').map(r => r.value), [10, 20, 30, 40, 50]);
  assert.ok(tl.every(r => r.value === r.value_raw), 'value is value_raw: standardising is ladyna normalizeTimeline');
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => groupTimeline({ windows, channels: ['valence'], normalize: 'person_z' })), 'oyon_group_normalize_moved');
  assert.equal(code(() => groupTimeline({ windows, channels: ['valence'], normalize: 'zz' })), 'oyon_group_bad_input');
}

// ---------- window-level fallback for data recorded before raw_streams ----------
{
  const old = {
    group_id: 'G1', member_id: 'a', valence: 0.4, missing_face_ratio: 0.25,
    window_start: new Date(T0).toISOString(), window_end: new Date(T0 + 5_000).toISOString(),
  };
  const tl = groupTimeline({ windows: [old], channels: ['valence'], normalize: 'none' });
  assert.ok(tl.every(r => r.source === 'window' && r.value === 0.4 && r.quality === 0.75));
  assert.equal(tl.length, 5, 'covers the window and nothing past it');
}

// ---------- derived head speed ----------
{
  const rows = [0, 1, 2].map(i => [T0 + i * 200, null, i * 2, 0, 0, 1]);
  const w = {
    group_id: 'G1', member_id: 'a', window_start: new Date(T0).toISOString(), window_end: new Date(T0 + 1000).toISOString(),
    raw_streams: { head: { fields: ['ts_ms', 'ts_group_ms', 'yaw', 'pitch', 'roll', 'facing_screen'], rows } },
  };
  const tl = groupTimeline({ windows: [w], channels: ['head.speed'], normalize: 'none' });
  assert.deepEqual(tl.map(r => r.value), [null, 10, 10], '2° per 0.2 s = 10 °/s');
}

// ---------- head speed on a custom grid: the angles are resampled on the speed grid ----------
{
  // Six samples over 1 s, yaw 1° per 0.2 s = 5 °/s. Speed requested at 1 Hz:
  // two ticks (0 s, 1 s), speed 5 — not six 1-s-spaced rows reading 1.
  const rows = [0, 1, 2, 3, 4, 5].map(i => [T0 + i * 200, null, i, 0, 0, 1]);
  const w = {
    group_id: 'G1', member_id: 'a', window_start: new Date(T0).toISOString(), window_end: new Date(T0 + 1000).toISOString(),
    raw_streams: { head: { fields: ['ts_ms', 'ts_group_ms', 'yaw', 'pitch', 'roll', 'facing_screen'], rows } },
  };
  const tl = groupTimeline({ windows: [w], channels: ['head.speed', 'head.yaw'], grid_hz: { 'head.speed': 1 } });
  const speed = tl.filter(r => r.channel === 'head.speed');
  assert.deepEqual(speed.map(r => r.t_s), [0, 1]);
  assert.deepEqual(speed.map(r => r.value), [null, 5], '5° over 1 s = 5 °/s');
  assert.equal(speed[1].t_group_ms, T0 + 1000);
  // head.yaw keeps its own (default 5 Hz) grid.
  assert.deepEqual(tl.filter(r => r.channel === 'head.yaw').map(r => r.value), [0, 1, 2, 3, 4, 5]);
}

// ---------- speaking: an event channel holds its state until the next event ----------
{
  const rows = [[T0, null, 'start'], [T0 + 400, null, 'speech'], [T0 + 2_100, null, 'silence'], [T0 + 2_900, null, 'muted'], [T0 + 3_200, null, 'end']];
  const w = {
    group_id: 'G1', member_id: 'a', window_start: new Date(T0).toISOString(), window_end: new Date(T0 + 3_200).toISOString(),
    raw_streams: { speech: { fields: ['ts_ms', 'ts_group_ms', 'state'], rows } },
  };
  const tl = groupTimeline({ windows: [w], channels: ['speaking'] });
  // 5 Hz grid over 0–3.2 s: 17 ticks. A 1.7 s speech turn holds across 9 ticks
  // (a sampled channel would have expired it after 1.5 × the event spacing).
  const S = 'speaking'; const Q = 'silent';
  assert.deepEqual(tl.map(r => r.state), [Q, Q, S, S, S, S, S, S, S, S, S, Q, Q, Q, Q, 'muted', null]);
  assert.equal(tl[16].quality, 0, "'end' closes the turn: missing, quality 0");
}

// ---------- channelMatrix ----------
{
  const tl = groupTimeline({ windows: [win('b', 0, [1, 2]), win('a', 0, [3, 4])], channels: ['valence'], normalize: 'none' });
  const m = channelMatrix(tl, { channel: 'valence' });
  assert.deepEqual(m.members, ['a', 'b']);
  assert.deepEqual(m.values, [[3, 4], [1, 2]]);
  assert.equal(m.step_s, 1);
  assert.deepEqual(channelMatrix(tl, { channel: 'valence', members: ['b'] }).values, [[1, 2]]);
}

// ---------- raw-only envelopes and split windows (lossless delivery) ----------
{
  // Window k=0 split in two: rows 0-4 on the window, rows 5-9 on a continuation part.
  const whole = win('a', 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rows = whole.raw_streams.affect.rows;
  const head = { ...whole, raw_part: { id: 'p1', index: 0, count: 2 }, raw_streams: { affect: { fields: AFFECT, rows: rows.slice(0, 5) } } };
  const part = {
    group_id: 'G1', member_id: 'a', modality: 'raw', raw_part: { id: 'p1', index: 1, count: 2 },
    window_start: head.window_start, window_end: head.window_end,
    raw_streams: { affect: { fields: AFFECT, rows: rows.slice(5) } },
  };
  const joined = groupTimeline({ windows: [head, part], channels: ['valence'] });
  const unsplit = groupTimeline({ windows: [whole], channels: ['valence'] });
  assert.deepEqual(joined.map(r => r.value), unsplit.map(r => r.value));

  // Rows sent at stop, after the last window, extend the member's series.
  const tail = win('a', 1, [7, 8]);
  const stopEnvelope = { ...tail, modality: 'raw', raw_reason: 'stop' };
  const withTail = groupTimeline({ windows: [whole, stopEnvelope], channels: ['valence'] });
  assert.deepEqual(withTail.filter(r => r.t_s >= 10 && r.t_s < 12).map(r => r.value), [7, 8]);

  // A raw-only envelope without the channel's stream writes nothing for it:
  // no window-level fallback (that would be missing values over real ones).
  const headOnly = { group_id: 'G1', member_id: 'a', modality: 'raw', raw_reason: 'stop',
    window_start: whole.window_start, window_end: whole.window_end,
    raw_streams: { head: { fields: ['ts_ms', 'ts_group_ms', 'yaw', 'pitch', 'roll'], rows: [[T0, null, 1, 2, 3]] } } };
  const emotionWindow = { ...win('b', 0, [1]), raw_streams: undefined, valence: 0.5 };
  const tl = groupTimeline({ windows: [whole, headOnly, emotionWindow], channels: ['valence'] });
  assert.deepEqual(tl.filter(r => r.member_id === 'a').map(r => r.value), unsplit.map(r => r.value));
}

// ---------- catalogue ----------
{
  const channels = listGroupChannels();
  assert.ok(channels.some(c => c.channel === 'arousal' && c.evidence === 'primary'));
  assert.ok(channels.some(c => c.channel === 'heart_rate.bpm' && c.evidence === 'experimental'));
  assert.equal(channelSpec('au.smile').stream, 'au');
  assert.equal(channelSpec('nope'), null);
  assert.equal(screenZone(0.3, -0.3, 1), 'top_right');
  assert.equal(screenZone(0, 0, 0), 'off_screen');
}

// ---------- error paths by code ----------
{
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => groupTimeline({ windows: [{ member_id: 'a' }] })), 'oyon_group_missing_context');
  assert.equal(code(() => groupTimeline({ windows: [win('a', 0, [1]), win('b', 0, [1], { group: 'G2' })] })), 'oyon_group_ambiguous');
  assert.equal(code(() => groupTimeline({ windows: [win('a', 0, [1])], channels: ['bogus'] })), 'oyon_group_unknown_channel');
  assert.equal(code(() => groupTimeline({ windows: [win('a', 0, [1])], group_id: 'G9' })), 'oyon_group_empty');
  assert.equal(code(() => groupTimeline({ windows: 'x' })), 'oyon_group_bad_input');
  assert.equal(code(() => channelMatrix([], { channel: 'valence' })), 'oyon_group_unknown_channel');
  assert.deepEqual(checkGroupContext([{ group_id: 'G', member_id: 'm' }, { session_id: 's' }]), [{ index: 1, session_id: 's', missing: 'group_id,member_id' }]);
}

console.log('group-timeline.test.js passed');
