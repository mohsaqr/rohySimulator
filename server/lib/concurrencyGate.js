// A bounded admission gate: how many of one kind of expensive work may run at
// once, in this process, overall and per key (a user), and how many may wait.
//
// Security audit 2026-10-26 (F-06, F-07): /proxy/llm and /tts had no
// concurrency bound at all — one account could hold any number of 5-minute LLM
// streams open, or queue any number of 2000-character Kokoro syntheses on the
// server's CPU. A request the gate cannot admit or queue is refused at once
// (GateFullError → 429), so the waiting line itself is bounded too.
//
// The server is one process, so in-process counters cover every request it
// serves (the same premise as lib/keyedLock.js).

export class GateFullError extends Error {
    constructor(gate, scope) {
        super(`${gate}: too many requests in flight`);
        this.name = 'GateFullError';
        this.code = 'GATE_FULL';
        this.gate = gate;
        this.scope = scope;           // 'user' | 'global'
    }
}

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} opts.maxActive       running at once, all keys together
 * @param {number} [opts.maxQueued]     waiting, all keys together (default 0: no queue)
 * @param {number} opts.perKeyActive    running at once for one key
 * @param {number} [opts.perKeyQueued]  waiting for one key (default 0)
 */
export function createGate({ name, maxActive, maxQueued = 0, perKeyActive, perKeyQueued = 0 }) {
    const active = new Map();       // key -> running count
    const queued = new Map();       // key -> waiting count
    const waiters = [];             // FIFO of { key, admit, reject }
    let activeTotal = 0;

    const inc = (map, key, by) => {
        const next = (map.get(key) || 0) + by;
        if (next <= 0) map.delete(key); else map.set(key, next);
    };
    const canRun = (key) => activeTotal < maxActive && (active.get(key) || 0) < perKeyActive;

    function start(key) {
        activeTotal += 1;
        inc(active, key, 1);
        let released = false;
        return function release() {
            if (released) return;
            released = true;
            activeTotal -= 1;
            inc(active, key, -1);
            drain();
        };
    }

    function drain() {
        for (let i = 0; i < waiters.length;) {
            const w = waiters[i];
            if (canRun(w.key)) {
                waiters.splice(i, 1);
                inc(queued, w.key, -1);
                w.admit(start(w.key));
            } else {
                i += 1;
            }
        }
    }

    /**
     * Admit `key`. Resolves with a release function (call it exactly when the
     * work is done; extra calls are ignored), or rejects with GateFullError
     * when neither a slot nor a queue place is free. An aborted `signal`
     * leaves the queue and rejects with the signal's reason.
     */
    function acquire(key, { signal } = {}) {
        const k = String(key);
        if (canRun(k) && !waiters.some((w) => w.key === k)) return Promise.resolve(start(k));
        if ((queued.get(k) || 0) >= perKeyQueued || (active.get(k) || 0) + (queued.get(k) || 0) >= perKeyActive + perKeyQueued) {
            return Promise.reject(new GateFullError(name, 'user'));
        }
        if (waiters.length >= maxQueued) return Promise.reject(new GateFullError(name, 'global'));
        return new Promise((resolve, reject) => {
            const waiter = { key: k, admit: resolve, reject };
            waiters.push(waiter);
            inc(queued, k, 1);
            signal?.addEventListener('abort', () => {
                const at = waiters.indexOf(waiter);
                if (at === -1) return;
                waiters.splice(at, 1);
                inc(queued, k, -1);
                reject(signal.reason ?? new Error('aborted'));
            }, { once: true });
        });
    }

    return {
        acquire,
        /** Test/diagnostic view of the counters. */
        stats: () => ({ name, active: activeTotal, queued: waiters.length, keys: active.size }),
    };
}

/** Read a positive integer from the environment, or the default. */
export function envInt(name, fallback) {
    const v = Number.parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}
