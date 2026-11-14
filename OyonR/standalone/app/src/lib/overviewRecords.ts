import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IndexedDbOyonStore, scopeRecords } from 'oyon';
import type { EmotionWindow } from 'oyon';
import type { IdbStoreRuntime } from './idbTransport';
import { useBridge } from './hostBridge';
import { useRecordScope } from './recordScope';
import { narrowByKeys, useFilteredWindows } from './useFilteredWindows';
import { useStoredEvents } from './storedEvents';
import { useFilterStore } from './filterStore';
import { filterWindows } from './filterWindows';

/*
 * overviewRecords — every record kind this surface may draw, twice:
 *
 *   inScope   everything the surface is allowed to see. The Overview's people
 *             and sessions tables list this, so a row never disappears just
 *             because the reader narrowed to another one.
 *   inView    after the reader's narrowing. The headline figures use this.
 *
 * Sources, in the same order as every other data hook:
 *   host feed set       the fed records, filtered by the embed's scope.
 *   embedded, no feed   the local store, limited to the embed's session — a
 *                       session embed lists one session, never the browser's
 *                       history.
 *   standalone          the local store; the filter bar narrows the view.
 */

export interface RecordSets {
  windows: EmotionWindow[];
  signalWindows: Array<Record<string, unknown>>;
  signalEvents: Array<Record<string, unknown>>;
  logEvents: Array<Record<string, unknown>>;
}

export interface OverviewRecords {
  inScope: RecordSets;
  inView: RecordSets;
  isLoading: boolean;
}

const SIGNAL_WINDOWS_STORE_NAME = 'signal_windows';
const LOCAL_SIGNAL_WINDOWS_QUERY_KEY = ['stored-signal-windows'] as const;
const NONE: Array<Record<string, unknown>> = [];

let signalWindowsStore: IdbStoreRuntime | null = null;
async function readLocalSignalWindows(): Promise<Array<Record<string, unknown>>> {
  if (!signalWindowsStore) {
    signalWindowsStore = new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
  }
  try {
    const rows = await signalWindowsStore.getAll(SIGNAL_WINDOWS_STORE_NAME);
    return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
  } catch {
    // No such store yet (nothing was ever captured): an empty list, as the
    // other local readers return.
    return [];
  }
}

export function useOverviewRecords(): OverviewRecords {
  const hostRecords = useBridge((s) => s.hostRecords);
  const recordScope = useRecordScope();
  const { allWindows, filtered, isLoading: windowsLoading, currentSessionId } = useFilteredWindows();
  const filterScope = useFilterStore((s) => s.scope);
  const filterSessionIds = useFilterStore((s) => s.sessionIds);
  const filterUserIds = useFilterStore((s) => s.userIds);
  const keyFilters = useFilterStore((s) => s.keyFilters);

  const readsLocalStore = hostRecords == null && !recordScope.needsFeed;
  const localSignalWindows = useQuery({
    queryKey: LOCAL_SIGNAL_WINDOWS_QUERY_KEY,
    queryFn: readLocalSignalWindows,
    staleTime: 1000,
    refetchInterval: readsLocalStore ? 5000 : false,
    enabled: readsLocalStore,
  });
  // Already feed-aware and scope-filtered when a feed is set; the whole local
  // store otherwise (inScope lists every session; inView narrows below).
  const events = useStoredEvents({ all: true });

  return useMemo(() => {
    if (hostRecords != null) {
      const fed = (rows: unknown[]) => rows as Array<Record<string, unknown>>;
      return {
        inScope: {
          windows: allWindows,
          signalWindows: recordScope.inScope(hostRecords.signalWindows),
          signalEvents: recordScope.inScope(fed(hostRecords.signalEvents)),
          logEvents: recordScope.inScope(hostRecords.logEvents),
        },
        inView: {
          windows: filtered,
          signalWindows: recordScope.inView(hostRecords.signalWindows),
          signalEvents: recordScope.inView(fed(hostRecords.signalEvents)),
          logEvents: recordScope.inView(hostRecords.logEvents),
        },
        isLoading: false,
      };
    }

    const localWindows = readsLocalStore ? localSignalWindows.data ?? NONE : NONE;
    const localEvents = readsLocalStore ? ((events.data ?? NONE) as unknown as Array<Record<string, unknown>>) : NONE;

    if (recordScope.embedded) {
      // One session, for every record kind.
      const session = { scope: 'session' as const, sessionId: currentSessionId };
      const sets: RecordSets = {
        windows: filtered,
        signalWindows: scopeRecords(localWindows, session),
        signalEvents: scopeRecords(localEvents, session),
        logEvents: [],
      };
      return { inScope: sets, inView: sets, isLoading: windowsLoading || localSignalWindows.isLoading };
    }

    const narrow = <T,>(rows: T[]): T[] =>
      narrowByKeys(
        filterWindows(rows, {
          scope: filterScope,
          currentSessionId,
          sessionIds: filterSessionIds,
          userIds: filterUserIds,
        }),
        keyFilters,
      );
    return {
      inScope: { windows: allWindows, signalWindows: localWindows, signalEvents: localEvents, logEvents: [] },
      inView: {
        windows: filtered,
        signalWindows: narrow(localWindows),
        signalEvents: narrow(localEvents),
        logEvents: [],
      },
      isLoading: windowsLoading || localSignalWindows.isLoading,
    };
  }, [
    hostRecords, recordScope, allWindows, filtered, windowsLoading, currentSessionId, readsLocalStore,
    localSignalWindows.data, localSignalWindows.isLoading, events.data,
    filterScope, filterSessionIds, filterUserIds, keyFilters,
  ]);
}
