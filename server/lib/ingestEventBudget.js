/**
 * Per-user EVENT budgets for the high-volume ingest endpoints.
 *
 * The request limiters (perUserRateLimit.js) count requests. A learning-event
 * batch carries up to 500 events and an Oyon signal-event batch up to 500, so a
 * request budget of 240/min still let one account push 120,000 rows a minute
 * into the database (security audit 2026-10-26, L8-01). This counts the EVENTS.
 *
 * A fixed one-minute window per (tenant, user), in process memory: the budget
 * protects this process's write lock, which is per process anyway. A limit of 0
 * (env) turns a budget off.
 */

const WINDOW_MS = 60_000;
// Housekeeping bound: past this many tracked keys, expired windows are dropped.
const SWEEP_AT_KEYS = 10_000;

function envLimit(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * @param {{ name: string, limit: number | (() => number), windowMs?: number, now?: () => number }} opts
 * @returns {{ take: (key: string, count: number) => { ok: boolean, used: number, limit: number, retryAfterMs: number },
 *             reset: () => void, name: string }}
 */
export function createEventBudget({ name, limit, windowMs = WINDOW_MS, now = Date.now }) {
    const windows = new Map();
    const currentLimit = typeof limit === 'function' ? limit : () => limit;
    function sweep(at) {
        if (windows.size < SWEEP_AT_KEYS) return;
        for (const [key, w] of windows) {
            if (at - w.start >= windowMs) windows.delete(key);
        }
    }
    return {
        name,
        /**
         * Charge `count` events to `key`. Refused (ok:false, nothing charged)
         * when that would exceed the limit for the current window.
         */
        take(key, count) {
            const max = currentLimit();
            if (!max) return { ok: true, used: 0, limit: 0, retryAfterMs: 0 };
            const at = now();
            sweep(at);
            let w = windows.get(key);
            if (!w || at - w.start >= windowMs) {
                w = { start: at, used: 0 };
                windows.set(key, w);
            }
            if (w.used + count > max) {
                return { ok: false, used: w.used, limit: max, retryAfterMs: Math.max(0, windowMs - (at - w.start)) };
            }
            w.used += count;
            return { ok: true, used: w.used, limit: max, retryAfterMs: 0 };
        },
        reset() { windows.clear(); },
    };
}

/** Learning events per user per minute (ROHY_LEARNING_EVENTS_PER_MINUTE, default 6000). */
export const learningEventBudget = createEventBudget({
    name: 'learning_events',
    limit: () => envLimit('ROHY_LEARNING_EVENTS_PER_MINUTE', 6000),
});

/** Oyon signal events per user per minute (ROHY_OYON_SIGNAL_EVENTS_PER_MINUTE, default 6000). */
export const oyonSignalEventBudget = createEventBudget({
    name: 'oyon_signal_events',
    limit: () => envLimit('ROHY_OYON_SIGNAL_EVENTS_PER_MINUTE', 6000),
});
