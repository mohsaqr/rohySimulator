const DEFAULT_DB_NAME = 'oyon';
// v2 adds `signal_windows` for episode-shaped modality windows (typing, voice)
// that do not share the camera's fixed cadence.
// v3 adds `signal_events` — the complete per-event log. Aggregate windows
// cannot support sequence analysis (TNA, process mining, lag-sequential), which
// needs one ordered, state-labelled row per event; the window is a convenience
// over this log, not a replacement for it.
// `createStore` is idempotent, so each upgrade is additive.
const DEFAULT_DB_VERSION = 3;

const STORES = [
  'captures',
  'emotion_windows',
  'signal_windows',
  'signal_events',
  'runtime_events',
  'metrics',
  'settings_profiles',
  'consents',
  'dynamics',
];

export class IndexedDbOyonStore {
  constructor(options = {}) {
    this.options = {
      dbName: DEFAULT_DB_NAME,
      dbVersion: DEFAULT_DB_VERSION,
      indexedDB: typeof indexedDB !== 'undefined' ? indexedDB : null,
      ...options,
    };
    this.dbPromise = null;
  }

  async init() {
    if (this.dbPromise) return this.dbPromise;
    if (!this.options.indexedDB) throw new Error('IndexedDB is not available.');
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.options.indexedDB.open(this.options.dbName, this.options.dbVersion);
      request.onupgradeneeded = () => createStores(request.result);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading the database: let it, and reopen on next use.
        db.onversionchange = () => { db.close(); this.dbPromise = null; };
        resolve(db);
      };
    }).catch((error) => {
      // A failed open is not cached, so the next call tries again.
      this.dbPromise = null;
      throw error;
    });
    return this.dbPromise;
  }

  /** Put several records in ONE transaction: all are written, or none. */
  async bulkPut(storeName, records) {
    if (!Array.isArray(records) || records.length === 0) return [];
    if (!STORES.includes(storeName)) throw new Error(`Unknown Oyon store: ${storeName}`);
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const keys = [];
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`IndexedDB transaction on ${storeName} aborted`));
      tx.oncomplete = () => resolve(keys);
      for (const record of records) {
        const request = store.put(record);
        request.onsuccess = () => keys.push(request.result);
      }
    });
  }

  /**
   * Records whose `indexName` value is greater than `lower` (or at least it,
   * with `inclusive`), in index order — an incremental read through an index.
   */
  async getAllAbove(storeName, indexName, lower, options = {}) {
    const db = await this.init();
    const KeyRange = this.options.IDBKeyRange || (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange : null);
    if (!KeyRange) throw new Error('IDBKeyRange is not available.');
    const range = KeyRange.lowerBound(lower, options.inclusive !== true);
    return txRequest(db, storeName, 'readonly', store => store.index(indexName).getAll(range));
  }

  async put(storeName, record) {
    const db = await this.init();
    return txRequest(db, storeName, 'readwrite', store => store.put(record));
  }

  async add(storeName, record) {
    const db = await this.init();
    return txRequest(db, storeName, 'readwrite', store => store.add(record));
  }

  async bulkAdd(storeName, records) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const keys = [];
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(keys);
      for (const record of records) {
        const request = store.add(record);
        request.onsuccess = () => keys.push(request.result);
      }
    });
  }

  async getAll(storeName, options = {}) {
    const db = await this.init();
    const records = await txRequest(db, storeName, 'readonly', store => store.getAll());
    const limit = Number(options.limit);
    return Number.isFinite(limit) && limit > 0 ? records.slice(-limit) : records;
  }

  async clear(storeName) {
    const db = await this.init();
    return txRequest(db, storeName, 'readwrite', store => store.clear());
  }
}

export function oyonRecordId(prefix = 'oyon') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function createStores(db) {
  createStore(db, 'captures', 'capture_id', ['tenant_id', 'user_id', 'session_id', 'started_at']);
  createStore(db, 'emotion_windows', 'window_id', ['capture_id', 'session_id', 'window_start']);
  createStore(db, 'signal_windows', 'window_id', ['capture_id', 'session_id', 'modality', 'window_start']);
  createStore(db, 'signal_events', 'event_id', ['capture_id', 'session_id', 'modality', 'timestamp', 'sequence_index']);
  createStore(db, 'runtime_events', 'event_id', ['capture_id', 'event_name', 'timestamp']);
  createStore(db, 'metrics', 'metric_id', ['capture_id', 'metric_name', 'timestamp']);
  createStore(db, 'settings_profiles', 'profile_id', ['updated_at']);
  createStore(db, 'consents', 'consent_id', ['capture_id', 'session_id', 'timestamp']);
  createStore(db, 'dynamics', 'dynamics_id', ['capture_id', 'window_id', 'window_start']);
}

function createStore(db, name, keyPath, indexes = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, { keyPath });
  for (const index of indexes) {
    store.createIndex(index, index, { unique: false });
  }
}

function txRequest(db, storeName, mode, operation) {
  if (!STORES.includes(storeName)) throw new Error(`Unknown Oyon store: ${storeName}`);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
