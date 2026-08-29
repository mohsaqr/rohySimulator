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
/**
 * Rewrite `remote:` references in a plugin's case material to its proxy mount.
 *
 * A case author writes a slide source as `remote:tiles/case42/slide1.dzi`; the
 * browser is handed `/api/plugins/pathology/tiles/case42/slide1.dzi`, which is
 * same-origin and therefore invisible to the CSP. The indirection is the point:
 * a case config that named `https://slides.example.edu` directly would pin one
 * deployment's host into content that is meant to be portable between them, and
 * would put host selection in reach of whoever can edit a case — which is
 * exactly the authority ROHY_PLUGIN_ORIGINS exists to keep with the operator.
 *
 * The walk is generic rather than a list of known fields (slides[].dzi,
 * specimens[].plates[].src, …). A plugin's case shape belongs to the plugin;
 * the host has no business knowing which of its keys hold URLs, and would be
 * wrong about it after the plugin's next release.
 *
 * @param {*} value      any node of the plugin's case material
 * @param {string} pluginId
 * @returns {*} the same shape with every `remote:` string resolved
 */
/**
 * One `remote:` reference, resolved to this plugin's proxy mount.
 *
 * Split out of the walk below because the ROOM gets its whole case resolved up
 * front, but the EDITOR is handed the raw stored document — the author has to
 * see the picture their reference names while they are authoring it, and the
 * only thing that can turn the name into an address is the host.
 *
 * @param {string} uri
 * @param {string} pluginId
 * @returns {string} unchanged when it is not a reference
 */
export function resolveRemoteRef(uri, pluginId) {
    if (typeof uri !== 'string' || !uri.startsWith(REMOTE_SCHEME)) return uri;
    const path = uri.slice(REMOTE_SCHEME.length).replace(/^\/+/, '');
    // Encoded per segment: a filename may legitimately contain a space or a
    // '+', and neither may be allowed to become a path separator.
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `/api/plugins/${pluginId}/${encoded}`;
}

export function resolveRemoteRefs(value, pluginId) {
    if (typeof value === 'string') {
        return resolveRemoteRef(value, pluginId);
    }
    if (Array.isArray(value)) return value.map((v) => resolveRemoteRefs(v, pluginId));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, resolveRemoteRefs(v, pluginId)])
        );
    }
    return value;
}

const REMOTE_SCHEME = 'remote:';

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
        //
        // `remote:` references are resolved here, by the HOST, and only for a
        // plugin that declared the capability — so a plugin that never asked
        // for remote content cannot be handed a proxy URL by a case config, and
        // the pathology adapter needs no code for any of this. Resolving it in
        // the descriptor instead would have made every future plugin reimplement
        // the same walk, differently.
        data: requested.includes('remote')
            ? resolveRemoteRefs(caseConfig?.[id] ?? null, id)
            : (caseConfig?.[id] ?? null),
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
