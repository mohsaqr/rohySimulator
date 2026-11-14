import { IndexedDbLogTransport, IndexedDbMetricTransport, LocalLogTransport, LocalMetricTransport } from 'oyon';
import type { OyonLogEvent, OyonMetric } from 'oyon';
import { mergeIncremental, sinceFor } from './logIncremental.js';
import type { LogCache } from './logIncremental.js';

/*
 * Where the app's runtime log and metrics live.
 *
 * Since the logs were unified they are written uncapped to IndexedDB, in the
 * same database as the windows and events (`oyon-app`: runtime_events,
 * metrics). Before that they were the last 1000 / 2000 entries in
 * localStorage; those older entries (and the demo data, which still writes
 * there) are read too, so nothing already recorded disappears.
 */

export const RUNTIME_LOG_DB = 'oyon-app';
/** The localStorage keys the runtime wrote before, and the demo data writes. */
export const LEGACY_LOG_KEY = 'oyon-app-logs';
export const LEGACY_METRICS_KEY = 'oyon-app-metrics';

export interface RuntimeLog {
  logEvents: OyonLogEvent[];
  metrics: OyonMetric[];
}

// One reader per store for the page's lifetime: each transport holds one
// IndexedDB connection, opened on the first read and reused by every later
// read and clear (a fresh transport per poll opened a connection each time
// and never closed it).
let logReader: IndexedDbLogTransport | null = null;
let metricReader: IndexedDbMetricTransport | null = null;
function readers() {
  logReader ??= new IndexedDbLogTransport({ dbName: RUNTIME_LOG_DB });
  metricReader ??= new IndexedDbMetricTransport({ dbName: RUNTIME_LOG_DB });
  return { logs: logReader, metrics: metricReader };
}

/*
 * Incremental reads for the Logs page. While a capture is live the page polls;
 * re-reading and re-sorting the whole uncapped archive each time grows with
 * every session ever recorded. Instead each store keeps what it has read
 * (sorted, with its keys) and a poll reads only entries from a look-back
 * before the newest one held (`read({ since })`, the timestamp index),
 * merging by key. The look-back covers entries written late with an older
 * timestamp (the logger retries a failed write with the next flush); a
 * capture starting or stopping, Clear, and every export read the archive
 * whole, so nothing is missed for longer than a live session.
 */
type StoreCache<T> = LogCache<T>;
let logCache: StoreCache<OyonLogEvent> | null = null;
let metricCache: StoreCache<OyonMetric> | null = null;

const logKey = (r: OyonLogEvent) => String((r as { event_id?: unknown }).event_id ?? '');
const metricKey = (r: OyonMetric) => String((r as { metric_id?: unknown }).metric_id ?? '');

/**
 * The runtime log: IndexedDB plus the legacy localStorage entries.
 * `incremental: true` (the Logs page's poll) reads only the newer IndexedDB
 * entries when the archive was read before; otherwise the archive is read
 * whole (exports always are).
 */
export async function readRuntimeLog(options: { incremental?: boolean } = {}): Promise<RuntimeLog> {
  const { logs, metrics } = readers();
  const incremental = options.incremental === true;
  const logSince = incremental && logCache ? sinceFor(logCache.rows) : null;
  const metricSince = incremental && metricCache ? sinceFor(metricCache.rows) : null;
  const [idbLogs, idbMetrics] = await Promise.all([
    readOrEmpty(() => (logSince ? logs.read({ since: logSince }) : logs.read())),
    readOrEmpty(() => (metricSince ? metrics.read({ since: metricSince }) : metrics.read())),
  ]);
  logCache = mergeIncremental(logSince ? logCache : null, idbLogs, logKey);
  metricCache = mergeIncremental(metricSince ? metricCache : null, idbMetrics, metricKey);
  return {
    logEvents: [...new LocalLogTransport({ storageKey: LEGACY_LOG_KEY }).read(), ...logCache.rows],
    metrics: [...new LocalMetricTransport({ storageKey: LEGACY_METRICS_KEY }).read(), ...metricCache.rows],
  };
}

/** Empty both stores (IndexedDB and the legacy keys). */
export async function clearRuntimeLog(): Promise<void> {
  new LocalLogTransport({ storageKey: LEGACY_LOG_KEY }).clear();
  new LocalMetricTransport({ storageKey: LEGACY_METRICS_KEY }).clear();
  logCache = null;
  metricCache = null;
  const { logs, metrics } = readers();
  await Promise.all([logs.clear(), metrics.clear()]);
}

async function readOrEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    // No IndexedDB (private window, blocked storage): the legacy entries are
    // all there is. Said in the console, not hidden.
    console.warn('[oyon] runtime log: IndexedDB unavailable', err);
    return [];
  }
}
