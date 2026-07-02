import { IndexedDbOyonStore, type EmotionTransport, type EmotionWindow } from 'oyon';
import { isEmotionWindowLike, normalizeEmotionWindow } from './windowTime';

/*
 * IdbEmotionTransport — wraps the library's generic IndexedDbOyonStore as
 * an EmotionTransport so it can plug into the EmotionRuntime's transport
 * slot. Records land in the `emotion_windows` object store.
 *
 * IDB capacity is typically two orders of magnitude larger than
 * localStorage (5–10 MB → hundreds of MB to GB depending on browser),
 * so this is the path long-running research sessions need.
 *
 * Note on types: the library's hand-written `.d.ts` describes a simplified
 * shape `(record) => Promise<string>` for the IDB store. The actual JS
 * accepts `(storeName, record/records)` (src/storage/IndexedDbOyonStore.js
 * lines 39–61). We bind to a local typed surface here so the runtime call
 * site stays clean while the upstream `.d.ts` catches up.
 */

interface IdbStoreRuntime {
  bulkAdd(storeName: string, records: unknown[]): Promise<unknown>;
  getAll(storeName: string, options?: { limit?: number }): Promise<unknown[]>;
  clear(storeName: string): Promise<unknown>;
}

export class IdbEmotionTransport implements EmotionTransport {
  readonly store: IdbStoreRuntime;
  readonly storeName: string;

  constructor(options: { storeName?: string; dbName?: string } = {}) {
    // Cast to the real runtime interface; the library's typed surface omits
    // the per-store-name argument for now.
    this.store = new IndexedDbOyonStore({
      dbName: options.dbName ?? 'oyon-app',
    }) as unknown as IdbStoreRuntime;
    this.storeName = options.storeName ?? 'emotion_windows';
  }

  async send(windows: EmotionWindow[]): Promise<unknown> {
    if (!Array.isArray(windows) || windows.length === 0) return undefined;
    // The library's IndexedDbOyonStore creates `emotion_windows` with
    // keyPath: 'window_id' (src/storage/IndexedDbOyonStore.js:83). Records
    // without that key are rejected with `Evaluating the object store's key
    // path did not yield a value`. Stamp it here when missing.
    const stamped = windows.map((w) => {
      const norm = normalizeEmotionWindow(w);
      const existing = (norm as unknown as { window_id?: string }).window_id;
      const window_id =
        existing ??
        `oyon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      return { ...norm, window_id, id: window_id };
    });
    return this.store.bulkAdd(this.storeName, stamped);
  }

  async readAll(): Promise<EmotionWindow[]> {
    try {
      const rows = await this.store.getAll(this.storeName);
      return rows.filter(isEmotionWindowLike).map(normalizeEmotionWindow);
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await this.store.clear(this.storeName);
  }
}
