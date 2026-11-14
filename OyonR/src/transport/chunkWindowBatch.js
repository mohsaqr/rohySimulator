/**
 * chunkWindowBatch — split a window batch into POST bodies under a byte budget,
 * losslessly.
 *
 * Windows carry per-sample `raw_streams`, so one batch (or one window) can be
 * larger than a receiver's body-parser limit (Rohy's is 256 KiB). Nothing is
 * cut to fit:
 *
 * 1. A window whose JSON is over the budget is split. The window keeps as many
 *    raw rows as fit; the rest go into raw-only continuation events
 *    (`modality: 'raw'`, `raw_reason: 'continuation'`) with the window's
 *    interval and identity. Every part carries `raw_part: { id, index, count }`
 *    — the same `id` on all parts, the window itself at index 0 — so a reader
 *    rebuilds the window with `joinRawParts()` (src/records/rawParts.js).
 * 2. The events are then packed, in order, into batches whose serialized
 *    `{ schema_version, events }` body is at most `maxBytes` UTF-8 bytes and
 *    holds at most `maxEvents` events.
 *
 * Sizes are exact: the body is the concatenation of the pieces measured here.
 * An event that cannot be brought under the budget (its non-raw part alone is
 * too large, or a single raw row is) throws — it is never truncated.
 */

export const DEFAULT_MAX_POST_BYTES = 245760;
const DEFAULT_MAX_EVENTS = 120;
const DEFAULT_MAX_RAW_STREAM_BYTES = 1_000_000;

/** Summary fields of an emotion window that a continuation part does not repeat. */
const SUMMARY_KEYS = new Set([
  'dominant_emotion', 'probabilities', 'valence', 'valence_std', 'valence_min', 'valence_max',
  'arousal', 'arousal_std', 'arousal_min', 'arousal_max', 'confidence', 'confidence_std',
  'entropy', 'entropy_std', 'stability_score', 'label_switch_count', 'valid_frames',
  'missing_face_ratio', 'expected_samples', 'duration_ms', 'model_name', 'model_version',
]);

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** UTF-8 byte length of a string. */
export function utf8Bytes(text) {
  if (encoder) return encoder.encode(text).length;
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

const jsonBytes = value => utf8Bytes(JSON.stringify(value));

/**
 * @param {object[]} events
 * @param {object} [options]
 * @param {number} [options.maxBytes=245760]          budget of one POST body
 * @param {string} [options.schemaVersion]            the body's schema_version
 * @param {number} [options.maxEvents=120]            events per batch
 * @param {number} [options.maxRawStreamBytes=1e6]    raw_streams JSON per event (the validator's bound)
 * @param {(event: object) => string} [options.newId] part-group id of an oversized event;
 *   default `rawPartId(event)`, derived from the window's identity and span, so
 *   a retried send gives its parts the same id and a receiver's key on it holds
 * @returns {object[][]} batches, in order; their concatenation holds every row of the input
 */
export function chunkWindowBatch(events, options = {}) {
  if (!Array.isArray(events)) throw new TypeError('chunkWindowBatch: events must be an array');
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_POST_BYTES;
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : DEFAULT_MAX_EVENTS;
  const maxRawBytes = Number.isFinite(options.maxRawStreamBytes) && options.maxRawStreamBytes > 0
    ? options.maxRawStreamBytes
    : DEFAULT_MAX_RAW_STREAM_BYTES;
  const newId = typeof options.newId === 'function' ? options.newId : rawPartId;
  const shell = options.schemaVersion === undefined ? { events: [] } : { schema_version: options.schemaVersion, events: [] };
  // `{"schema_version":"…","events":[]}`: every event adds its bytes, plus a comma after the first.
  const overhead = jsonBytes(shell);
  const eventBudget = maxBytes - overhead;

  const parts = [];
  for (const event of events) {
    const size = jsonBytes(event);
    const rawSize = event?.raw_streams ? jsonBytes(event.raw_streams) : 0;
    if (size <= eventBudget && rawSize <= maxRawBytes) parts.push({ event, size });
    else for (const part of splitEvent(event, eventBudget, maxRawBytes, newId)) parts.push(part);
  }

  const batches = [];
  let batch = []; let used = 0;
  for (const { event, size } of parts) {
    const add = batch.length ? size + 1 : size;
    if (batch.length && (used + add > eventBudget || batch.length >= maxEvents)) {
      batches.push(batch);
      batch = []; used = 0;
    }
    used += batch.length ? size + 1 : size;
    batch.push(event);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** One oversized event → the event (with the rows that fit) + continuation parts. */
function splitEvent(event, eventBudget, maxRawBytes, newId) {
  const streams = event?.raw_streams;
  const hasRows = streams && typeof streams === 'object'
    && Object.values(streams).some(b => Array.isArray(b?.rows) && b.rows.length);
  if (!hasRows) {
    throw new Error(`Oyon window is ${jsonBytes(event)} bytes, over the ${eventBudget}-byte POST budget, and has no raw rows to split`);
  }
  const id = newId(event);
  const { raw_streams: _omit, ...base } = event;
  const continuation = continuationShell(base);

  // Exact sizes: a part is its shell with `"raw_streams":{}` plus, per stream,
  // `"name":{…"rows":[]}` and its rows joined by commas.
  const PLACEHOLDER = { id, index: 0, count: 0 };
  const shellOf = (shellEvent) => jsonBytes({ ...shellEvent, raw_part: PLACEHOLDER, raw_streams: {} });
  const builders = [];
  const open = (shellEvent) => {
    const b = { shellEvent, size: shellOf(shellEvent), raw: 2, streams: {} };
    if (b.size > eventBudget) {
      throw new Error(`Oyon window without its raw rows is ${b.size} bytes, over the ${eventBudget}-byte POST budget`);
    }
    builders.push(b);
    return b;
  };
  // The count placeholder is one digit; reserve room for the real count's digits.
  const COUNT_SLACK = 8;
  let current = open(base);

  for (const [name, block] of Object.entries(streams)) {
    if (!block || !Array.isArray(block.rows)) continue;
    const blockShell = { ...block, rows: [] };
    const headBytes = jsonBytes(name) + 1 + jsonBytes(blockShell); // "name":{…,"rows":[]}
    for (const row of block.rows) {
      const rowBytes = jsonBytes(row);
      const target = current.streams[name];
      const add = target
        ? rowBytes + (target.rows.length ? 1 : 0)
        : headBytes + (Object.keys(current.streams).length ? 1 : 0) + rowBytes;
      const fits = current.size + add + COUNT_SLACK <= eventBudget && current.raw + add <= maxRawBytes;
      if (!fits) {
        const empty = Object.keys(current.streams).length === 0;
        if (empty) {
          throw new Error(`A raw_streams.${name} row is too large for the ${eventBudget}-byte POST budget`);
        }
        current = open(continuation);
        const fresh = headBytes + rowBytes;
        if (current.size + fresh + COUNT_SLACK > eventBudget || current.raw + fresh > maxRawBytes) {
          throw new Error(`A raw_streams.${name} row is too large for the ${eventBudget}-byte POST budget`);
        }
        current.streams[name] = { ...blockShell, rows: [row] };
        current.size += fresh; current.raw += fresh;
        continue;
      }
      if (target) target.rows.push(row);
      else current.streams[name] = { ...blockShell, rows: [row] };
      current.size += add; current.raw += add;
    }
  }

  const count = builders.length;
  return builders.map((b, index) => {
    const part = { ...b.shellEvent, raw_part: { id, index, count }, raw_streams: b.streams };
    return { event: part, size: jsonBytes(part) };
  });
}

/** Identity, interval and alignment of a window, as a raw-only continuation part. */
function continuationShell(base) {
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    if (SUMMARY_KEYS.has(key)) continue;
    if (value !== null && typeof value === 'object') continue; // measurement blocks stay on the window
    out[key] = value;
  }
  out.modality = 'raw';
  out.window_kind = 'interval';
  out.raw_reason = 'continuation';
  out.raw_parent_modality = typeof base.modality === 'string' ? base.modality : 'emotion';
  for (const flag of Object.keys(out)) if (flag.endsWith('_only')) delete out[flag];
  return out;
}

/** The identity and span that make a window one window. */
const PART_ID_FIELDS = [
  'session_id', 'user_id', 'member_id', 'group_id', 'track_id', 'capture_id',
  'modality', 'window_kind', 'window_index', 'window_start', 'window_end',
];

/**
 * The `raw_part.id` of a window's parts: `rp-` + a 64-bit FNV-1a hash (two
 * 32-bit lanes) of its identity and span. Deterministic, so the same window
 * sent twice (a retry) splits into parts with the same id — a receiver keyed
 * on it keeps one copy and can join parts across sends.
 *
 * @param {object} event
 * @returns {string}
 */
export function rawPartId(event) {
  const key = JSON.stringify(PART_ID_FIELDS.map((f) => (event && event[f] !== undefined ? event[f] : null)));
  return `rp-${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}`;
}

function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
