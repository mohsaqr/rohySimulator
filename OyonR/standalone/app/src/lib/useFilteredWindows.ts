import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { useEnrichedWindows } from './useEnrichedWindows';
import { useFilterStore } from './filterStore';
import { useSessionContext } from './sessionContext';
import { useBridge } from './hostBridge';
import { useRecordScope } from './recordScope';
import { filterWindows } from './filterWindows';
import { narrowByKeys } from './viewNarrowing';

/*
 * useFilteredWindows — what every scoped dashboard consumes.
 *
 * Composition order matters: windows are enriched FIRST (dynamics are
 * window-to-window derivatives and must be computed over the true timeline),
 * then filtered. Filtering before enrichment would fabricate velocity jumps
 * across filter gaps.
 *
 * Returns both the full enriched array (`allWindows` — the FilterBar derives
 * its session/user options from it) and the scoped `filtered` array.
 */

export interface FilteredWindows {
  /**
   * Enriched windows visible to this surface. Standalone receives the full
   * store for retrospective filters; embedded surfaces receive only the
   * active session so host UI cannot discover another session indirectly.
   */
  allWindows: EmotionWindow[];
  /** Enriched and scope/session/user-filtered — what dashboards render. */
  filtered: EmotionWindow[];
  isLoading: boolean;
  /** The live capture session id (null when capture never started). */
  currentSessionId: string | null;
  /** Embedded analytics are privacy-locked to currentSessionId. */
  sessionLocked: boolean;
}

/** Standalone narrowing at the levels above a person (group, class, …). */
export { narrowByKeys };

export function useFilteredWindows(): FilteredWindows {
  const { enriched, isLoading } = useEnrichedWindows();
  const scope = useFilterStore((s) => s.scope);
  const sessionIds = useFilterStore((s) => s.sessionIds);
  const userIds = useFilterStore((s) => s.userIds);
  const keyFilters = useFilterStore((s) => s.keyFilters);
  const liveSessionId = useSessionContext((s) => s.sessionId);
  const embedded = useBridge((s) => s.embedded);
  const chromeMode = useBridge((s) => s.chromeMode);
  const pinnedSessionId = useBridge((s) => s.sessionIdOverride);
  const recordScope = useRecordScope();

  // Embedded analytics are a current-session surface, never an implicit
  // tenant/browser-history browser. A viewer's explicit session-id wins over a
  // sibling capture marker. A real-runtime embed does the reverse: its actual
  // live session wins over an attribute changed mid-capture (session-id applies
  // at the next start). With neither, current filtering honestly yields []
  // instead of falling back to another session.
  const currentSessionId = chromeMode === 'none'
    ? pinnedSessionId ?? liveSessionId
    : liveSessionId ?? pinnedSessionId;
  const effectiveScope = embedded ? 'current' : scope;
  const effectiveSessionIds = embedded ? null : sessionIds;
  const effectiveUserIds = embedded ? null : userIds;

  // A host feed (el.setRecords) or a person/group scope is filtered by the
  // one scope definition every record kind shares (lib/recordScope.ts). A
  // session embed with no feed keeps the path below exactly as it was.
  const scopedByRecords = embedded && (recordScope.fed || recordScope.scope !== 'session');

  const filtered = useMemo(
    () =>
      scopedByRecords
        ? recordScope.inView(enriched)
        : narrowByKeys(
            filterWindows(enriched, {
              scope: effectiveScope,
              currentSessionId,
              sessionIds: effectiveSessionIds,
              userIds: effectiveUserIds,
            }),
            embedded ? null : keyFilters,
          ),
    [enriched, scopedByRecords, recordScope, effectiveScope, currentSessionId, effectiveSessionIds, effectiveUserIds, embedded, keyFilters],
  );

  // Do not expose aggregate counts/session choices from the backing store to an
  // embedded surface. Every embedded consumer sees one session-shaped dataset.
  const allWindows = embedded ? filtered : enriched;
  // A person or group scope lists its own sessions and people: the scope's
  // records before the reader's narrowing, and nothing outside the scope.
  const scopeWindows = useMemo(
    () => (scopedByRecords ? recordScope.inScope(enriched) : null),
    [scopedByRecords, recordScope, enriched],
  );

  return {
    allWindows: scopeWindows ?? allWindows,
    filtered,
    isLoading,
    currentSessionId,
    sessionLocked: embedded,
  };
}
