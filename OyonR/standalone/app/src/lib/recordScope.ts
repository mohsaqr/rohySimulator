import { useMemo } from 'react';
import { scopeRecords } from 'oyon';
import { useBridge, type EmbedScope } from './hostBridge';
import { useSessionContext } from './sessionContext';

/*
 * recordScope — which records this surface is allowed to draw.
 *
 * One definition, used by every data hook (interval windows, episode
 * windows, per-event states, log events), so a scope can never hold for one
 * record kind and leak for another.
 *
 *   standalone                  the operator's own filter bar decides
 *                               (filterStore); nothing here applies.
 *   embedded, scope="session"   one session: the embed's session-id.
 *   embedded, scope="person"    every session of the embed's user-id.
 *   embedded, scope="group"     every person in the records the host fed.
 *
 * "person" and "group" draw host-fed records only (el.setRecords). Without a
 * feed they draw nothing and say so (`needsFeed`); they never fall back to
 * the browser's local store, which may hold other people's sessions.
 */

export interface RecordScope {
  embedded: boolean;
  scope: EmbedScope;
  /** The scope is wider than one person (group, class, …). */
  wide: boolean;
  /** A host feed (el.setRecords) is set: it is the only data source. */
  fed: boolean;
  /** scope is person/group but no feed is set — draw nothing, say why. */
  needsFeed: boolean;
  /** The session this embed is bound to (null when none is active). */
  currentSessionId: string | null;
  /** The person this embed is bound to. */
  userId: string | null;
  /**
   * Keep the records this scope may draw, before the reader's own narrowing.
   * Session lists and person filters are built from this set.
   */
  inScope: <T>(records: T[]) => T[];
  /** `inScope` plus the reader's narrowing (session list, person filter). */
  inView: <T>(records: T[]) => T[];
}

export function useRecordScope(): RecordScope {
  const embedded = useBridge((s) => s.embedded);
  const chromeMode = useBridge((s) => s.chromeMode);
  const scope = useBridge((s) => s.scope);
  const fed = useBridge((s) => s.hostRecords) != null;
  const userId = useBridge((s) => s.userId);
  const pinnedSessionId = useBridge((s) => s.sessionIdOverride);
  const viewFilter = useBridge((s) => s.viewFilter);
  const liveSessionId = useSessionContext((s) => s.sessionId);

  // A viewer's explicit session-id wins over a sibling capture marker. A
  // real-runtime embed does the reverse: its actual live session wins over an
  // attribute changed mid-capture (session-id applies at the next start).
  const currentSessionId = chromeMode === 'none'
    ? pinnedSessionId ?? liveSessionId
    : liveSessionId ?? pinnedSessionId;

  return useMemo(() => {
    const needsFeed = embedded && scope !== 'session' && !fed;
    const base = { scope, sessionId: currentSessionId, userId };
    const wide = scope !== 'session' && scope !== 'person';
    const inScope = <T,>(records: T[]): T[] =>
      (needsFeed ? [] : (scopeRecords(records, base) as T[]));
    const inView = <T,>(records: T[]): T[] =>
      (needsFeed
        ? []
        : (scopeRecords(records, {
            ...base,
            // A session embed is one session: there is nothing to narrow.
            sessionIds: scope === 'session' ? null : viewFilter.sessionIds,
            // A person scope is one person; only a wider one can pick people
            // or narrow at the levels above them.
            userIds: wide ? viewFilter.userIds : null,
            filters: wide ? viewFilter.keys : undefined,
          }) as T[]));
    return { embedded, scope, wide, fed, needsFeed, currentSessionId, userId, inScope, inView };
  }, [embedded, scope, fed, currentSessionId, userId, viewFilter]);
}
