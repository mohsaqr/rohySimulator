import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { EmotionWindow } from 'oyon';
import { IdbEmotionTransport } from './idbTransport';
import { sessionIdOf } from './analyzeWindows';
import { useBridge } from './hostBridge';
import {
  isEmotionWindowLike,
  normalizeEmotionWindow,
  normalizeEmotionWindows,
  windowEndMs,
} from './windowTime';

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

async function readAllStoredWindows(): Promise<EmotionWindow[]> {
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
  return merged;
}

export function useStoredWindows(): UseQueryResult<EmotionWindow[], Error> {
  // Host-fed windows (el.setWindows in chrome="none" / viewer mode) take
  // precedence over the element's own local store: the Analyze dashboards
  // then render exactly what the host captured, with no camera of their own.
  // Standalone / no host windows ⇒ hostWindows is null and the read path is
  // byte-for-byte unchanged.
  const hostWindows = useBridge((s) => s.hostWindows);
  const chromeMode = useBridge((s) => s.chromeMode);
  const hostOverridesStore = chromeMode === 'none' && hostWindows != null;
  return useQuery({
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
      return Promise.resolve(normalized);
    },
    staleTime: 1000,
    // Host-fed windows are pushed, not polled — disable the 5s refetch when
    // the host owns the data; keep it for the local-store path (live capture).
    refetchInterval: hostOverridesStore ? false : 5000,
  });
}
