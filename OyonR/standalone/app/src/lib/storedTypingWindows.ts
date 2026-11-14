import { IndexedDbOyonStore } from 'oyon';
import type { TypingMetrics, TypingQuality, TypingTarget } from 'oyon';
import type { IdbStoreRuntime } from './idbTransport';
import { useSignalRecords, type StoredResult } from './signalSource';

/*
 * useStoredTypingWindows — read-only view of every typing episode window
 * written to the `signal_windows` IndexedDB object store (schema v2; see
 * src/storage/IndexedDbOyonStore.js and docs/TYPING.md "Storage and
 * transport"). Mirrors storedEvents.ts's read path exactly: same 'oyon-app'
 * database, one store, non-destructive getAll(), filtered here to
 * `modality === 'typing'` so other episode-shaped modalities (voice, ...)
 * sharing the store never leak into the typing dashboard.
 *
 * Types: types/typing.d.ts still describes the `typing-v2` metrics block —
 * the library already emits `typing-v3` (src/aggregation/TypingAggregator.js
 * finalize()). The additive v3 fields are declared here, OPTIONAL, because
 * stored rows may predate v3; every consumer must treat an absent field as
 * "not measured" (render —), never as 0.
 */

/**
 * One `typing.revision_locations` entry, v2 base + optional v3 additions.
 * Declared standalone (not `extends` the library type) because types/index.d.ts
 * does not re-export `TypingRevisionLocation` and the app maps only the bare
 * `oyon` entry point.
 */
export interface TypingRevisionLocationV3 {
  offset: number;
  length: number;
  op: string;
  t: number;
  /** v3: graphemes back from the document's current end this edit landed. */
  distance?: number;
  /** v3: absolute wall-clock ms of the edit. */
  wall_ms?: number;
}

/**
 * The `typing` block as the shipping `typing-v3` aggregator emits it. The
 * `null`s below are deliberate ("never measured", e.g. word counts or
 * boundary contexts were never supplied by the capture adapter) and must
 * never be coerced to 0 — see docs/TYPING.md.
 */
export interface TypingMetricsV3 extends TypingMetrics {
  revision_locations: TypingRevisionLocationV3[];
  edit_timestamps_ms?: number[];
  correction_count?: number;
  p_burst_count?: number;
  r_burst_count?: number;
  p_burst_mean_graphemes?: number;
  r_burst_mean_graphemes?: number;
  mean_burst_graphemes?: number;
  mean_burst_words?: number | null;
  revision_distance_mean?: number | null;
  revision_distance_median?: number | null;
  leading_edge_revision_ratio?: number | null;
  chars_per_min?: number;
  chars_per_min_active?: number;
  words_per_min?: number | null;
  words_per_min_active?: number | null;
  produced_graphemes?: number;
  /** The text's length before the episode's first edit; the episode's own net production is `committed_graphemes - baseline_graphemes`. */
  baseline_graphemes?: number;
  baseline_words?: number | null;
  product_ratio?: number | null;
  pause_location_counts?: Record<string, number> | null;
  adaptive_burst_count?: number;
  adaptive_active_input_ms?: number;
}

/**
 * One stored typing episode row. Not `extends TypingWindow`: that interface
 * pins `feature_profile: 'typing-v2'` while stored rows carry `'typing-v3'`
 * (and future profiles), so the literal is widened here. The id/session
 * fields are stamped by whichever transport wrote the row (keyPath is
 * `window_id`), not by the aggregator.
 */
export interface StoredTypingWindow {
  modality: 'typing';
  window_kind: 'episode';
  feature_profile: string;
  window_start: string;
  window_end: string;
  typing: TypingMetricsV3;
  quality?: TypingQuality;
  target?: TypingTarget;
  window_id?: string;
  capture_id?: string | null;
  session_id?: string | null;
  /** Who and what the episode belongs to; absent on rows that predate them. */
  user_id?: string | null;
  user_label?: string | null;
  group_id?: string | null;
  context_id?: string | null;
}

const SIGNAL_WINDOWS_STORE_NAME = 'signal_windows';

export const STORED_TYPING_WINDOWS_QUERY_KEY = ['stored-typing-windows'] as const;

function isTypingWindowLike(value: unknown): value is StoredTypingWindow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredTypingWindow>;
  return (
    row.modality === 'typing' &&
    typeof row.window_start === 'string' &&
    row.typing != null &&
    typeof row.typing === 'object'
  );
}

// Singleton readonly store handle for reads, same pattern as storedEvents'
// getEventsStore(). Construction is cheap; the IDB connection opens lazily.
let idbSignalWindowsStore: IdbStoreRuntime | null = null;
function getSignalWindowsStore(): IdbStoreRuntime {
  if (!idbSignalWindowsStore) {
    idbSignalWindowsStore = new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
  }
  return idbSignalWindowsStore;
}

async function readAllStoredTypingWindows(): Promise<StoredTypingWindow[]> {
  try {
    const rows = await getSignalWindowsStore().getAll(SIGNAL_WINDOWS_STORE_NAME);
    return rows
      .filter(isTypingWindowLike)
      .sort((a, b) => Date.parse(a.window_start) - Date.parse(b.window_start));
  } catch {
    return [];
  }
}

function byWindowStart(a: StoredTypingWindow, b: StoredTypingWindow): number {
  return Date.parse(a.window_start) - Date.parse(b.window_start);
}

/**
 * The typing episodes this surface draws: the host's feed (el.setRecords)
 * filtered to the embed's scope when one is set, else the local store.
 */
export function useStoredTypingWindows(): StoredResult<StoredTypingWindow> {
  return useSignalRecords<StoredTypingWindow>({
    kind: 'signalWindows',
    queryKey: STORED_TYPING_WINDOWS_QUERY_KEY,
    queryFn: readAllStoredTypingWindows,
    accept: isTypingWindowLike,
    compare: byWindowStart,
  });
}
