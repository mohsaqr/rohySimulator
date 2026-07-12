// Module-level store for the learner's live Oyon affect (Plan A,
// todo/plan-a-implementation-spec.md). Mirrors the lastPatientPrompt /
// lastTtsRequest singleton pattern: OyonCaptureWidget (an App-level sibling
// of ChatInterface — they share no React state) publishes here; ChatInterface
// reads a snapshot only at send time, so the ~2 Hz sample stream never
// re-renders the chat.
//
// Privacy contract: the widget publishes ONLY behind the same consent gate
// that guards window persistence (persistGateRef). No consent → this store
// stays empty → nothing can be routed to the LLM. Cleared on capture stop.

const MAX_WINDOWS = 12; // ~2 min at the default 10 s aggregation window

let snapshot = null;
const listeners = new Set();

function notify() {
    for (const cb of listeners) {
        try { cb(snapshot); } catch { /* one bad subscriber must not break the rest */ }
    }
}

/**
 * Publish one live sample (from the element's `oyon:sample` stream).
 * @param {{dominant?: string|null, confidence?: number|null,
 *   valence?: number|null, arousal?: number|null,
 *   anxiousIndex?: number|null, ts: number}} sample
 */
export function publishAffectSample(sample) {
    if (!sample || typeof sample !== 'object' || !Number.isFinite(sample.ts)) return;
    snapshot = {
        sample: { ...sample },
        windows: snapshot?.windows || [],
        updatedAt: sample.ts,
    };
    notify();
}

/**
 * Publish aggregated windows (from `oyon:window`). Kept for the A2
 * aggregate/trend modes; A1 routes from the live sample only.
 * @param {Array<object>} windows
 */
export function publishAffectWindows(windows) {
    if (!Array.isArray(windows) || windows.length === 0) return;
    snapshot = {
        sample: snapshot?.sample || null,
        windows: [...(snapshot?.windows || []), ...windows].slice(-MAX_WINDOWS),
        updatedAt: Date.now(),
    };
    notify();
}

/** @returns {{sample: object|null, windows: object[], updatedAt: number}|null} */
export function getAffectSnapshot() {
    return snapshot;
}

export function clearAffect() {
    snapshot = null;
    notify();
}

/**
 * Subscribe to store updates (DiagnosticBar, A2). Returns an unsubscribe fn.
 * @param {(snapshot: object|null) => void} cb
 */
export function subscribeAffect(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}
