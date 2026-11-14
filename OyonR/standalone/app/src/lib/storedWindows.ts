import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EmotionWindow } from 'oyon';
import { IdbEmotionTransport } from './idbTransport';
import { sessionIdOf } from './analyzeWindows';
import { useBridge } from './hostBridge';
import type { StoredResult } from './signalSource';
import {
  isEmotionWindowLike,
  normalizeEmotionWindow,
  normalizeEmotionWindows,
  windowEndMs,
} from './windowTime';
import { splitRawOnly } from './rawOnly';

/*
 * useStoredWindows — read-only view of every EmotionWindow written by the
 * runtime. Reads from IndexedDB first (the Phase C.3 primary store) and
 * merges in any localStorage rows from before IDB landed so the Analyze
 * view never goes empty mid-migration.
 *
 * Read path:
 *   1. IDB: oyon-app/emotion_windows (capacity: 100s of MB)
 *   2. localStorage: oyon-app-windows (capacity: 5–10 MB, legacy)
 *   3. Deduplicate by id (when both stores have the same row).
 *
 * Non-destructive — neither read drains its source.
 */

export const STORED_WINDOWS_KEY = 'oyon-app-windows';
// Legacy capture page (standalone/index.html + logs-dashboard.js) writes its
// emotion windows to this key. Reading it lets data captured before this app
// existed light up in the new shell.
export const LEGACY_WINDOWS_KEY = 'standalone-fer-events';
export const STORED_WINDOWS_QUERY_KEY = ['stored-windows'] as const;

function readLocalStorage(storageKey = STORED_WINDOWS_KEY): EmotionWindow[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEmotionWindowLike).map(normalizeEmotionWindow);
  } catch {
    return [];
  }
}

// Singleton readonly transport for reads. Construction is cheap; the IDB
// connection is lazy inside the store.
let idbReadTransport: IdbEmotionTransport | null = null;
function getIdb(): IdbEmotionTransport {
  if (!idbReadTransport) {
    idbReadTransport = new IdbEmotionTransport({
      storeName: 'emotion_windows',
      dbName: 'oyon-app',
    });
  }
  return idbReadTransport;
}

/**
 * Every stored record, split windows joined back, separated into the emotion
 * windows and the raw-only envelopes (`modality: 'raw'`; see rawOnly.js).
 */
async function readStoredWindowSet(): Promise<{ windows: EmotionWindow[]; rawOnly: EmotionWindow[] }> {
  const local = readLocalStorage();
  const legacy = readLocalStorage(LEGACY_WINDOWS_KEY);
  let idbRows: EmotionWindow[] = [];
  try {
    idbRows = await getIdb().readAll();
  } catch {
    idbRows = [];
  }
  // Merge all three sources and dedupe by id or session|window_end.
  const seen = new Set<string>();
  const merged: EmotionWindow[] = [];
  for (const w of [...idbRows, ...local, ...legacy]) {
    const endMs = windowEndMs(w);
    const key =
      (w as unknown as { id?: string }).id ??
      `${sessionIdOf(w)}|${endMs ?? String(w.window_end)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalizeEmotionWindow(w));
  }
  // Newest last so callers that consume the tail get the most recent.
  merged.sort((a, b) => (windowEndMs(a) ?? 0) - (windowEndMs(b) ?? 0));
  return splitRawOnly(merged);
}

async function readAllStoredWindows(): Promise<EmotionWindow[]> {
  return (await readStoredWindowSet()).windows;
}

/** The stored raw-only envelopes (rows no camera window carried), for export. */
export async function readStoredRawOnly(): Promise<EmotionWindow[]> {
  return (await readStoredWindowSet()).rawOnly;
}

/**
 * The interval windows this surface reads, before any scope filter:
 *
 *   host feed set (el.setRecords)   the fed windows. The local store is not
 *                                   read, and the fed windows never enter the
 *                                   query cache (they live in the bridge store
 *                                   only, so clearing the feed leaves no copy).
 *   scope person/group, no feed     nothing — those scopes never fall back to
 *                                   browser storage.
 *   chrome="none" + setWindows()    the host's windows (3.5 behaviour).
 *   otherwise                       the element's own local store.
 */
export function useStoredWindows(): StoredResult<EmotionWindow> {
  const hostRecords = useBridge((s) => s.hostRecords);
  const hostWindows = useBridge((s) => s.hostWindows);
  const chromeMode = useBridge((s) => s.chromeMode);
  const embedded = useBridge((s) => s.embedded);
  const scope = useBridge((s) => s.scope);
  const needsFeed = embedded && scope !== 'session' && hostRecords == null;
  const readsLocalOrLegacy = hostRecords == null && !needsFeed;
  const hostOverridesStore = chromeMode === 'none' && hostWindows != null;

  const query = useQuery({
    // Keying on the host array's identity makes the query re-resolve when the
    // host calls setWindows() with a new batch (react-query won't otherwise
    // notice a queryFn closure change).
    queryKey: hostOverridesStore ? [...STORED_WINDOWS_QUERY_KEY, hostWindows] : STORED_WINDOWS_QUERY_KEY,
    queryFn: () => {
      if (!hostOverridesStore) return readAllStoredWindows();
      const normalized = normalizeEmotionWindows(hostWindows);
      // If the host fed a non-empty batch but entries dropped during
      // normalization, the dashboards under-render in a way that looks exactly
      // like "host fed nothing" — surface it so a bad window shape (missing /
      // unparseable window_end_ms) is diagnosable rather than a silent blank.
      if (hostWindows.length > 0 && normalized.length < hostWindows.length) {
        try {
          console.warn(
            `[oyon-app] setWindows(): dropped ${hostWindows.length - normalized.length} of ` +
              `${hostWindows.length} window(s) — missing/invalid window_end_ms. Dashboards will ` +
              `under-render; check the EmotionWindow timestamp fields.`,
          );
        } catch { /* no console */ }
      }
      return Promise.resolve(splitRawOnly(normalized).windows);
    },
    staleTime: 1000,
    // Host-fed windows are pushed, not polled — disable the 5s refetch when
    // the host owns the data; keep it for the local-store path (live capture).
    refetchInterval: hostOverridesStore || !readsLocalOrLegacy ? false : 5000,
    enabled: readsLocalOrLegacy,
  });

  // A feed carries raw-only envelopes and split parts like the store does.
  const fedWindows = hostRecords?.windows;
  const fedEmotionWindows = useMemo(
    () => (fedWindows ? splitRawOnly(fedWindows).windows : NO_WINDOWS),
    [fedWindows],
  );

  if (hostRecords != null) return { data: fedEmotionWindows, isLoading: false };
  if (needsFeed) return { data: NO_WINDOWS, isLoading: false };
  return { data: query.data, isLoading: query.isLoading };
}

const NO_WINDOWS: EmotionWindow[] = [];
