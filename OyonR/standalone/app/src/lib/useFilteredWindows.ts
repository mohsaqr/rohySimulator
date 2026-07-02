import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { useEnrichedWindows } from './useEnrichedWindows';
import { useFilterStore } from './filterStore';
import { useSessionContext } from './sessionContext';
import { filterWindows } from './filterWindows';

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
  /** Enriched, unfiltered — for deriving filter options. */
  allWindows: EmotionWindow[];
  /** Enriched and scope/session/user-filtered — what dashboards render. */
  filtered: EmotionWindow[];
  isLoading: boolean;
  /** The live capture session id (null when capture never started). */
  currentSessionId: string | null;
}

export function useFilteredWindows(): FilteredWindows {
  const { enriched, isLoading } = useEnrichedWindows();
  const scope = useFilterStore((s) => s.scope);
  const sessionIds = useFilterStore((s) => s.sessionIds);
  const userIds = useFilterStore((s) => s.userIds);
  const currentSessionId = useSessionContext((s) => s.sessionId);

  const filtered = useMemo(
    () =>
      filterWindows(enriched, {
        scope,
        currentSessionId,
        sessionIds,
        userIds,
      }),
    [enriched, scope, currentSessionId, sessionIds, userIds],
  );

  return { allWindows: enriched, filtered, isLoading, currentSessionId };
}
