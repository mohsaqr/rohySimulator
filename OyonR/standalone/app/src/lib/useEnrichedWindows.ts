import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { useStoredWindows } from './storedWindows';
import { enrichWindows } from '@/legacy/dashboard.js';

/*
 * useEnrichedWindows — the one place the five /analyze routes turn stored
 * windows into the enriched array the views consume.
 *
 * Before this hook, every route repeated the exact same three lines
 * (useStoredWindows → useMemo(enrichWindows) → `as EmotionWindow[]` cast).
 * The cast is centralized here: enrichWindows() returns `any[]` (it adds
 * _time + dynamics fields on top of the EmotionWindow shape), and every
 * caller was already asserting EmotionWindow[] independently.
 *
 * Behavior is identical to the inlined version — this is a mechanical
 * extraction, not a semantics change.
 */
export interface EnrichedWindows {
  enriched: EmotionWindow[];
  isLoading: boolean;
}

/*
 * Module-level cache keyed on the stored array's identity. useMemo alone is
 * per hook INSTANCE — with the FilterBar and the active dashboard route each
 * consuming windows, every stored.data identity change (each window batch
 * during live capture) would run the full dynamics pass 2+ times on the
 * same main thread as the capture loop. The WeakMap makes all instances
 * share one pass; react-query's structural sharing keeps stored.data's
 * identity stable across idle polls, so entries are reused until data
 * actually changes (and old arrays are collected with their cache entries).
 */
const enrichCache = new WeakMap<EmotionWindow[], EmotionWindow[]>();

function enrichCached(data: EmotionWindow[]): EmotionWindow[] {
  let cached = enrichCache.get(data);
  if (!cached) {
    cached = enrichWindows(data) as EmotionWindow[];
    enrichCache.set(data, cached);
  }
  return cached;
}

export function useEnrichedWindows(): EnrichedWindows {
  const stored = useStoredWindows();
  const enriched = useMemo(
    () => (stored.data ? enrichCached(stored.data) : []),
    [stored.data],
  );
  return { enriched, isLoading: stored.isLoading };
}
