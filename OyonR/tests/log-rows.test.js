// Tests for src/records/logRows.js — one log over every record kind.
// Plain node, throws on failure.

import assert from 'node:assert/strict';
import { LOG_ROW_KINDS, toLogRows, summarizeLogRows, flattenLogRecord } from '../src/records/index.js';
import * as root from '../src/index.js';

const T = Date.parse('2026-11-14T10:00:00.000Z');
const iso = (ms) => new Date(T + ms).toISOString();

const records = {
  windows: [
    {
      session_id: 's1', context: { user_id: 'u1' }, window_start: iso(0), window_end: iso(10_000),
      dominant_emotion: 'happy', confidence: 0.8, capture_mode: 'camera',
      probabilities: { happy: 0.8, neutral: 0.2 },
      engagement: { focus_score: 0.6, zones: ['top_left', 'middle_center'] },
      raw_streams: { eye: { fields: ['ts_ms', 'ts_group_ms', 'blink'], rows: [[T, null, 0], [T + 66, null, 1]] } },
    },
    { session_id: 's1', window_start: iso(10_000), window_end: iso(20_000), dominant_emotion: 'neutral' },
  ],
  signalWindows: [
    { session_id: 's1', user_id: 'u1', modality: 'typing', window_kind: 'episode', window_start: iso(5_000), window_end: iso(9_000) },
  ],
  signalEvents: [
    { session_id: 's1', user_id: 'u1', modality: 'typing', state: 'burst', source: 'user', timestamp: T + 5_000 },
    // Same instant as the episode's start: the episode is listed first (kind order).
    { session_id: 's2', modality: 'code_run', state: 'failure', source: 'user', timestamp: T + 5_000 },
  ],
  logEvents: [
    { schema_version: 'oyon-log-v1', timestamp: iso(1_000), level: 'warn', source: 'oyon', event_name: 'oyon.group_clock.sync_failed', context: { session_id: 's1' }, details: { message: 'timeout' } },
  ],
  metrics: [
    { schema_version: 'oyon-metric-v1', timestamp: iso(2_000), source: 'oyon', metric_name: 'fps', metric_value: 15, metric_unit: 'Hz', context: { session_id: 's1' } },
  ],
};

// ── One row per record, oldest first, kinds tie-broken in LOG_ROW_KINDS order ──
{
  const rows = toLogRows(records);
  assert.equal(rows.length, 7, 'every record becomes one row');
  assert.deepEqual(rows.map((r) => r.id), ['window:0', 'log:0', 'metric:0', 'episode:0', 'event:0', 'event:1', 'window:1']);
  // Invariant: ts_ms never decreases.
  rows.reduce((prev, r) => { assert.ok(r.ts_ms >= prev); return r.ts_ms; }, -Infinity);

  const [win, log, metric, episode, event] = rows;
  assert.equal(win.kind, 'window');
  assert.equal(win.ts_ms, T);
  assert.equal(win.end_ms, T + 10_000);
  assert.equal(win.duration_ms, 10_000);
  assert.equal(win.channel, 'camera');
  assert.equal(win.label, 'happy');
  assert.equal(win.value, 0.8);
  assert.equal(win.user_id, 'u1', 'identity read from context too');
  assert.deepEqual(win.blocks, ['engagement', 'raw_streams']);
  assert.equal(win.record, records.windows[0], 'the record itself, unchanged');

  assert.deepEqual([log.channel, log.label, log.level, log.session_id], ['log', 'oyon.group_clock.sync_failed', 'warn', 's1']);
  assert.deepEqual([metric.label, metric.value, metric.unit], ['fps', 15, 'Hz']);
  assert.deepEqual([episode.channel, episode.label, episode.duration_ms], ['typing', 'episode', 4_000]);
  assert.deepEqual([event.channel, event.label, event.source, event.duration_ms], ['typing', 'burst', 'user', null]);
  assert.equal(rows[5].user_id, null, 'no user → null, not the internal bucket name');
}

// ── Options: kinds and order ──
{
  assert.deepEqual(toLogRows(records, { kinds: ['event'] }).map((r) => r.id), ['event:0', 'event:1']);
  const desc = toLogRows(records, { order: 'desc' });
  assert.equal(desc[0].id, 'window:1');
  assert.equal(desc.at(-1).id, 'window:0');
  // Deterministic: the same input gives the same rows.
  assert.deepEqual(toLogRows(records).map((r) => r.id), toLogRows(records).map((r) => r.id));
  // Input order of a kind does not change where its rows land in time.
  const swapped = { ...records, windows: [records.windows[1], records.windows[0]] };
  assert.deepEqual(toLogRows(swapped).map((r) => r.label).filter((l) => l === 'happy' || l === 'neutral'), ['happy', 'neutral']);
}

// ── Missing kinds are empty; untimed records sort last; non-objects are skipped ──
{
  assert.deepEqual(toLogRows({}), []);
  const rows = toLogRows({ signalEvents: [{ modality: 'typing', state: 'pause' }, null, 'x', { modality: 'typing', state: 'burst', timestamp: T }] });
  assert.deepEqual(rows.map((r) => [r.label, r.ts_ms]), [['burst', T], ['pause', null]]);
}

// ── Error paths ──
assert.throws(() => toLogRows(null), TypeError);
assert.throws(() => toLogRows({ windows: {} }), TypeError);
assert.throws(() => toLogRows(records, { kinds: ['windows'] }), TypeError, 'plural input name is not a row kind');
assert.throws(() => toLogRows(records, { order: 'newest' }), TypeError);

// ── summarizeLogRows ──
{
  const s = summarizeLogRows(toLogRows(records));
  assert.equal(s.total, 7);
  assert.deepEqual(s.kinds, { window: 2, episode: 1, event: 2, log: 1, metric: 1 });
  assert.deepEqual(s.channels, { camera: 2, log: 1, metric: 1, typing: 2, code_run: 1 });
  assert.deepEqual(s.levels, { warn: 1 });
  assert.equal(s.sessions, 2);
  assert.equal(s.people, 1);
  assert.equal(s.firstMs, T);
  assert.equal(s.lastMs, T + 20_000);
  assert.deepEqual(summarizeLogRows([]).kinds, Object.fromEntries(LOG_ROW_KINDS.map((k) => [k, 0])));
}

// ── flattenLogRecord ──
{
  const flat = flattenLogRecord(records.windows[0]);
  assert.equal(flat['probabilities.happy'], 0.8);
  assert.equal(flat['context.user_id'], 'u1');
  assert.equal(flat['engagement.zones'], 'top_left|middle_center');
  assert.equal(flat['raw_streams.eye.rows'], 2, 'raw streams become a row count');
  assert.ok(!Object.keys(flat).some((k) => k.startsWith('raw_streams.eye.fields')));
  assert.equal(flattenLogRecord({ a: { b: { c: 1 } } }, { maxDepth: 1 }).a, '{"b":{"c":1}}');
  assert.equal(flattenLogRecord({ x: NaN }).x, null);
  assert.deepEqual(flattenLogRecord(null), {});
}

// ── Exported from the package root too ──
assert.equal(root.toLogRows, toLogRows);
assert.equal(root.flattenLogRecord, flattenLogRecord);

console.log('log-rows: ok');
