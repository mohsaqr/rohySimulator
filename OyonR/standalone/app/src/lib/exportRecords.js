/*
 * exportRecords — every non-window record kind a bundle carries, picked out of
 * the record sets the surface may draw. One rule for the one-session bundle
 * (Sessions → Export) and the comparison bundle, so neither is windows-only.
 *
 * Plain JS with a .d.ts so the node tests run it.
 */
import { recordSessionId, recordUserId } from '../../../../src/records/hostRecords.js';

/** The record kinds besides interval windows, in bundle field order. */
export const EXPORT_RECORD_KINDS = Object.freeze(['signal_windows', 'signal_events', 'log_events', 'metrics', 'raw_windows']);

/**
 * Keep, from each set, the records `keep` accepts.
 *
 * @param {{ signalWindows?: object[], signalEvents?: object[], logEvents?: object[], metrics?: object[], rawWindows?: object[] }} sets
 *   `rawWindows`: raw-only envelopes (`modality: 'raw'`), rows no camera window carried
 * @param {(record: object) => boolean} keep
 * @returns {{ signal_windows: object[], signal_events: object[], log_events: object[], metrics: object[], raw_windows: object[] }}
 */
export function collectRecords(sets, keep) {
  if (!sets || typeof sets !== 'object') throw new TypeError('collectRecords: `sets` must be an object of record arrays');
  if (typeof keep !== 'function') throw new TypeError('collectRecords: `keep` must be a function');
  const pick = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && keep(r)) : []);
  return {
    signal_windows: pick(sets.signalWindows),
    signal_events: pick(sets.signalEvents),
    log_events: pick(sets.logEvents),
    metrics: pick(sets.metrics),
    raw_windows: pick(sets.rawWindows),
  };
}

/** Records of any of these sessions. */
export function inSessions(sessionIds) {
  const ids = new Set(sessionIds);
  return (record) => ids.has(recordSessionId(record));
}

/** Records of any of these people. */
export function ofPeople(userIds) {
  const ids = new Set(userIds);
  return (record) => ids.has(recordUserId(record));
}

/** How many records of each kind (for a bundle's header and tests). */
export function recordCounts(records) {
  return Object.fromEntries(EXPORT_RECORD_KINDS.map((k) => [k, Array.isArray(records?.[k]) ? records[k].length : 0]));
}
