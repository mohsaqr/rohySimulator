// Tests for standalone/app/src/lib/logView.js — the Logs page's view of
// oyon's one log (toLogRows). Plain node, throws on failure.

import assert from 'node:assert/strict';
import { toLogRows } from '../src/records/index.js';
import { mergeIncremental, sinceFor, RUNTIME_LOG_LOOKBACK_MS } from '../standalone/app/src/lib/logIncremental.js';
import { readFileSync } from 'node:fs';
import {
  LOG_KIND_TABS, LOG_COLUMNS, filterLogRows, logChannels, logCsv, logJson, logDetails, logRowFields,
} from '../standalone/app/src/lib/logView.js';

const T = Date.parse('2026-11-14T10:00:00.000Z');
const iso = (ms) => new Date(T + ms).toISOString();
const rows = toLogRows({
  windows: [{
    session_id: 's1', window_start: iso(0), window_end: iso(10_000), dominant_emotion: 'happy', confidence: 0.8,
    engagement: { focus_score: 0.6 },
    raw_streams: { eye: { fields: ['ts_ms', 'blink'], rows: [[T, 0], [T + 66, 1], [T + 132, 0]] } },
  }],
  signalEvents: [
    { session_id: 's1', modality: 'typing', state: 'burst', source: 'user', timestamp: T + 1_000, target: { kind: 'textarea' }, detail: { chars: 12 } },
    { session_id: 's2', modality: 'code_run', state: 'failure', source: 'user', timestamp: T + 2_000, detail: { error_kind: 'SyntaxError' } },
  ],
  logEvents: [
    { timestamp: iso(3_000), level: 'error', source: 'oyon', event_name: 'oyon.camera.failed', context: { session_id: 's1' }, details: { message: 'NotAllowedError' } },
    { timestamp: iso(4_000), level: 'info', source: 'oyon', event_name: 'oyon.started', context: { session_id: 's1' }, details: {} },
  ],
  metrics: [{ timestamp: iso(5_000), metric_name: 'fps', metric_value: 14.5, metric_unit: 'Hz', context: { session_id: 's1' }, tags: { stage: 'landmarks' } }],
}, { order: 'desc' });

// Kind tabs cover every row kind, All first.
assert.deepEqual(LOG_KIND_TABS.map((t) => t.value), ['all', 'window', 'episode', 'event', 'log', 'metric']);

// One-line details per kind.
const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
assert.equal(logDetails(byLabel.happy), 'engagement · raw_streams');
assert.equal(logDetails(byLabel.burst), 'on textarea · chars=12');
assert.equal(logDetails(byLabel['oyon.camera.failed']), 'message=NotAllowedError');
assert.equal(logDetails(byLabel.fps), 'stage=landmarks');

// Fixed fields: ISO time, no `end` for instants.
const f = logRowFields(byLabel.happy);
assert.equal(f.time, iso(0));
assert.equal(f.end, iso(10_000));
assert.equal(logRowFields(byLabel.burst).end, null);
assert.deepEqual(Object.keys(f), [...LOG_COLUMNS]);

// Filters: kind, channel, level, query (case-insensitive, any fixed column).
assert.equal(filterLogRows(rows).length, 6);
assert.deepEqual(filterLogRows(rows, { kind: 'event' }).map((r) => r.label), ['failure', 'burst']);
assert.deepEqual(filterLogRows(rows, { channel: 'code_run' }).map((r) => r.label), ['failure']);
assert.deepEqual(filterLogRows(rows, { level: 'error' }).map((r) => r.label), ['oyon.camera.failed']);
assert.deepEqual(filterLogRows(rows, { query: 'NOTALLOWED' }).map((r) => r.label), ['oyon.camera.failed']);
assert.deepEqual(filterLogRows(rows, { query: 's2' }).map((r) => r.label), ['failure']);
assert.equal(filterLogRows(rows, { query: '   ' }).length, 6, 'a blank query narrows nothing');
// Invariant: filtering never invents or reorders rows.
const some = filterLogRows(rows, { kind: 'log' });
assert.deepEqual(some, rows.filter((r) => some.includes(r)));

// Channels: most rows first, then by name.
assert.deepEqual(logChannels(rows), [
  { value: 'log', n: 2 }, { value: 'camera', n: 1 }, { value: 'code_run', n: 1 }, { value: 'metric', n: 1 }, { value: 'typing', n: 1 },
]);
assert.deepEqual(logChannels(rows, 'event').map((c) => c.value), ['code_run', 'typing']);

// CSV under All: fixed columns + record_json, with raw_streams as row counts.
{
  const csv = logCsv(rows);
  const [head, ...lines] = csv.trim().split('\r\n');
  assert.deepEqual(head.split(','), [...LOG_COLUMNS, 'record_json']);
  assert.equal(lines.length, 6);
  assert.match(csv, /""rows"":\{""eye"":3\}/, 'raw_streams become counts in the CSV cell');
}
// CSV under one kind: every record field as its own column.
{
  const csv = logCsv(filterLogRows(rows, { kind: 'window' }), { wide: true });
  const head = csv.split('\r\n')[0].split(',');
  assert.ok(head.includes('record.engagement.focus_score'));
  assert.ok(head.includes('record.raw_streams.eye.rows'));
  assert.ok(!head.includes('record_json'));
}
// JSON keeps the records whole, raw streams included.
{
  const out = JSON.parse(logJson(rows));
  assert.equal(out.length, 6);
  const win = out.find((r) => r.kind === 'window');
  assert.equal(win.raw_streams.eye.rows.length, 3);
}

// ---------- incremental runtime-log reads (Codex #16) ----------
{
  const key = (r) => r.event_id;
  const e = (id, ts) => ({ event_id: id, timestamp: ts });
  const first = mergeIncremental(null, [e('a', '2026-01-01T00:00:00.000Z'), e('b', '2026-01-01T00:00:05.000Z')], key);
  assert.deepEqual(first.rows.map(key), ['a', 'b']);
  // An inclusive re-read of what is held changes nothing (same cache back).
  assert.equal(mergeIncremental(first, [e('b', '2026-01-01T00:00:05.000Z')], key), first);
  // New entries append; a late write with an older timestamp is put in order.
  const next = mergeIncremental(first, [e('b', '2026-01-01T00:00:05.000Z'), e('d', '2026-01-01T00:00:09.000Z'), e('c', '2026-01-01T00:00:03.000Z')], key);
  assert.deepEqual(next.rows.map(key), ['a', 'c', 'b', 'd']);
  assert.equal(first.rows.length, 2, 'the old cache is not mutated');
  // since = newest held minus the look-back; nothing held → read whole.
  assert.equal(sinceFor(next.rows), new Date(Date.parse('2026-01-01T00:00:09.000Z') - RUNTIME_LOG_LOOKBACK_MS).toISOString());
  assert.equal(sinceFor([]), null);
  assert.throws(() => mergeIncremental(null, 'x', key), TypeError);
  const store = readFileSync(new URL('../standalone/app/src/lib/runtimeLogStore.ts', import.meta.url), 'utf8');
  assert.match(store, /logs\.read\(\{ since: logSince \}\)/, 'the poll reads by timestamp index');
  const hook = readFileSync(new URL('../standalone/app/src/lib/logRecords.ts', import.meta.url), 'utf8');
  assert.match(hook, /readRuntimeLog\(\{ incremental: true \}\)/);
}

console.log('app-logs: ok');
