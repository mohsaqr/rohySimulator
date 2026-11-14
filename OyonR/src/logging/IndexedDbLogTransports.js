/**
 * IndexedDB transports for the runtime log and metrics — the complete record,
 * beside the windows and events in the same database.
 *
 * `LocalLogTransport` / `LocalMetricTransport` keep the last 1000 / 2000
 * entries in localStorage, which drops every older session's log. These keep
 * every entry (research-grade data policy) in the `runtime_events` and
 * `metrics` stores that `IndexedDbOyonStore` has always created, so a session's
 * windows, events, log and metrics live and export together.
 *
 * Each entry gets a store key (`event_id` / `metric_id`) when it has none;
 * nothing else about it changes. A batch is written in ONE transaction (all
 * or none), so a failed write that the logger retries never leaves half a
 * batch behind to be duplicated. Write failures reject; OyonLogger /
 * OyonMetricRecorder report them and retry (src/logging/RecordDelivery.js).
 *
 * Cheap to construct: transports on the same database share one store and
 * so one open connection (`sharedOyonStore`). `read({ since })` reads only
 * entries from a timestamp on, through the store's `timestamp` index.
 */

import { IndexedDbOyonStore, oyonRecordId } from '../storage/IndexedDbOyonStore.js';

const timeOf = (r) => (typeof r?.timestamp === 'string' ? r.timestamp : '');
const sharedStores = new Map();

/** One IndexedDbOyonStore (one connection) per database name, shared by every transport on it. */
export function sharedOyonStore(dbName = 'oyon') {
  if (!sharedStores.has(dbName)) sharedStores.set(dbName, new IndexedDbOyonStore({ dbName }));
  return sharedStores.get(dbName);
}

class IndexedDbRecordTransport {
  /**
   * @param {string} storeName  `runtime_events` | `metrics`
   * @param {string} idKey      the store's key path
   * @param {string} idPrefix   prefix of generated keys
   * @param {{store?: object, dbName?: string}} options
   *   `store` — an IndexedDbOyonStore (or anything with put/getAll/clear, and
   *   optionally bulkPut/getAllAbove); otherwise the shared store of `dbName`
   *   (default 'oyon').
   */
  constructor(storeName, idKey, idPrefix, options = {}) {
    this.storeName = storeName;
    this.idKey = idKey;
    this.idPrefix = idPrefix;
    this.store = options.store ?? sharedOyonStore(options.dbName ?? 'oyon');
  }

  async append(records) {
    if (!Array.isArray(records) || records.length === 0) return;
    const keyed = records.map((record) => ({
      ...record,
      [this.idKey]: typeof record?.[this.idKey] === 'string' && record[this.idKey] ? record[this.idKey] : oyonRecordId(this.idPrefix),
    }));
    if (typeof this.store.bulkPut === 'function') {
      await this.store.bulkPut(this.storeName, keyed);
      return;
    }
    await Promise.all(keyed.map((record) => this.store.put(this.storeName, record)));
  }

  /**
   * Stored entries, oldest first (by timestamp, then key). With `since` (an
   * ISO timestamp), only the entries AT or after it — read through the
   * timestamp index when the store has one. Inclusive on purpose: entries
   * written in the same millisecond as the last one read are not missed; an
   * incremental reader merges by key (`event_id` / `metric_id`).
   */
  async read(options = {}) {
    const since = typeof options.since === 'string' && options.since ? options.since : null;
    let rows;
    if (since && typeof this.store.getAllAbove === 'function') {
      rows = await this.store.getAllAbove(this.storeName, 'timestamp', since, { inclusive: true });
    } else {
      rows = await this.store.getAll(this.storeName);
      if (since) rows = rows.filter((r) => timeOf(r) >= since);
    }
    return rows
      .filter((r) => r && typeof r === 'object')
      .sort((a, b) => timeOf(a).localeCompare(timeOf(b)) || String(a[this.idKey]).localeCompare(String(b[this.idKey])));
  }

  async clear() {
    await this.store.clear(this.storeName);
  }
}

/** Keeps every `oyon-log-v1` event in IndexedDB (`runtime_events`). */
export class IndexedDbLogTransport {
  constructor(options = {}) {
    this._records = new IndexedDbRecordTransport('runtime_events', 'event_id', 'log', options);
  }

  sendLogs(events) {
    return this._records.append(events);
  }

  read(options) {
    return this._records.read(options);
  }

  clear() {
    return this._records.clear();
  }
}

/** Keeps every `oyon-metric-v1` metric in IndexedDB (`metrics`). */
export class IndexedDbMetricTransport {
  constructor(options = {}) {
    this._records = new IndexedDbRecordTransport('metrics', 'metric_id', 'metric', options);
  }

  sendMetrics(metrics) {
    return this._records.append(metrics);
  }

  read(options) {
    return this._records.read(options);
  }

  clear() {
    return this._records.clear();
  }
}
