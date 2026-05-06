// Tiny TTL-keyed Map shared by the three search proxies (RxNorm, openFDA,
// LOINC). One module so the cache is process-wide; each proxy passes a
// namespace prefix to avoid key collisions.
//
// Why not Redis / disk? The whole point of a 24h cache is to soften
// upstream rate limits during a single deploy lifecycle. Survives across
// requests, dies with the process. If the operator restarts, the next
// search refreshes — that's correct behaviour for "pinned snapshot"
// thinking. A persistent cache would silently keep stale data alive.
//
// Eviction: lazy on read. The cleanup interval is intentionally absent —
// for a search-typeahead workload, entries naturally expire and get
// re-fetched. Adding a setInterval here would also prevent process exit
// in tests (this file is imported by routes, which is imported by tests).

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const store = new Map();

export function cacheGet(namespace, key) {
    const composite = `${namespace}::${key}`;
    const entry = store.get(composite);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(composite);
        return undefined;
    }
    return entry.value;
}

export function cacheSet(namespace, key, value, ttlMs = DEFAULT_TTL_MS) {
    const composite = `${namespace}::${key}`;
    store.set(composite, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheClear(namespace) {
    if (!namespace) {
        store.clear();
        return;
    }
    const prefix = `${namespace}::`;
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}

export function cacheStats() {
    return {
        size: store.size,
        keys: Array.from(store.keys()).map((k) => k.split('::', 2)[0]).reduce((acc, ns) => {
            acc[ns] = (acc[ns] || 0) + 1;
            return acc;
        }, {}),
    };
}

// Allow tests / dev to inject a mock fetcher.
let _fetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
export function setFetch(fn) { _fetch = fn; }
export function getFetch() { return _fetch; }
