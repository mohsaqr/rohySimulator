/*
 * Incremental reading of the uncapped runtime log (lib/runtimeLogStore.ts).
 * Plain JS with a .d.ts so the node tests run it.
 *
 * A cache holds the entries read so far, in timestamp order, and their keys.
 * A poll reads only entries at or after `sinceFor(cache.rows)` (a look-back
 * before the newest entry held, for writes that land late with an older
 * timestamp, e.g. a retried flush) and merges them by key.
 */

/** How far before the newest held entry an incremental read starts. */
export const RUNTIME_LOG_LOOKBACK_MS = 5 * 60_000;

const timeOf = (r) => (typeof r?.timestamp === 'string' ? r.timestamp : '');

/**
 * @template T
 * @param {{ rows: T[], keys: Set<string> } | null} cache  null: start from `read`
 * @param {T[]} read  entries just read
 * @param {(row: T) => string} keyOf
 * @returns {{ rows: T[], keys: Set<string> }}  the same cache when nothing is new
 */
export function mergeIncremental(cache, read, keyOf) {
  if (!Array.isArray(read)) throw new TypeError('mergeIncremental: `read` must be an array');
  if (typeof keyOf !== 'function') throw new TypeError('mergeIncremental: `keyOf` must be a function');
  if (!cache) return { rows: read.slice(), keys: new Set(read.map(keyOf)) };
  const fresh = read.filter((r) => !cache.keys.has(keyOf(r)));
  if (!fresh.length) return cache;
  const rows = cache.rows.concat(fresh);
  const last = cache.rows.length ? timeOf(cache.rows[cache.rows.length - 1]) : '';
  if (fresh.some((r) => timeOf(r) < last)) {
    rows.sort((a, b) => timeOf(a).localeCompare(timeOf(b)) || keyOf(a).localeCompare(keyOf(b)));
  }
  const keys = new Set(cache.keys);
  fresh.forEach((r) => keys.add(keyOf(r)));
  return { rows, keys };
}

/** The `since` of an incremental read, or null (read whole) when nothing is held. */
export function sinceFor(rows, lookbackMs = RUNTIME_LOG_LOOKBACK_MS) {
  const last = Array.isArray(rows) && rows.length ? timeOf(rows[rows.length - 1]) : '';
  const ms = Date.parse(last);
  return Number.isFinite(ms) ? new Date(ms - lookbackMs).toISOString() : null;
}
