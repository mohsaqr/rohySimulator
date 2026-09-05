/**
 * RPS-1 1.6 — the narrowed plugin logger, `ctx.log`.
 *
 * Until 1.6 a plugin was handed the whole `EventLogger` singleton: it could
 * change the global room and session context, emit any verb (including
 * another plugin's), and — as PACS did for months — call `log()` with the
 * wrong argument shape and have every one of its rows rejected at ingest as
 * `verb=[object Object]`. This module is the client-side twin of
 * `pluginServerSlot.emit`: a closure over (manifest, sessionId, surface)
 * that refuses what the pipeline would silently lose and stamps what
 * analytics cannot reconstruct later.
 *
 * Two invariants:
 *   - Never discard a click. The verb is the only field that can cost a whole
 *     row (the registry is a hard whitelist at ingest), so an undeclared verb
 *     is REDIRECTED to UNDECLARED_VERB with the attempt in context, never
 *     dropped. object_type / component are free text at ingest, so they are
 *     soft gates: kept, marked.
 *   - No learner prose in the event stream. The host already stores the
 *     transcript and the document; an event trail that copies prose is a
 *     second, unmanaged store of it. Denylisted keys are removed from
 *     context, objectName is capped and may not contain a newline, and
 *     messageContent/messageRole are stripped outright.
 *
 * In dev and test every violation THROWS, naming the plugin and the field, so
 * it is found at the first render rather than in an analytics screen a month
 * later. In production the row is written with the violation marked.
 */
import { LEARNING_VERBS, VERBS, SEVERITY as SEVERITY_ENUM, CATEGORIES as CATEGORY_ENUM } from '../../server/shared/learningVerbs.js';
import { HOST_DELEGABLE_VERBS } from '../../server/shared/pluginRegistry.js';
import { BASE_OBJECT_TYPES } from '../../server/shared/learningObjectTypes.js';

export const CONTEXT_MAX_BYTES = 4096;
export const OBJECT_NAME_MAX = 120;

/** Context keys that carry prose. Matched case-insensitively at any depth. */
export const PROSE_DENYLIST = new Set([
    'text', 'content', 'answer', 'answers', 'expected', 'answerkey', 'answer_key',
    'body', 'prose', 'transcript', 'message', 'messagecontent', 'message_content',
    'note', 'notes', 'rationale',
]);

const HOST_OBJECT_TYPES = new Set(Object.values(BASE_OBJECT_TYPES));
const SEVERITIES = new Set(Object.values(SEVERITY_ENUM));
const CATEGORIES = new Set(Object.values(CATEGORY_ENUM));

function isStrictByDefault() {
    try {
        return Boolean(import.meta.env?.DEV) || import.meta.env?.MODE === 'test';
    } catch {
        return false;
    }
}

const warned = new Set();
function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(message);
}

/**
 * Accept both call shapes and return the canonical one.
 *
 * The 3-positional `log(verb, objectType, options)` is canonical — it is what
 * `EventLogger.log` is and what the ECG and pathology wrappers call. The
 * object form `log({verb, objectType, component, detail})` is what Radoyon
 * shipped; accepting it here is what makes PACS rows persist the moment this
 * lands, before the upstream fix is vendored. `detail` becomes `context`.
 * The object branch is removed in 1.7.
 *
 * @returns {{verb:string, objectType:string, options:object, shape:'positional'|'object'}}
 */
export function normalizeLogArgs(a, b, c) {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
        const { verb, objectType, object_type, detail, context, ...rest } = a;
        return {
            verb: typeof verb === 'string' ? verb : '',
            objectType: typeof (objectType ?? object_type) === 'string' ? (objectType ?? object_type) : '',
            options: { ...rest, context: context ?? detail ?? null },
            shape: 'object',
        };
    }
    return {
        verb: typeof a === 'string' ? a : '',
        objectType: typeof b === 'string' ? b : '',
        options: c && typeof c === 'object' ? c : {},
        shape: 'positional',
    };
}

/**
 * Remove prose keys from a context object at any depth.
 * @returns {{context: object|null, dropped: string[]}}
 */
export function sanitizeContext(context) {
    const dropped = [];
    const walk = (node, path) => {
        if (Array.isArray(node)) return node.map((v, i) => walk(v, `${path}[${i}]`));
        if (!node || typeof node !== 'object') return node;
        const out = {};
        for (const [key, value] of Object.entries(node)) {
            const here = path ? `${path}.${key}` : key;
            if (PROSE_DENYLIST.has(key.toLowerCase())) { dropped.push(here); continue; }
            out[key] = walk(value, here);
        }
        return out;
    };
    if (context === null || context === undefined) return { context: null, dropped };
    if (typeof context !== 'object') return { context: null, dropped: ['(context is not an object)'] };
    return { context: walk(context, ''), dropped };
}

function byteLength(value) {
    try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return Infinity; }
}

/**
 * Build the narrowed logger for one plugin mount.
 *
 * @param {object} args
 * @param {object} args.manifest      the plugin's FROZEN manifest
 * @param {{log: Function}} args.eventLogger  the host sink
 * @param {number|null} [args.sessionId]
 * @param {'room'|'author'} [args.surface='room']
 * @param {boolean} [args.strict]     throw on a violation (default: dev/test)
 * @returns {(verb:string, objectType:string, options?:object) => object|null}
 */
// Components the HOST owns and stamps on rows it writes about a plugin — the
// generic room mount and the authoring slot. They are not in any plugin's
// vocabulary because no plugin renders them, so the soft gate must not read
// them as undeclared: in strict mode that threw inside PluginAuthor's effect
// and took the whole editor down with "Something went wrong in this view".
export const HOST_COMPONENTS = new Set(['PluginRoom', 'PluginAuthor']);

export function createPluginLogger({ manifest, eventLogger, sessionId = null, surface = 'room', strict = isStrictByDefault() }) {
    const pluginId = manifest?.id ?? 'unknown';
    const pluginVersion = manifest?.version ?? null;
    const vocabulary = manifest?.vocabulary ?? {};
    const ownVerbs = new Set(Object.keys(vocabulary.verbs ?? {}));
    const coreVerbs = new Set(vocabulary.coreVerbs ?? []);
    const declaredObjectTypes = new Set(Object.values(vocabulary.objectTypes ?? {}));
    const declaredComponents = Object.values(vocabulary.components ?? {});
    const defaultComponent = declaredComponents[0] ?? `Plugin:${pluginId}`;
    const parentComponent = surface === 'author' ? 'PluginAuthor' : 'PluginRoom';

    const fail = (message) => {
        const text = `plugin '${pluginId}': ${message}`;
        if (strict) throw new Error(text);
        warnOnce(text, `[ctx.log] ${text}`);
    };

    const allowedVerb = (verb) => ownVerbs.has(verb) || coreVerbs.has(verb) || HOST_DELEGABLE_VERBS.includes(verb);

    return function log(...args) {
        if (!eventLogger || typeof eventLogger.log !== 'function') return null;
        const { verb: rawVerb, objectType: rawObjectType, options, shape } = normalizeLogArgs(...args);
        const context = { ...(options.context && typeof options.context === 'object' ? options.context : {}) };
        if (shape === 'object') {
            // Compatibility, not a violation to throw on: the object form is
            // what the vendored Radoyon calls today, and throwing here would
            // take the PACS room down in every dev session until its upstream
            // fix is vendored. Warned once, marked on the row, removed in 1.7.
            warnOnce(`${pluginId}:shape`, `[ctx.log] plugin '${pluginId}' called log() with an object argument; the contract is log(verb, objectType, options) (§6). Accepted for one release.`);
            context._log_shape = 'object';
        }

        // --- the verb: hard gate, redirect never drop ---------------------
        let verb = rawVerb;
        let objectType = rawObjectType;
        // A plugin's OWN verbs are in the registry by construction (the frozen
        // manifest is what the registry folds); core and host-delegable verbs
        // must be registered rohy verbs.
        if (!allowedVerb(verb) || (!ownVerbs.has(verb) && !LEARNING_VERBS.includes(verb))) {
            fail(`'${verb || '(empty)'}' is not in its manifest vocabulary — declare it, or it lands as UNDECLARED_VERB`);
            context.attempted_verb = verb || null;
            context.attempted_object_type = objectType || null;
            verb = VERBS.UNDECLARED_VERB;
            objectType = BASE_OBJECT_TYPES.PLUGIN_EVENT;
        }

        // --- object type / component: soft gates -------------------------
        if (!objectType) {
            fail(`log('${verb}') has no objectType`);
            objectType = BASE_OBJECT_TYPES.PLUGIN_EVENT;
        } else if (!declaredObjectTypes.has(objectType) && !HOST_OBJECT_TYPES.has(objectType)) {
            fail(`object type '${objectType}' is not declared in its manifest`);
            context._undeclared = { ...(context._undeclared || {}), objectType };
        }
        let component = options.component ?? defaultComponent;
        if (declaredComponents.length && !declaredComponents.includes(component) && !HOST_COMPONENTS.has(component)) {
            fail(`component '${component}' is not declared in its manifest`);
            context._undeclared = { ...(context._undeclared || {}), component };
        }

        // --- prose -------------------------------------------------------
        const { context: clean, dropped } = sanitizeContext(context);
        let finalContext = clean;
        if (dropped.length) {
            fail(`context carries prose keys (${dropped.join(', ')}) — log the shape of a document, never its text`);
            finalContext = { ...(finalContext || {}), _dropped: dropped };
        }
        if (options.messageContent !== undefined || options.messageRole !== undefined) {
            fail('messageContent/messageRole belong to the chat transcript, not a plugin event');
        }
        let objectName = options.objectName ?? null;
        if (typeof objectName === 'string') {
            if (/[\r\n]/.test(objectName)) {
                fail('objectName contains a newline — that is prose, not a name');
                objectName = objectName.split(/[\r\n]/)[0];
            }
            if (objectName.length > OBJECT_NAME_MAX) objectName = objectName.slice(0, OBJECT_NAME_MAX);
        }
        if (finalContext && byteLength(finalContext) > CONTEXT_MAX_BYTES) {
            fail(`context exceeds ${CONTEXT_MAX_BYTES} bytes`);
            finalContext = { _truncated: true, _bytes: byteLength(finalContext), _keys: Object.keys(finalContext) };
        }

        // --- metadata overrides: in-enum only ----------------------------
        let severity = options.severity;
        let category = options.category;
        if (severity !== undefined && !SEVERITIES.has(severity)) { fail(`severity '${severity}' is not in the enum`); severity = undefined; }
        if (category !== undefined && !CATEGORIES.has(category)) { fail(`category '${category}' is not in the enum`); category = undefined; }

        return eventLogger.log(verb, objectType, {
            objectId: options.objectId ?? null,
            objectName,
            component,
            parentComponent,
            result: options.result ?? null,
            durationMs: options.durationMs ?? null,
            timingMark: options.timingMark,
            context: { ...(finalContext || {}), surface },
            severity,
            category,
            // Host-stamped, never caller-overridable.
            room: pluginId,
            pluginId,
            pluginVersion,
            sessionId,
        });
    };
}

/**
 * The deprecation shim for `ctx.eventLogger` (removed in 1.7).
 *
 * Forwards `log` (both call shapes) to the narrowed logger; the methods that
 * mutate global state throw at once, naming `ctx.log`; anything else is
 * `undefined` after one warning.
 */
export function deprecatedEventLoggerProxy(log, pluginId) {
    const forbidden = new Set([
        'setContext', 'clearContext', 'roomChanged', 'setEnabled', 'setCurrentVitals',
        'setMinimumSeverity', 'startTiming', 'endTiming', 'sessionStarted', 'sessionEnded',
    ]);
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === 'log') return (...args) => log(...args);
            if (prop === Symbol.for('rohy.deprecated')) return true;
            if (typeof prop !== 'string') return undefined;
            if (forbidden.has(prop)) {
                return () => {
                    throw new Error(`plugin '${pluginId}': ctx.eventLogger.${prop}() is not available to a plugin — use ctx.log (RPS-1 §6)`);
                };
            }
            warnOnce(`${pluginId}:${prop}`, `[ctx.eventLogger] plugin '${pluginId}' read '${prop}' on the deprecated eventLogger; use ctx.log`);
            return undefined;
        },
    });
}
