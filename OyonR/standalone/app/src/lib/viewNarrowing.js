/*
 * viewNarrowing — the local store narrowed to what the reader is looking at,
 * one rule for every record kind (interval windows, episode windows, per-event
 * states), so selecting one session in the filter bar can never leave another
 * session's typing or voice in the analysis.
 *
 *   embedded      the embed's current session only (no current session: none)
 *   standalone    the filter bar: scope, sessions, people, then the keys
 *                 above a person (group, class, …)
 *
 * Plain JS with a .d.ts so the node tests run it. useFilteredWindows applies
 * the same rule to the emotion windows; signalSource to everything else.
 */
import { scopeRecords } from '../../../../src/records/hostRecords.js';
import { filterWindows } from './filterWindows.js';

/** Narrow at the levels above a person (group, class, …); none set → unchanged. */
export function narrowByKeys(rows, keyFilters) {
  if (!keyFilters || Object.keys(keyFilters).length === 0) return rows;
  return scopeRecords(rows, { scope: 'group', filters: keyFilters });
}

export function narrowLocal(rows, view) {
  if (!Array.isArray(rows)) throw new TypeError('narrowLocal: `rows` must be an array');
  const { embedded = false, currentSessionId = null } = view ?? {};
  return narrowByKeys(
    filterWindows(rows, {
      scope: embedded ? 'current' : view?.filterScope ?? 'all',
      currentSessionId,
      sessionIds: embedded ? null : view?.sessionIds ?? null,
      userIds: embedded ? null : view?.userIds ?? null,
    }),
    embedded ? null : view?.keyFilters ?? null,
  );
}
