import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBridge, type HostRecords } from './hostBridge';
import { useRecordScope } from './recordScope';
import { useFilterStore } from './filterStore';
import { narrowLocal } from './viewNarrowing';

/*
 * signalSource — where the non-camera records (episode windows, per-event
 * states, log events) come from, and which of them this surface may draw.
 *
 *   host feed set (el.setRecords)   the fed records, filtered to the embed's
 *                                   scope. The local store is not read at all.
 *   scope person/group, no feed     nothing (the views say why).
 *   otherwise                       the element's own local store,
 *                                   narrowed exactly as the windows are
 *                                   (useFilteredWindows): standalone by the
 *                                   filter bar (scope, sessions, people,
 *                                   keys), an embed to its one session. So a
 *                                   page never analyses another session's
 *                                   records under the reader's selection.
 *                                   `all: true` skips the narrowing (the
 *                                   Overview's people list, Diagnostics).
 *
 * The fed path never goes through the query cache: fed records live only in
 * the bridge store, so clearing the feed leaves no second copy behind.
 */

/** The part of a query result the dashboards consume. */
export interface StoredResult<T> {
  data: T[] | undefined;
  isLoading: boolean;
}

type FedKind = Exclude<keyof HostRecords, 'windows'>;

export function useSignalRecords<T>(options: {
  /** Which fed record kind this hook reads. */
  kind: FedKind;
  /** The local-store read, used only when no feed is set. */
  queryKey: readonly unknown[];
  queryFn: () => Promise<T[]>;
  /** Keeps the rows this hook is about (e.g. `modality === 'typing'`). */
  accept: (value: unknown) => value is T;
  /** Order for fed rows (the local read sorts its own). */
  compare?: (a: T, b: T) => number;
  /** The whole local store, without the reader's narrowing. */
  all?: boolean;
}): StoredResult<T> {
  const { kind, queryKey, queryFn, accept, compare, all = false } = options;
  const hostRecords = useBridge((s) => s.hostRecords);
  const scope = useRecordScope();
  const readsLocalStore = hostRecords == null && !scope.needsFeed;
  const filterScope = useFilterStore((s) => s.scope);
  const sessionIds = useFilterStore((s) => s.sessionIds);
  const userIds = useFilterStore((s) => s.userIds);
  const keyFilters = useFilterStore((s) => s.keyFilters);

  const local = useQuery({
    queryKey,
    queryFn,
    staleTime: 1000,
    refetchInterval: readsLocalStore ? 5000 : false,
    enabled: readsLocalStore,
  });

  const fed = useMemo(() => {
    if (hostRecords == null) return null;
    const rows = (hostRecords[kind] as unknown[]).filter(accept);
    const ordered = compare ? rows.slice().sort(compare) : rows;
    return scope.inView(ordered);
  }, [hostRecords, kind, accept, compare, scope]);

  const { embedded, currentSessionId } = scope;
  const narrowed = useMemo(
    () => (local.data === undefined || all
      ? local.data
      : narrowLocal(local.data, { embedded, currentSessionId, filterScope, sessionIds, userIds, keyFilters })),
    [local.data, all, embedded, currentSessionId, filterScope, sessionIds, userIds, keyFilters],
  );

  if (fed !== null) return { data: fed, isLoading: false };
  if (scope.needsFeed) return { data: EMPTY as T[], isLoading: false };
  return { data: narrowed, isLoading: local.isLoading };
}

const EMPTY: never[] = [];
