// One `{ log }` wrapper per host logger, so a plugin room receives the SAME
// event logger object on every render.
//
// Every vendored workstation memoises its logger on that prop's identity and
// keys an "opened" effect on the logger. A fresh object per render therefore
// re-fired the effect on EVERY render, and the event it logged re-rendered the
// host: a loop. PACS hit it first (the monkey walker, MONKEY_SEED=3: ~95
// learning-event batches a second); the ECG room hit it again (QA 2026-10-04,
// PRV-23: OPENED_ECG_RECORDING ~52 times a second, 7,000 events in three
// minutes, until the per-user limiter answered 429). `ctx.log` is stable for
// the life of the room (PluginRoom memoises the context), so keying on it is
// exact. Every plugin adapter passes its logger through this.
const eventLoggers = new WeakMap();

export function eventLoggerFor(log) {
    if (typeof log !== 'function') return { log };
    if (!eventLoggers.has(log)) eventLoggers.set(log, { log });
    return eventLoggers.get(log);
}

export default eventLoggerFor;
