import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { useStoredWindows } from './storedWindows';
import { enrichWindows } from '@/legacy/dashboard.js';
import { useBridge } from './hostBridge';
import { sessionIdOf, userIdOf } from './filterWindows';
import { windowEndMs } from './windowTime';

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

/*
 * Host-fed pools hold several people and sessions. Dynamics are
 * window-to-window derivatives, so they are computed inside each person's
 * session and never across two of them — one tracker over the pooled array
 * would report the jump from one person's last window to another person's
 * first as a velocity. Windows that already carry `dynamics` keep them.
 */
const chainEnrichCache = new WeakMap<EmotionWindow[], EmotionWindow[]>();

function enrichByChainCached(data: EmotionWindow[]): EmotionWindow[] {
  const cached = chainEnrichCache.get(data);
  if (cached) return cached;
  const chains = new Map<string, EmotionWindow[]>();
  for (const window of data) {
    const key = `${userIdOf(window)}|${sessionIdOf(window)}`;
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key)!.push(window);
  }
  const merged: EmotionWindow[] = [];
  for (const [key, chain] of chains) {
    const ordered = chain.slice().sort((a, b) => (windowEndMs(a) ?? 0) - (windowEndMs(b) ?? 0));
    for (const window of enrichWindows(ordered) as Array<EmotionWindow & { _id?: string }>) {
      // `_id` is index-based within one enrich pass; qualify it by chain so
      // two people's windows never share a render key.
      merged.push({ ...window, _id: `${key}:${window._id ?? ''}` } as EmotionWindow);
    }
  }
  merged.sort((a, b) => (windowEndMs(a) ?? 0) - (windowEndMs(b) ?? 0));
  chainEnrichCache.set(data, merged);
  return merged;
}

export function useEnrichedWindows(): EnrichedWindows {
  const stored = useStoredWindows();
  const fed = useBridge((s) => s.hostRecords) != null;
  const enriched = useMemo(
    () => (stored.data ? (fed ? enrichByChainCached(stored.data) : enrichCached(stored.data)) : []),
    [stored.data, fed],
  );
  return { enriched, isLoading: stored.isLoading };
}
