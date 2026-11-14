import { useMemo } from 'react';
import { listRecordLevels, scopeRecords, summarizeRecordsBy, type RecordLevel, type RecordSummaryRow } from 'oyon';
import { useBridge } from './hostBridge';
import { useFilterStore } from './filterStore';
import { useRecordScope } from './recordScope';
import { useOverviewRecords } from './overviewRecords';

/*
 * levelSelection — the aggregation levels a reader can move between (class,
 * group, person, session, or whatever the records carry), and which units
 * the dashboard is narrowed to at each of them.
 *
 * One model for both surfaces. Embedded, the narrowing lives in the
 * element's own bridge store; standalone, in the filter bar's store. Either
 * way a level is addressed by its record field (`session_id`, `user_id`,
 * `group_id`, …).
 */

export interface LevelView extends RecordLevel {
  /** Units at this level, within the narrowing at the other levels. */
  units: number;
  /** One row per unit, within the narrowing at the other levels. */
  rows: RecordSummaryRow[];
  /** Units the dashboard is narrowed to at this level; null = all. */
  selected: string[] | null;
  /** Whether this surface lets the reader narrow at this level. */
  canNarrow: boolean;
}

export interface LevelSelection {
  levels: LevelView[];
  /** Narrow at a level by its record field; null or [] shows all. */
  select: (key: string, ids: string[] | null) => void;
  clear: () => void;
  isLoading: boolean;
}

export function useLevelSelection(): LevelSelection {
  const { inScope, isLoading } = useOverviewRecords();
  const { embedded, scope, wide } = useRecordScope();
  const viewFilter = useBridge((s) => s.viewFilter);
  const setViewFilter = useBridge((s) => s.setViewFilter);
  const setViewKeyFilter = useBridge((s) => s.setViewKeyFilter);
  const clearViewFilter = useBridge((s) => s.clearViewFilter);
  const filterSessionIds = useFilterStore((s) => s.sessionIds);
  const filterUserIds = useFilterStore((s) => s.userIds);
  const filterKeys = useFilterStore((s) => s.keyFilters);
  const setFilterSessionIds = useFilterStore((s) => s.setSessionIds);
  const setFilterUserIds = useFilterStore((s) => s.setUserIds);
  const setFilterKey = useFilterStore((s) => s.setKeyFilter);
  const resetFilter = useFilterStore((s) => s.reset);

  return useMemo(() => {
    const selectedAt = (key: string): string[] | null => {
      if (key === 'session_id') return embedded ? viewFilter.sessionIds : filterSessionIds;
      if (key === 'user_id') return embedded ? viewFilter.userIds : filterUserIds;
      return (embedded ? viewFilter.keys[key] : filterKeys[key]) ?? null;
    };
    // What the surface's scope lets a reader narrow: nothing inside one
    // session, sessions inside one person, every level otherwise.
    const canNarrowAt = (key: string): boolean => {
      if (!embedded || wide) return true;
      return scope === 'person' && key === 'session_id';
    };
    const select = (key: string, ids: string[] | null) => {
      if (!canNarrowAt(key)) return;
      const next = ids && ids.length > 0 ? ids : null;
      if (key === 'session_id') return embedded ? setViewFilter({ sessionIds: next }) : setFilterSessionIds(next);
      if (key === 'user_id') return embedded ? setViewFilter({ userIds: next }) : setFilterUserIds(next);
      return embedded ? setViewKeyFilter(key, next) : setFilterKey(key, next);
    };

    const sets = [inScope.windows, inScope.signalWindows, inScope.signalEvents, inScope.logEvents];
    const present = listRecordLevels(sets)
      // Inside one person or one session the levels above it have one unit
      // by construction; listing them would only be noise.
      .filter((level) => !embedded || wide || level.key === 'session_id');

    // Drill-down: a level lists the units that survive the narrowing at
    // every OTHER level. Narrow to one group and People lists that group's
    // people; the group's own table still lists every group, so the choice
    // can be changed.
    const withinOthers = (ownKey: string) => {
      const filters: Record<string, string[]> = {};
      for (const level of present) {
        const ids = selectedAt(level.key);
        if (level.key !== ownKey && ids !== null) filters[level.key] = ids;
      }
      const narrow = <T,>(rows: T[]): T[] =>
        Object.keys(filters).length === 0 ? rows : (scopeRecords(rows, { scope: 'group', filters }) as T[]);
      return {
        windows: narrow(inScope.windows),
        signalWindows: narrow(inScope.signalWindows),
        signalEvents: narrow(inScope.signalEvents),
        logEvents: narrow(inScope.logEvents),
      };
    };

    const levels: LevelView[] = present.map((level) => {
      const rows = summarizeRecordsBy(withinOthers(level.key), { by: level.id });
      return {
        ...level,
        units: rows.length,
        rows,
        selected: selectedAt(level.key),
        canNarrow: canNarrowAt(level.key),
      };
    });

    return {
      levels,
      select,
      clear: embedded ? clearViewFilter : resetFilter,
      isLoading,
    };
  }, [
    inScope, isLoading, embedded, scope, wide, viewFilter, filterSessionIds, filterUserIds, filterKeys,
    setViewFilter, setViewKeyFilter, clearViewFilter, setFilterSessionIds, setFilterUserIds, setFilterKey, resetFilter,
  ]);
}
