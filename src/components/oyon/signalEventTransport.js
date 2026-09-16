// Transport for Oyon's per-event state log (typing and voice), the sibling of
// signalTransport.js, which carries the per-episode windows.
//
// `createSignalCapture` hands every logged state to `onEvent` — one call per
// keystroke-level edit, pause, speech onset and so on. POSTing each one would
// be a request per character, so events are buffered and sent in batches to
// POST /addons/oyon/signal-events (migration 0058), which feeds sequence
// analysis on the dashboard.
//
// Only typing and voice are forwarded: they are the modalities the analytics
// read, and the server accepts nothing else.
//
// Kept free of React so the batching contract can be tested directly.

import { apiFetch } from '../../services/apiClient';
import { oyonClientLog } from './clientLogger';

const FORWARDED = new Set(['typing', 'voice']);
export const EVENT_BATCH_SIZE = 50;
export const EVENT_FLUSH_MS = 2000;
// The server's own ceiling; a burst larger than this is sent in several posts.
const MAX_POST = 500;

/**
 * Build a batching sink for SignalCapture's `onEvent`.
 *
 * `getContext()` is read when an event ARRIVES and returns
 * `{ persist, sessionId }`. The session is captured per event, not per flush:
 * a learner who moves to a new session must not have the previous session's
 * last events posted under the new one — so a session change flushes first.
 */
export function createSignalEventTransport(getContext, {
    batchSize = EVENT_BATCH_SIZE,
    flushMs = EVENT_FLUSH_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
} = {}) {
    if (typeof getContext !== 'function') {
        throw new TypeError('createSignalEventTransport requires a getContext() function.');
    }

    let pending = [];
    let pendingSession = null;
    let timer = null;
    const inFlight = new Set();

    function cancelTimer() {
        if (timer !== null) clearTimer(timer);
        timer = null;
    }

    function post(sessionId, events) {
        const request = (async () => {
            for (let i = 0; i < events.length; i += MAX_POST) {
                const chunk = events.slice(i, i + MAX_POST);
                try {
                    const body = await apiFetch('/addons/oyon/signal-events', {
                        method: 'POST',
                        json: { session_id: String(sessionId), events: chunk },
                    });
                    if (body?.consent_blocked > 0) {
                        oyonClientLog('debug', 'signal events dropped by consent', {
                            session_id: sessionId,
                            count: body.consent_blocked,
                        });
                    }
                } catch (e) {
                    // Logged, not retried: a lost batch leaves a visible gap in
                    // sequence_index, which the analytics treat as a break.
                    oyonClientLog('warn', 'signal event batch persist failed', {
                        session_id: sessionId,
                        count: chunk.length,
                        error: e?.message || String(e),
                    });
                }
            }
        })();
        inFlight.add(request);
        request.finally(() => inFlight.delete(request));
        return request;
    }

    function flushNow() {
        cancelTimer();
        if (pending.length === 0) return Promise.resolve();
        const events = pending;
        const sessionId = pendingSession;
        pending = [];
        pendingSession = null;
        return post(sessionId, events);
    }

    return {
        /** SignalCapture `onEvent` sink. */
        write(event) {
            if (!event || !FORWARDED.has(event.modality)) return;
            const { persist, sessionId } = getContext() || {};
            if (!persist || !sessionId) return;

            if (pendingSession !== null && String(pendingSession) !== String(sessionId)) flushNow();
            pendingSession = sessionId;
            pending.push({
                capture_id: event.capture_id,
                sequence_index: event.sequence_index,
                modality: event.modality,
                state: event.state,
                source: event.source,
                state_vocabulary: event.state_vocabulary,
                timestamp: event.timestamp,
                detail: event.detail ?? null,
            });

            if (pending.length >= batchSize) flushNow();
            else if (timer === null) timer = setTimer(flushNow, flushMs);
        },

        /** Send whatever is buffered and wait for every outstanding post. */
        async flush() {
            flushNow();
            await Promise.all([...inFlight]);
        },
    };
}
