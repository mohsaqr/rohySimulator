import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scopeRecords, toLogRows } from 'oyon';
import type { LogRow, OyonLogEvent, OyonMetric } from 'oyon';
import { useBridge } from './hostBridge';
import { useRecordScope } from './recordScope';
import { useOverviewRecords } from './overviewRecords';
import { narrowByKeys, useFilteredWindows } from './useFilteredWindows';
import { useFilterStore } from './filterStore';
import { filterWindows } from './filterWindows';
import { readRuntimeLog } from './runtimeLogStore';
import { useSessionContext } from './sessionContext';

/*
 * useLogRows — the one log: every record this surface may draw, as
 * oyon's `toLogRows` rows, newest first.
 *
 *   windows, episodes, events   useOverviewRecords().inView — the same
 *                               scope and narrowing as every dashboard.
 *   runtime log + metrics       a host feed's `logEvents` when fed (a feed has
 *                               no metrics); otherwise the runtime's own
 *                               (lib/runtimeLogStore.ts), scoped and
 *                               narrowed like the rest.
 *
 * The runtime log stays out of the Overview's counts: before a capture starts
 * its events carry a provisional session id, which would list as a session.
 */

export const RUNTIME_LOG_QUERY_KEY = ['runtime-log'] as const;

type Rec = Record<string, unknown>;
const NONE: Rec[] = [];

/**
 * Re-read period while a capture is live; with none live the log cannot
 * grow from here, so it is read once (and again on focus, on Load demo data
 * and on Clear) instead of re-reading the whole archive every few seconds.
 */
export const RUNTIME_LOG_LIVE_POLL_MS = 5000;

/** The poll for the runtime log: only while reading locally and a capture is live. */
export function runtimeLogPoll(readsLocal: boolean, liveSessionId: string | null): number | false {
  return readsLocal && liveSessionId != null ? RUNTIME_LOG_LIVE_POLL_MS : false;
}

/**
 * The runtime's own log and metrics from this browser's storage; disabled
 * (no data) when a host feed is the source.
 */
export function useRuntimeLog() {
  const hostRecords = useBridge((s) => s.hostRecords);
  const recordScope = useRecordScope();
  const liveSessionId = useSessionContext((s) => s.sessionId);
  const readsLocal = hostRecords == null && !recordScope.needsFeed;
  const query = useQuery({
    queryKey: RUNTIME_LOG_QUERY_KEY,
    // The poll reads incrementally; the start/stop refetch below reads whole.
    queryFn: () => readRuntimeLog({ incremental: true }),
    staleTime: 1000,
    refetchInterval: runtimeLogPoll(readsLocal, liveSessionId),
    enabled: readsLocal,
  });
  // A capture starting or stopping: one read, so the entries written at stop
  // (after the last poll) show without waiting for a focus.
  const lastSession = useRef(liveSessionId);
  const { refetch } = query;
  useEffect(() => {
    if (lastSession.current === liveSessionId) return;
    lastSession.current = liveSessionId;
    if (readsLocal) void readRuntimeLog().then(() => refetch());
  }, [liveSessionId, readsLocal, refetch]);
  return { readsLocal, data: readsLocal ? query.data ?? null : null, isLoading: readsLocal && query.isLoading };
}

export function useLogRows(): { rows: LogRow[]; isLoading: boolean } {
  const hostRecords = useBridge((s) => s.hostRecords);
  const recordScope = useRecordScope();
  const overview = useOverviewRecords();
  const runtime = useRuntimeLog();
  const { currentSessionId } = useFilteredWindows();
  const filterScope = useFilterStore((s) => s.scope);
  const filterSessionIds = useFilterStore((s) => s.sessionIds);
  const filterUserIds = useFilterStore((s) => s.userIds);
  const keyFilters = useFilterStore((s) => s.keyFilters);

  const rows = useMemo(() => {
    const inView = overview.inView;
    let logEvents: ReadonlyArray<OyonLogEvent | Rec> = NONE;
    let metrics: ReadonlyArray<OyonMetric | Rec> = NONE;
    if (hostRecords != null) {
      logEvents = inView.logEvents;
    } else if (runtime.data) {
      if (recordScope.embedded) {
        const session = { scope: 'session' as const, sessionId: currentSessionId };
        logEvents = scopeRecords(runtime.data.logEvents, session);
        metrics = scopeRecords(runtime.data.metrics, session);
      } else {
        const narrow = <T,>(set: T[]): T[] => narrowByKeys(
          filterWindows(set, {
            scope: filterScope,
            currentSessionId,
            sessionIds: filterSessionIds,
            userIds: filterUserIds,
          }),
          keyFilters,
        );
        logEvents = narrow(runtime.data.logEvents);
        metrics = narrow(runtime.data.metrics);
      }
    }
    return toLogRows({
      windows: inView.windows,
      signalWindows: inView.signalWindows,
      signalEvents: inView.signalEvents,
      logEvents,
      metrics,
    }, { order: 'desc' });
  }, [
    overview.inView, hostRecords, runtime.data, recordScope.embedded, currentSessionId,
    filterScope, filterSessionIds, filterUserIds, keyFilters,
  ]);

  return { rows, isLoading: overview.isLoading || runtime.isLoading };
}
