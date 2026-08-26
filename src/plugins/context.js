/**
 * RPS-1 — the host context handed to every plugin.
 *
 * The governing rule: a capability is a NARROWED ADAPTER THE HOST BUILDS, never
 * a reference to a host singleton.
 *
 * That is not theoretical. rohy's LLMService exposes sendMessage/streamMessage,
 * both bound to the patient conversation — handing it to the pathology plugin
 * for grading would write grading prompts into the case transcript. The plugin
 * wants `{complete({system, prompt})}`. So `llm` is granted as that shape or
 * not at all; there is no "pass the service and hope".
 *
 * The same reasoning applies to identity. `log()` and `store` CLOSE OVER the
 * session id — a plugin never passes one, so it cannot log into another
 * learner's session, and inheriting the session is automatic rather than a
 * parameter someone can get wrong.
 */

/**
 * Async key/value store scoped to one plugin, one session.
 *
 * localStorage-backed today. Every method is already async and this is the
 * only module that touches the backing store, so swapping the bodies for
 * apiFetch('/api/plugins/...') needs no change at any call site — the same
 * design the upstream workstation used for core/store.js.
 */
function createStore({ pluginId, sessionId }) {
    const key = (name) => `rohy_plugin:${pluginId}:${sessionId ?? 'nosession'}:${name}`;
    return {
        async get(name, fallback = null) {
            try {
                const raw = window.localStorage.getItem(key(name));
                return raw === null ? fallback : JSON.parse(raw);
            } catch {
                // A quota error or a private-mode throw must not take the room
                // down; the plugin re-renders from its own in-memory state.
                return fallback;
            }
        },
        async set(name, value) {
            try {
                window.localStorage.setItem(key(name), JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        async clear(name) {
            try {
                window.localStorage.removeItem(key(name));
                return true;
            } catch {
                return false;
            }
        },
    };
}

/** Wrap a host-supplied store so it cannot escape its plugin/session namespace. */
function scopeStore(store, { pluginId, sessionId }) {
    const key = (name) => `${pluginId}:${sessionId ?? 'nosession'}:${name}`;
    return {
        get: (name, fallback = null) => store.get(key(name), fallback),
        set: (name, value) => store.set(key(name), value),
        clear: (name) => store.clear(key(name)),
    };
}

/**
 * Build the context for one plugin. `grants` is what the HOST is willing to
 * provide; a capability the manifest requests but the host does not grant is
 * simply absent, and the plugin is expected to degrade rather than crash.
 */
export function createPluginContext({ manifest, session, caseConfig, eventLogger, notify, t, navigate, grants = {} }) {
    const id = manifest.id;
    const requested = manifest.capabilities ?? [];
    const capabilities = {};

    if (requested.includes('llm') && typeof grants.complete === 'function') {
        capabilities.llm = { complete: grants.complete };
    }
    if (requested.includes('notify') && typeof notify === 'function') {
        // `source` LAST: spreading payload last let a plugin overwrite the
        // host-set attribution and impersonate another source in the
        // notification centre.
        capabilities.notify = (payload) => notify({ ...payload, source: `plugin:${id}` });
    }

    // A host-supplied store is still namespaced by the host. Passing one
    // through raw would let two plugins share a key space by accident.
    const store = requested.includes('persist')
        ? (grants.store
            ? scopeStore(grants.store, { pluginId: id, sessionId: session?.id })
            : createStore({ pluginId: id, sessionId: session?.id }))
        : null;

    return {
        pluginId: id,
        session: {
            id: session?.id ?? null,
            caseId: session?.caseId ?? null,
            userId: session?.userId ?? null,
            role: session?.role ?? 'guest',
            language: session?.language ?? 'en',
            examMode: Boolean(session?.examMode),
        },
        // A plugin's case material rides on the case config under its own id.
        // One identity again: the manifest id IS the config key.
        data: caseConfig?.[id] ?? null,
        // The host's logger, unwrapped. The plugin's own createXLogger()
        // helper (if it ships one) wraps this to enforce its vocabulary.
        eventLogger,
        capabilities,
        store,
        t,
        navigate,
    };
}

export { createStore };
