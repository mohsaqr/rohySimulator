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
 * parameter someone can get wrong. `log` is the narrowed logger from
 * ./logger.js; the raw EventLogger singleton is no longer handed over.
 */

import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { createPluginLogger, deprecatedEventLoggerProxy } from './logger.js';

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

/**
 * The inverse: a host-resolved address back to the `remote:` reference the
 * CASE stores. The editor is shown resolved addresses (its thumbnails and
 * picker load `<img src>` directly and know nothing about `remote:`), but a
 * document must leave the editor host-agnostic — `remote:tiles/x.dzi`, never
 * `/api/plugins/pathology/tiles/x.dzi` — or it stops being portable and the
 * server guard's path check stops meaning anything. Segments are decoded
 * because resolveRemoteRef encoded them; the pair round-trips exactly.
 *
 * @param {string} uri
 * @param {string} pluginId
 * @returns {string} unchanged when it is not this plugin's resolved address
 */
export function unresolveRemoteRef(uri, pluginId) {
    const mount = `/api/plugins/${pluginId}/`;
    if (typeof uri !== 'string' || !uri.startsWith(mount)) return uri;
    const path = uri.slice(mount.length).split('/').map((seg) => {
        try { return decodeURIComponent(seg); } catch { return seg; }
    }).join('/');
    return `${REMOTE_SCHEME}${path}`;
}

/** Deep walk of unresolveRemoteRef — the shape-preserving twin of resolveRemoteRefs. */
export function unresolveRemoteRefs(value, pluginId) {
    if (typeof value === 'string') return unresolveRemoteRef(value, pluginId);
    if (Array.isArray(value)) return value.map((v) => unresolveRemoteRefs(v, pluginId));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, unresolveRemoteRefs(v, pluginId)])
        );
    }
    return value;
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

/**
 * A deep-frozen copy of a host object, for a grant that promises read-only
 * data. The host's live case is shared by every core room (the persona
 * prompt, the exam model, the patient record); handing the same reference
 * to a plugin would let one line of plugin code rewrite the answer key for
 * all of them. The case is plain JSON, so a JSON round-trip is the copy.
 * Once per mount (createPluginContext is memoised on the mount's identity).
 *
 * @param {*} value
 * @returns {*} the frozen copy, or null for nothing
 */
export function frozenCopy(value) {
    if (value === null || value === undefined) return null;
    const copy = JSON.parse(JSON.stringify(value));
    const freeze = (node) => {
        if (node && typeof node === 'object' && !Object.isFrozen(node)) {
            Object.freeze(node);
            Object.values(node).forEach(freeze);
        }
        return node;
    };
    return freeze(copy);
}

export function createPluginContext({ manifest, session, caseConfig, eventLogger, notify, t, navigate, grants = {}, surface = 'room' }) {
    const id = manifest.id;
    const requested = manifest.capabilities ?? [];
    const capabilities = {};

    // The narrowed logger (RPS-1 1.6 §6). Closes over the plugin, the session
    // and the surface; refuses undeclared verbs; stamps room/plugin on every
    // row. The FROZEN manifest is what the server validates against, so it is
    // what the logger checks against too — a runtime descriptor that drifted
    // would otherwise pass here and fail at ingest.
    const frozen = PLUGIN_MANIFESTS.find((m) => m.id === id) ?? manifest;
    const log = createPluginLogger({ manifest: frozen, eventLogger, sessionId: session?.id ?? null, surface });

    if (requested.includes('llm') && typeof grants.complete === 'function') {
        capabilities.llm = { complete: grants.complete };
    }
    // The one patient conversation, narrowed by the host (see
    // PatientConversationContext): speak into it, read it, nothing else.
    if (requested.includes('conversation') && grants.conversation) {
        capabilities.conversation = grants.conversation;
    }
    // Open the host's orders drawer on a tab. The host closes over its own
    // drawer state; the plugin names a tab and nothing more.
    if (requested.includes('drawer') && typeof grants.openDrawer === 'function') {
        capabilities.openDrawer = grants.openDrawer;
    }
    // Live vitals, read-only, as a getter: the 3D room mirrors the monitor's
    // signal at 1 Hz and used to read the EventLogger singleton's field for
    // it — the one host reference RPS-1 §6 forbids. A frozen copy per call.
    if (requested.includes('vitals') && typeof grants.vitals === 'function') {
        capabilities.vitals = () => frozenCopy(grants.vitals() ?? null);
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
        // The narrowed logger: `log(verb, objectType, options)`. A plugin's
        // own createXLogger() helper wraps THIS.
        log,
        surface,
        // DEPRECATED (removed in 1.7): the raw singleton is gone. This shim
        // forwards `log` to ctx.log and throws on the methods that mutated
        // global state, so a vendored package written against the old
        // contract keeps working for one release while the leak is closed.
        eventLogger: deprecatedEventLoggerProxy(log, id),
        capabilities,
        store,
        t,
        navigate,
        // The 'orders' capability (RPS-1): what this learner has ordered in a
        // CORE room, narrowed by the host in src/plugins/hostOrders.js. Absent
        // — not empty — for a plugin that did not ask, so a plugin cannot read
        // a learner's order history by accident, and present as a stable empty
        // shape when it did, so a room never has to guard the field itself.
        //
        // It sits beside `data` rather than inside `capabilities` because it is
        // DATA, not a service: the same reasoning that puts the case config on
        // `ctx.data` instead of handing over a getter. `available()` reads it
        // too, and availability is given no services at all.
        orders: requested.includes('orders') ? readOrders(grants.orders) : null,
        // The 'case' capability: the frozen case snapshot, whole and read-only.
        // Data beside `data` and `orders`, for the same reason those are —
        // absent (null) for a plugin that did not ask.
        patientCase: requested.includes('case') ? frozenCopy(grants.patientCase) : null,
    };
}

/**
 * The orders grant, normalised to one shape.
 *
 * Total, like every other judgement a plugin's `available()` may run through:
 * a host that granted nothing, granted null, or granted something malformed
 * yields an empty list rather than a throw, because the alternative is a
 * navigator that loses every room when one fetch fails.
 *
 * @param {*} granted whatever the host passed as `grants.orders`
 * @returns {{imaging: Array<object>, loaded: boolean}}
 */
export function readOrders(granted) {
    return {
        imaging: Array.isArray(granted?.imaging) ? granted.imaging : [],
        loaded: Boolean(granted?.loaded),
    };
}

export { createStore };
