/**
 * The plugin store's server half (F06, migration 0069).
 *
 * A plugin room's learner work — a pathology report, its annotations, a PACS
 * measurement — used to live only in localStorage: lost on another device,
 * silently overwritten by a second tab of the same session, invisible to the
 * educator. It now lives on the server as one document per (session, plugin,
 * name) with a revision number:
 *
 *   GET /api/sessions/:sid/plugin-state/:plugin/:name -> {document, revision}
 *   PUT  same, {document, expectedRevision}            -> {revision} | 409 {document, revision}
 *
 * localStorage stays, demoted to an OFFLINE DRAFT CACHE under the same key as
 * before (src/storage/registry.js `rohy_plugin`). What it holds is an envelope
 * `{ [DRAFT_MARK]: 1, value, baseRevision, dirty }`:
 *
 *   - set() writes the draft first (so a reload or a dropped connection never
 *     loses a keystroke's worth of work), marks it dirty, and syncs it to the
 *     server after a short debounce, naming the revision it was based on.
 *   - A 409 means another tab or device saved since: the server copy wins, the
 *     draft is replaced by it, and the store emits `conflict` so the room can be
 *     reloaded from it and the learner told — never a silent last-writer-wins.
 *   - A network failure keeps the dirty draft and retries (bounded backoff, the
 *     `online` event, the next set(), the next load).
 *   - get() on load: a dirty draft based on the server's CURRENT revision is
 *     pushed — this is also how a draft written offline, and pre-0069 work that
 *     only ever lived in localStorage (a plain value, no envelope: base 0),
 *     reach the server. A dirty draft based on an OLDER revision lost a race
 *     while offline: server wins, `conflict` is emitted.
 *
 * The async get/set/clear interface is unchanged, so PluginRoom and any
 * host-supplied store (`grants.store`) keep working. Events are an addition:
 * `subscribe(listener)` receives `{type: 'conflict'|'save_failed'|'saved', name, ...}`.
 */

import { apiFetch } from '../services/apiClient.js';

/** Marks a localStorage value as a draft envelope rather than a pre-0069 plain value. */
export const DRAFT_MARK = '__rohyPluginDraft';

/** Typing settles for this long before a save is sent. */
export const SYNC_DEBOUNCE_MS = 800;

/** Retry backoff after a network failure: doubling from the first, capped at the last. */
export const RETRY_DELAYS_MS = Object.freeze([2000, 4000, 8000, 16000, 30000]);

const isEnvelope = (value) => Boolean(value && typeof value === 'object' && value[DRAFT_MARK] === 1);

/**
 * @param {object} p
 * @param {string} p.pluginId
 * @param {string|number} p.sessionId   required — without one there is nothing to sync to
 * @param {Function} [p.fetcher]        apiFetch-compatible (tests inject one)
 * @param {Storage}  [p.storage]        defaults to window.localStorage
 * @param {number}   [p.debounceMs]
 */
export function createSyncedStore({ pluginId, sessionId, fetcher = apiFetch, storage, debounceMs = SYNC_DEBOUNCE_MS }) {
    const localKey = (name) => `rohy_plugin:${pluginId}:${sessionId}:${name}`;
    const url = (name) => `/sessions/${encodeURIComponent(sessionId)}/plugin-state/${encodeURIComponent(pluginId)}/${encodeURIComponent(name)}`;
    const store = () => storage ?? (typeof window !== 'undefined' ? window.localStorage : null);

    const listeners = new Set();
    const emit = (event) => listeners.forEach((listener) => {
        try { listener(event); } catch { /* a listener's failure is its own, not the store's */ }
    });

    // Per name: the server revision this tab last saw, the value waiting to be
    // sent, the debounce/retry timer, whether a request is in flight.
    const slots = new Map();
    const slot = (name) => {
        if (!slots.has(name)) slots.set(name, { revision: 0, pending: undefined, timer: null, inflight: false, retry: 0 });
        return slots.get(name);
    };

    function readDraft(name) {
        let raw;
        try { raw = store()?.getItem(localKey(name)) ?? null; } catch { return null; }
        if (raw === null) return null;
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return null; }
        // A pre-0069 plain value: work that only ever lived here. It has never
        // been on the server, so it is a dirty draft based on "nothing" (0).
        return isEnvelope(parsed) ? parsed : { [DRAFT_MARK]: 1, value: parsed, baseRevision: 0, dirty: true };
    }

    function writeDraft(name, value, baseRevision, dirty) {
        try {
            store()?.setItem(localKey(name), JSON.stringify({ [DRAFT_MARK]: 1, value, baseRevision, dirty }));
            return true;
        } catch {
            return false;
        }
    }

    function schedule(name, delay) {
        const s = slot(name);
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => { s.timer = null; flush(name); }, delay);
    }

    async function flush(name, { keepalive = false } = {}) {
        const s = slot(name);
        if (s.inflight || s.pending === undefined) return;
        if (s.timer) { clearTimeout(s.timer); s.timer = null; }
        const sending = s.pending;
        s.pending = undefined;
        s.inflight = true;
        try {
            const result = await fetcher(url(name), {
                method: 'PUT',
                json: { document: sending, expectedRevision: s.revision },
                ...(keepalive ? { keepalive: true } : {}),
            });
            s.revision = result?.revision ?? s.revision + 1;
            s.retry = 0;
            // A newer edit may have arrived while this one was in flight: it is
            // still a dirty draft, now based on the revision just written.
            writeDraft(name, s.pending === undefined ? sending : s.pending, s.revision, s.pending !== undefined);
            emit({ type: 'saved', name, revision: s.revision });
        } catch (error) {
            if (error?.status === 409) {
                // Server wins. Whatever this tab had queued since is dropped too:
                // it was built on the copy that just lost.
                const body = error.body ?? {};
                s.revision = Number.isInteger(body.revision) ? body.revision : s.revision;
                s.pending = undefined;
                writeDraft(name, body.document ?? null, s.revision, false);
                emit({ type: 'conflict', name, value: body.document ?? null, revision: s.revision });
            } else {
                // Keep the work: the draft is already on disk and dirty. Put
                // the value back unless a newer one superseded it.
                if (s.pending === undefined) s.pending = sending;
                const offline = !error?.status;
                emit({ type: 'save_failed', name, offline, code: error?.code ?? null, status: error?.status ?? 0 });
                // Only a transport failure is worth retrying on a timer; a
                // refusal (403/413/400) would be refused again.
                if (offline) {
                    const delay = RETRY_DELAYS_MS[Math.min(s.retry, RETRY_DELAYS_MS.length - 1)];
                    s.retry += 1;
                    schedule(name, delay);
                }
            }
        } finally {
            s.inflight = false;
        }
        if (s.pending !== undefined && !s.timer) schedule(name, debounceMs);
    }

    const flushAll = (options) => Promise.all([...slots.keys()].map((name) => flush(name, options)));

    // A reconnect is the moment an offline draft can finally go up; a page
    // being hidden (tab closed, navigated away) is the last chance to send one.
    // Attached on first use, not at construction: a context is also built for
    // surfaces that never touch the store (the author view), and those must
    // not leave window listeners behind.
    const onOnline = () => { flushAll(); };
    const onPageHide = () => { flushAll({ keepalive: true }); };
    let attached = false;
    const attach = () => {
        if (attached || typeof window === 'undefined') return;
        attached = true;
        window.addEventListener('online', onOnline);
        window.addEventListener('pagehide', onPageHide);
    };

    return {
        async get(name, fallback = null) {
            attach();
            const s = slot(name);
            const draft = readDraft(name);
            let server;
            try {
                server = await fetcher(url(name));
            } catch (error) {
                // Offline or refused: the local draft is the best copy there is.
                s.revision = draft?.baseRevision ?? 0;
                if (draft?.dirty) { s.pending = draft.value; if (!error?.status) schedule(name, RETRY_DELAYS_MS[0]); }
                emit({ type: 'save_failed', name, offline: !error?.status, code: error?.code ?? null, status: error?.status ?? 0, phase: 'load' });
                return draft ? draft.value : fallback;
            }
            const revision = Number.isInteger(server?.revision) ? server.revision : 0;
            s.revision = revision;
            if (draft?.dirty) {
                if (draft.baseRevision === revision) {
                    // Saved locally, never reached the server (offline, or
                    // pre-0069 work): push it now.
                    s.pending = draft.value;
                    flush(name);
                    return draft.value;
                }
                // The server moved on while this draft sat offline.
                writeDraft(name, server?.document ?? null, revision, false);
                emit({ type: 'conflict', name, value: server?.document ?? null, revision, phase: 'load' });
                return server?.document ?? fallback;
            }
            if (server?.document === null || server?.document === undefined) return fallback;
            writeDraft(name, server.document, revision, false);
            return server.document;
        },

        async set(name, value) {
            attach();
            const s = slot(name);
            s.pending = value;
            const saved = writeDraft(name, value, s.revision, true);
            schedule(name, debounceMs);
            // `true` means the work is safe somewhere (the local draft); a
            // server failure is reported through `save_failed`, not here.
            return saved;
        },

        async clear(name) {
            const s = slot(name);
            if (s.timer) clearTimeout(s.timer);
            s.timer = null;
            s.pending = undefined;
            // The server copy is a record of the learner's work and is kept;
            // clear() drops this browser's draft only.
            try { store()?.removeItem(localKey(name)); return true; } catch { return false; }
        },

        /** Send anything queued now (room unmount). */
        flush: () => flushAll(),

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /**
         * The room is closing: send what is queued, stop listening. A retry
         * timer already armed still fires once — the draft it carries is the
         * learner's work, and the server is where it belongs.
         */
        dispose() {
            flushAll();
            listeners.clear();
            if (attached) {
                attached = false;
                window.removeEventListener('online', onOnline);
                window.removeEventListener('pagehide', onPageHide);
            }
        },
    };
}
