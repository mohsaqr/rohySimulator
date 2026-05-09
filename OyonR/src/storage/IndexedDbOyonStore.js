const DEFAULT_DB_NAME = 'oyon';
const DEFAULT_DB_VERSION = 1;

const STORES = [
  'captures',
  'emotion_windows',
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
      request.onsuccess = () => resolve(request.result);
    });
    return this.dbPromise;
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
