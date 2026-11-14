/**
 * logRows — one log over every kind of record Oyon writes.
 *
 * Oyon keeps five record kinds, each in its own store and shape:
 *
 *   windows        interval windows (camera: emotion, engagement, gaze, …)
 *   signalWindows  episode windows (a typing episode, a voice turn, an AI cycle)
 *   signalEvents   per-event states (typing, interaction, ai_assist, voice,
 *                  document_edit, code_run)
 *   logEvents      `oyon-log-v1` runtime / host log events
 *   metrics        `oyon-metric-v1` runtime metrics
 *
 * `toLogRows` reads them all into ONE row shape, in time order, so a host or
 * the app can list, filter, search and export them as one log. Each row keeps
 * the record it came from (`record`), so nothing is lost; `flattenLogRecord`
 * spreads any record into dotted columns for a wide export.
 *
 * Pure: no DOM, no store. Display text is not built here — rows carry fields.
 */

import { recordGroupId, recordSessionId, recordUserId, DEFAULT_SESSION, DEFAULT_USER } from './hostRecords.js';

/** Row kinds, in the order a tie at the same instant is listed. */
export const LOG_ROW_KINDS = Object.freeze(['window', 'episode', 'event', 'log', 'metric']);

/** Which input field holds each row kind. */
const SOURCES = Object.freeze({
  window: 'windows',
  episode: 'signalWindows',
  event: 'signalEvents',
  log: 'logEvents',
  metric: 'metrics',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' && v.length > 0 ? v : null);

function timeMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `[startMs, endMs]` of any record kind; either may be null. */
function span(record) {
  const start = timeMs(record.window_start_ms) ?? timeMs(record.window_start) ?? timeMs(record.timestamp);
  const end = timeMs(record.window_end_ms) ?? timeMs(record.window_end) ?? start;
  return [start ?? end, end];
}

/** The camera blocks a window carries, in a fixed order. */
const WINDOW_BLOCKS = [
  'engagement', 'gaze', 'facial', 'posture', 'heart_rate', 'respiration', 'illumination',
  'typing', 'interaction', 'text', 'voice', 'raw_streams',
];

/** Kind-specific fields of one row. Every field is present on every row (null when it does not apply). */
function fieldsOf(kind, record) {
  switch (kind) {
    case 'window':
      return {
        channel: text(record.modality) ?? 'camera',
        label: text(record.dominant_emotion),
        source: text(record.capture_mode),
        level: null,
        value: Number.isFinite(record.confidence) ? record.confidence : null,
        unit: null,
        blocks: WINDOW_BLOCKS.filter((b) => isObject(record[b])),
      };
    case 'episode':
      return {
        channel: text(record.modality) ?? 'episode',
        label: text(record.window_kind) ?? 'episode',
        source: text(record.source),
        level: null,
        value: null,
        unit: null,
        blocks: [],
      };
    case 'event':
      return {
        channel: text(record.modality) ?? 'event',
        label: text(record.state),
        source: text(record.source),
        level: null,
        value: null,
        unit: null,
        blocks: [],
      };
    case 'log':
      return {
        channel: 'log',
        label: text(record.event_name),
        source: text(record.source),
        level: text(record.level) ?? 'info',
        value: null,
        unit: null,
        blocks: [],
      };
    case 'metric':
      return {
        channel: 'metric',
        label: text(record.metric_name),
        source: text(record.source),
        level: null,
        value: Number.isFinite(record.metric_value) ? record.metric_value : null,
        unit: text(record.metric_unit),
        blocks: [],
      };
    default:
      throw new TypeError(`toLogRows: unknown kind ${kind}`);
  }
}

/**
 * Every record as one log row, oldest first (or newest first with
 * `order: 'desc'`). Ties at the same instant follow `LOG_ROW_KINDS`, then the
 * record's position in its input array — deterministic for the same input.
 * Records with no readable time sort last and keep `ts_ms: null`.
 *
 * @param {{windows?: unknown[], signalWindows?: unknown[], signalEvents?: unknown[],
 *   logEvents?: unknown[], metrics?: unknown[]}} records
 * @param {{kinds?: string[], order?: 'asc'|'desc'}} [options]
 * @returns {Array<{id: string, kind: string, index: number, ts_ms: number|null, end_ms: number|null,
 *   duration_ms: number|null, session_id: string|null, user_id: string|null, group_id: string|null,
 *   channel: string, label: string|null, source: string|null, level: string|null, value: number|null,
 *   unit: string|null, blocks: string[], record: object}>}
 * @throws {TypeError} when `records` is not an object, a supplied kind is not
 *   an array, or `kinds` names an unknown kind.
 */
export function toLogRows(records, options = {}) {
  if (!isObject(records)) throw new TypeError('toLogRows: records must be an object');
  const kinds = options.kinds ?? LOG_ROW_KINDS;
  const unknown = list(kinds).filter((k) => !LOG_ROW_KINDS.includes(k));
  if (!Array.isArray(kinds) || unknown.length) {
    throw new TypeError(`toLogRows: unknown kind(s) ${unknown.join(', ') || String(kinds)}; expected ${LOG_ROW_KINDS.join(', ')}`);
  }
  const order = options.order ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw new TypeError("toLogRows: order must be 'asc' or 'desc'");

  const rows = [];
  for (const kind of LOG_ROW_KINDS) {
    if (!kinds.includes(kind)) continue;
    const input = records[SOURCES[kind]];
    if (input != null && !Array.isArray(input)) throw new TypeError(`toLogRows: records.${SOURCES[kind]} must be an array`);
    list(input).forEach((record, index) => {
      if (!isObject(record)) return;
      const [start, end] = span(record);
      const session = recordSessionId(record);
      const user = recordUserId(record);
      rows.push({
        id: `${kind}:${index}`,
        kind,
        index,
        ts_ms: start,
        end_ms: end,
        duration_ms: start != null && end != null && end > start ? end - start : null,
        session_id: session === DEFAULT_SESSION ? null : session,
        user_id: user === DEFAULT_USER ? null : user,
        group_id: recordGroupId(record),
        ...fieldsOf(kind, record),
        record,
      });
    });
  }
  const rank = Object.fromEntries(LOG_ROW_KINDS.map((k, i) => [k, i]));
  const sign = order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (a.ts_ms == null || b.ts_ms == null) {
      if (a.ts_ms != null) return -1;
      if (b.ts_ms != null) return 1;
    } else if (a.ts_ms !== b.ts_ms) {
      return sign * (a.ts_ms - b.ts_ms);
    }
    return (rank[a.kind] - rank[b.kind]) || (a.index - b.index);
  });
  return rows;
}

/**
 * Counts over a set of log rows, for the log's header: rows per kind and per
 * channel, distinct sessions and people, and the time span.
 *
 * @param {ReturnType<typeof toLogRows>} rows
 * @returns {{total: number, kinds: Record<string, number>, channels: Record<string, number>,
 *   levels: Record<string, number>, sessions: number, people: number,
 *   firstMs: number|null, lastMs: number|null}}
 */
export function summarizeLogRows(rows) {
  const kinds = Object.fromEntries(LOG_ROW_KINDS.map((k) => [k, 0]));
  const channels = {};
  const levels = {};
  const sessions = new Set();
  const people = new Set();
  let firstMs = null;
  let lastMs = null;
  for (const row of list(rows)) {
    kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    channels[row.channel] = (channels[row.channel] ?? 0) + 1;
    if (row.level) levels[row.level] = (levels[row.level] ?? 0) + 1;
    if (row.session_id) sessions.add(row.session_id);
    if (row.user_id) people.add(row.user_id);
    if (row.ts_ms != null) firstMs = firstMs == null ? row.ts_ms : Math.min(firstMs, row.ts_ms);
    const end = row.end_ms ?? row.ts_ms;
    if (end != null) lastMs = lastMs == null ? end : Math.max(lastMs, end);
  }
  return { total: list(rows).length, kinds, channels, levels, sessions: sessions.size, people: people.size, firstMs, lastMs };
}

/**
 * Spread one record into flat dotted columns (`engagement.focus_score`,
 * `probabilities.happy`, …) for a wide table or CSV. Arrays of scalars are
 * joined with `|`; other arrays are kept as JSON text. `raw_streams` — the
 * per-sample series — becomes its row count per stream
 * (`raw_streams.eye.rows`), since the samples themselves do not fit one cell;
 * the record itself still holds them.
 *
 * @param {object} record
 * @param {{maxDepth?: number}} [options] objects deeper than this (default 4) are kept as JSON text
 * @returns {Record<string, string|number|boolean|null>}
 */
export function flattenLogRecord(record, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0 ? options.maxDepth : 4;
  const out = {};
  const walk = (value, path, depth) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return;
    if (value === null || typeof value !== 'object') {
      out[path] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
      return;
    }
    if (Array.isArray(value)) {
      out[path] = value.every((v) => v === null || typeof v !== 'object') ? value.join('|') : JSON.stringify(value);
      return;
    }
    if (depth >= maxDepth) {
      out[path] = JSON.stringify(value);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (next === 'raw_streams' && isObject(item)) {
        for (const [stream, block] of Object.entries(item)) {
          out[`raw_streams.${stream}.rows`] = isObject(block) && Array.isArray(block.rows) ? block.rows.length : null;
        }
        continue;
      }
      walk(item, next, depth + 1);
    }
  };
  if (isObject(record)) walk(record, '', 0);
  return out;
}
