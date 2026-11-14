import { IndexedDbOyonStore } from 'oyon';
import type { SignalEvent } from 'oyon/signal-events';
import type { IdbStoreRuntime } from './idbTransport';
import { useSignalRecords, type StoredResult } from './signalSource';

/*
 * useStoredEvents — read-only view of every SignalEvent written by the
 * runtime's per-modality logs (typing, discourse, interaction, ai_assist).
 * Mirrors storedWindows.ts's read path exactly, one store over:
 *
 *   IDB: oyon-app/signal_events
 *
 * Same database as emotion_windows (see idbTransport.ts) — `IdbEmotionTransport`
 * already opens `IndexedDbOyonStore({ dbName: 'oyon-app' })` without pinning a
 * `dbVersion`, so it inherits the library's current DEFAULT_DB_VERSION (3),
 * whose `createStores()` pass is unconditional and idempotent: it already
 * creates every store the library knows about — including `signal_events` —
 * in the 'oyon-app' database, whether or not the app has written to it yet.
 * Reading it here needs no new database, no version bump, and no migration.
 *
 * Non-destructive — getAll() never drains the store.
 */

const EVENTS_STORE_NAME = 'signal_events';

export const STORED_EVENTS_QUERY_KEY = ['stored-events'] as const;

function isSignalEventLike(value: unknown): value is SignalEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SignalEvent>;
  return (
    typeof row.event_id === 'string' &&
    typeof row.modality === 'string' &&
    typeof row.state === 'string' &&
    typeof row.sequence_index === 'number'
  );
}

// Singleton readonly store handle for reads, same pattern as idbTransport's
// getIdb(). Construction is cheap; the IDB connection opens lazily inside it.
let idbEventsStore: IdbStoreRuntime | null = null;
function getEventsStore(): IdbStoreRuntime {
  if (!idbEventsStore) {
    idbEventsStore = new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
  }
  return idbEventsStore;
}

async function readAllStoredEvents(): Promise<SignalEvent[]> {
  try {
    const rows = await getEventsStore().getAll(EVENTS_STORE_NAME);
    return rows.filter(isSignalEventLike);
  } catch {
    return [];
  }
}

/**
 * The per-event states this surface draws: the host's feed (el.setRecords)
 * filtered to the embed's scope when one is set, else the local store.
 */
export function useStoredEvents({ all = false }: { all?: boolean } = {}): StoredResult<SignalEvent> {
  return useSignalRecords<SignalEvent>({
    kind: 'signalEvents',
    queryKey: STORED_EVENTS_QUERY_KEY,
    queryFn: readAllStoredEvents,
    accept: isSignalEventLike,
    all,
  });
}
