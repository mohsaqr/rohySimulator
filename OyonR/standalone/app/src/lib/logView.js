// logView.js — the Logs page's view of oyon's one log (toLogRows, oyon/records).
//
// The rows come from the library; this file only filters them, words them
// for a table cell and writes the exports. Pure: no DOM, no store.

import { flattenLogRecord } from '../../../../src/records/logRows.js';
import { toCsv } from './groupDashboard.js';

/** Kind tabs, in the order the page lists them; `all` first. */
export const LOG_KIND_TABS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'window', label: 'Windows' },
  { value: 'episode', label: 'Episodes' },
  { value: 'event', label: 'Events' },
  { value: 'log', label: 'Runtime log' },
  { value: 'metric', label: 'Metrics' },
]);

/** The columns every row has, in table and CSV order. */
export const LOG_COLUMNS = Object.freeze([
  'time', 'end', 'duration_ms', 'kind', 'channel', 'label', 'value', 'unit', 'level', 'source',
  'session_id', 'user_id', 'group_id', 'details',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

/** Up to `max` scalar `key=value` pairs of an object, for a one-line cell. */
function scalars(obj, max = 4) {
  if (!isObject(obj)) return '';
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (parts.length >= max) break;
    if (v === null || v === undefined || typeof v === 'object') continue;
    parts.push(`${k}=${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v}`);
  }
  return parts.join(' · ');
}

/** One line saying what else the record holds, per kind. */
export function logDetails(row) {
  const r = row.record;
  switch (row.kind) {
    case 'window':
      return row.blocks.join(' · ');
    case 'episode':
      return scalars(r.summary ?? r.metrics ?? r.typing ?? r.voice ?? r.ai_assist);
    case 'event': {
      const target = isObject(r.target) && typeof r.target.kind === 'string' ? `on ${r.target.kind}` : '';
      return [target, scalars(r.detail)].filter(Boolean).join(' · ');
    }
    case 'log':
      return scalars(r.details);
    case 'metric':
      return scalars(r.tags);
    default:
      return '';
  }
}

/** The fixed columns of one row, as exported and searched. */
export function logRowFields(row) {
  return {
    time: iso(row.ts_ms),
    end: row.end_ms != null && row.end_ms !== row.ts_ms ? iso(row.end_ms) : null,
    duration_ms: row.duration_ms,
    kind: row.kind,
    channel: row.channel,
    label: row.label,
    value: row.value,
    unit: row.unit,
    level: row.level,
    source: row.source,
    session_id: row.session_id,
    user_id: row.user_id,
    group_id: row.group_id,
    details: logDetails(row),
  };
}

/**
 * Narrow rows by kind, channel and level (`'all'` for no narrowing) and a
 * free-text query matched, case-insensitively, against every fixed column.
 */
export function filterLogRows(rows, { kind = 'all', channel = 'all', level = 'all', query = '' } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false;
    if (channel !== 'all' && row.channel !== channel) return false;
    if (level !== 'all' && row.level !== level) return false;
    if (!q) return true;
    return Object.values(logRowFields(row)).some((v) => v != null && String(v).toLowerCase().includes(q));
  });
}

/** Channels present among rows of a kind (`'all'` for every kind), most rows first, then by name. */
export function logChannels(rows, kind = 'all') {
  const counts = new Map();
  for (const row of rows) {
    if (kind !== 'all' && row.kind !== kind) continue;
    counts.set(row.channel, (counts.get(row.channel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, n }));
}

/**
 * The log as CSV: the fixed columns, then — when `wide` — every field of the
 * records flattened (`probabilities.happy`, `engagement.focus_score`, …).
 * Without `wide` each row carries its record as JSON in `record_json`.
 */
export function logCsv(rows, { wide = false } = {}) {
  const table = rows.map((row) => (wide
    ? { ...logRowFields(row), ...prefixed(flattenLogRecord(row.record)) }
    : { ...logRowFields(row), record_json: JSON.stringify(withoutRawStreams(row.record)) }));
  return toCsv(table, LOG_COLUMNS);
}

/** Every row's record with its kind, as JSON — nothing dropped. */
export function logJson(rows) {
  return `${JSON.stringify(rows.map((row) => ({ kind: row.kind, ...row.record })), null, 2)}\n`;
}

/** Flattened record fields under `record.` so they never collide with the fixed columns. */
function prefixed(flat) {
  return Object.fromEntries(Object.entries(flat).map(([k, v]) => [`record.${k}`, v]));
}

/** A record's raw_streams as row counts, so one CSV cell stays a cell. */
function withoutRawStreams(record) {
  if (!isObject(record) || !isObject(record.raw_streams)) return record;
  const counts = Object.fromEntries(Object.entries(record.raw_streams)
    .map(([k, b]) => [k, isObject(b) && Array.isArray(b.rows) ? b.rows.length : null]));
  return { ...record, raw_streams: { rows: counts } };
}
