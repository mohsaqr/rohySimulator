import { useMemo } from 'react';
import { countScopedRecords, listScopedPeople, listScopedSessions } from 'oyon';
import { useBridge } from './hostBridge';
import { useRecordScope } from './recordScope';
import { useFilteredWindows } from './useFilteredWindows';

/*
 * scopeOverview — what an embedded scope header states and offers: the
 * sessions and people present in the scope (the session list and the person
 * filter), and the counts of what is currently in view.
 *
 * Built from EVERY record kind, not only interval windows: a host with no
 * camera feeds typing episodes and events and no emotion windows at all, and
 * its sessions and people must still be listed.
 */

export interface ScopeOverview {
  /** Sessions in the scope, newest first (before the reader's narrowing). */
  sessions: Array<{ id: string; records: number; people: number; lastMs: number | null }>;
  /** People in the scope, first-seen order (before the reader's narrowing). */
  people: Array<{ id: string; label: string; records: number; sessions: number }>;
  /** What is in view after narrowing. */
  counts: { sessions: number; people: number; records: number };
}

export function useScopeOverview(): ScopeOverview {
  const recordScope = useRecordScope();
  const hostRecords = useBridge((s) => s.hostRecords);
  const { allWindows, filtered } = useFilteredWindows();

  return useMemo(() => {
    const fedSets: unknown[][] = hostRecords
      ? [hostRecords.signalWindows, hostRecords.signalEvents, hostRecords.logEvents]
      : [];
    const inScope = [allWindows, ...fedSets.map((set) => recordScope.inScope(set))];
    const inView = [filtered, ...fedSets.map((set) => recordScope.inView(set))];
    return {
      sessions: listScopedSessions(inScope),
      people: listScopedPeople(inScope),
      counts: countScopedRecords(inView),
    };
  }, [hostRecords, allWindows, filtered, recordScope]);
}
