/**
 * RPS-1 §11a.3(4) — the server-side guard on a plugin's case document.
 *
 * `config[<pluginId>]` is one JSON document, owned by the plugin and opaque to
 * rohy. The server never reads inside it; it stores, snapshots, exports and
 * versions it as a unit. What it DOES check is that the thing is storable at
 * all, because everything downstream — the session snapshot, export/import,
 * case versions — assumes it is.
 *
 * WHY THIS IS SERVER-SIDE AND SELF-CONTAINED. Upstream ships the same
 * judgements (`caseDocumentBytes`, `findRemoteRefs` in the vendored package),
 * but `server/` may not import from `src/`: the checks have to hold for any
 * client, including one that never ran the plugin's code, and a guard that
 * lives in the browser is not a guard. The walk below is deliberately generic
 * for the same reason `resolveRemoteRefs` is — which keys hold sources is the
 * plugin's business and the host would be wrong about it after its next
 * release.
 *
 * Everything here is driven by the frozen manifest snapshot, so adding a
 * second authoring plugin needs no change in this file.
 */

import { parseDocumentPath, roleAllows } from './pluginRegistry.js';
import { disabledRooms } from './caseRooms.js';

/**
 * The default cap on one plugin document, serialised.
 *
 * Well under express's 256 KB body limit — a case carries demographics, labs,
 * a scenario and treatments alongside this — and far more than a text document
 * needs: a pathology case with slides, ROIs and prose measures about 1 KB.
 *
 * A plugin that genuinely needs more raises it PER PLUGIN in its manifest,
 * never globally, so one plugin's appetite cannot enlarge every request rohy
 * accepts.
 */
export const DEFAULT_DOCUMENT_MAX_BYTES = 64 * 1024;

/** The cap this particular plugin's document is held to. */
export function documentMaxBytes(manifest) {
    const declared = manifest?.document?.maxBytes;
    return Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_DOCUMENT_MAX_BYTES;
}

const REMOTE_SCHEME = 'remote:';

/**
 * Every `remote:` reference in a document, with the path that holds it.
 *
 * Mirrors the package's own `findRemoteRefs()`. Cycle-guarded: parsed JSON is a
 * tree, but this runs on a request body and must not be turnable into a hang.
 *
 * @param {*} value
 * @returns {Array<{path: string, ref: string}>}
 */
export function findRemoteRefs(value) {
    const found = [];
    const seen = new Set();
    const walk = (node, at) => {
        if (typeof node === 'string') {
            if (node.startsWith(REMOTE_SCHEME)) found.push({ path: at, ref: node });
            return;
        }
        if (!node || typeof node !== 'object') return;
        if (seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
            return;
        }
        Object.entries(node).forEach(([key, entry]) => walk(entry, `${at}.${key}`));
    };
    walk(value, '$');
    return found;
}

/** `remote:tiles/x.dzi` -> `/tiles/x.dzi`, the shape remote.paths is written in. */
function refPath(ref) {
    return `/${ref.slice(REMOTE_SCHEME.length).replace(/^\/+/, '')}`;
}

/**
 * Check every plugin document on a case config.
 *
 * Only keys that a manifest CLAIMS are inspected. An unknown top-level config
 * key belongs to rohy or to a future plugin and is not ours to police —
 * rejecting it would make this guard a gate on the whole case shape.
 *
 * @param {object} config          the case config about to be stored
 * @param {Array<object>} manifests the frozen manifest snapshot
 * @returns {{error: string, code: string}|null} null when everything is storable
 */
export function validatePluginDocuments(config, manifests) {
    if (!config || typeof config !== 'object') return null;

    for (const manifest of manifests ?? []) {
        // Only plugins that ship an editor can put a document on a case; a
        // room-only plugin has nothing to write and nothing to check.
        if (!manifest?.authoring) continue;
        const id = manifest.id;
        if (!Object.prototype.hasOwnProperty.call(config, id)) continue;

        const document = config[id];
        // Absent and null both mean "no material". The key may be present and
        // null — that is how a wizard removes a plugin from a case — and it
        // must not be mistaken for a malformed document.
        if (document === null || document === undefined) continue;

        if (typeof document !== 'object' || Array.isArray(document)) {
            return {
                code: 'invalid_plugin_config',
                error: `config.${id} must be an object — a plugin's case material is one JSON document.`,
            };
        }

        let serialised;
        try {
            serialised = JSON.stringify(document);
        } catch {
            return {
                code: 'invalid_plugin_config',
                error: `config.${id} could not be serialised — a plugin document must be plain JSON.`,
            };
        }

        const bytes = Buffer.byteLength(serialised, 'utf8');
        const cap = documentMaxBytes(manifest);
        if (bytes > cap) {
            return {
                code: 'invalid_plugin_config',
                error: `config.${id} is ${Math.round(bytes / 1024)} KB, over the ${Math.round(cap / 1024)} KB `
                    + 'a plugin document may carry. Images stored inside the case are the usual cause: bulk content '
                    + `belongs behind the plugin's remote proxy as a "remote:" reference, not inline in the document.`,
            };
        }

        // A remote reference the proxy would refuse is worth catching here.
        // The proxy already 403s an undeclared prefix, but failing at authoring
        // time tells the author which field is wrong; failing at read time
        // tells a learner their slide is broken.
        const allowed = manifest.remote?.paths ?? [];
        for (const { path, ref } of findRemoteRefs(document)) {
            const target = refPath(ref);
            const ok = allowed.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
            if (!ok) {
                return {
                    code: 'invalid_plugin_config',
                    error: allowed.length === 0
                        ? `config.${id} carries the remote reference "${ref}" at ${path}, but this plugin declares no remote paths.`
                        : `config.${id} carries the remote reference "${ref}" at ${path}, which is outside `
                            + `this plugin's declared paths (${allowed.join(', ')}).`,
                };
            }
        }
    }
    return null;
}

// ---- Learner projection (RPS-1 §11a.4: "what may the learner's browser receive?") ----
//
// A plugin's document carries the material AND the answer key — pathology's
// `rubric` holds every expected answer, ROI and dwell threshold. The room
// renders the package's `learnerCase()` projection, but a projection applied
// in the browser decides only what a component SHOWS; only the server decides
// what a role RECEIVES. `GET /cases`, `GET /cases/:id` and every endpoint
// that returns `sessions.case_snapshot` used to hand the whole document to
// the learner being assessed with it — the same trap `case_treatments` was
// kept out of `case_snapshot` to avoid (sessions-routes.js).
//
// The server cannot import the package, so the plugin names what to strip in
// its manifest: `document.learnerOmit = ['rubric', 'worklist[].rubric']` —
// paths into the document, where a `[]` segment means every element of that
// array — removed for every role below reviewer. `document.learnerOmitWhen`
// removes properties only from objects matching a condition (PACS: a report
// the author wrote but did not release). Frozen data, like `maxBytes` and
// `remote.paths`; the path grammar is `parseDocumentPath` in pluginRegistry.js.

/** The role from which the whole document (answer key included) may be read. */
export const DOCUMENT_FULL_READ_ROLE = 'reviewer';

/** Paths this plugin asks the host to strip for learners. */
export function learnerOmitPaths(manifest) {
    const declared = manifest?.document?.learnerOmit;
    return Array.isArray(declared) ? declared.filter((p) => typeof p === 'string' && p.length > 0) : [];
}

/** Conditional strip rules this plugin declares (`{ path, when, omit }`). */
export function learnerOmitWhenRules(manifest) {
    const declared = manifest?.document?.learnerOmitWhen;
    return Array.isArray(declared) ? declared.filter((r) => r && typeof r === 'object') : [];
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Apply `edit` to every plain object `steps` reach inside `node`, cloning only
 * along the way and returning `node` itself (same reference) when nothing
 * changed. Never mutates. A missing key, a non-array under `[]`, or a
 * non-object element ends that branch untouched — there is nothing to strip.
 */
function updateAt(node, steps, edit) {
    if (!isPlainObject(node)) return node;
    if (steps.length === 0) return edit(node);
    const [{ key, each }, ...rest] = steps;
    if (!Object.hasOwn(node, key)) return node;
    const child = node[key];
    let next;
    if (each) {
        if (!Array.isArray(child)) return node;
        const mapped = child.map((element) => updateAt(element, rest, edit));
        next = mapped.some((element, i) => element !== child[i]) ? mapped : child;
    } else {
        next = updateAt(child, rest, edit);
    }
    return next === child ? node : { ...node, [key]: next };
}

function withoutKeys(object, keys) {
    if (!keys.some((key) => Object.hasOwn(object, key))) return object;
    const clone = { ...object };
    keys.forEach((key) => { delete clone[key]; });
    return clone;
}

/** Remove one learnerOmit path. An unparseable path strips nothing (the manifest validator rejects it first). */
export function omitDocumentPath(document, path) {
    const steps = parseDocumentPath(path);
    if (!steps || steps[steps.length - 1].each) return document;
    const last = steps[steps.length - 1].key;
    return updateAt(document, steps.slice(0, -1), (parent) => withoutKeys(parent, [last]));
}

/** Apply one learnerOmitWhen rule: strip `omit` from each object at `path` whose own props `===` every `when` pair. */
export function omitDocumentWhen(document, { path, when, omit } = {}) {
    const steps = parseDocumentPath(path);
    if (!steps || !isPlainObject(when) || !Array.isArray(omit)) return document;
    const pairs = Object.entries(when);
    const matches = (object) => pairs.every(([key, value]) => Object.hasOwn(object, key) && object[key] === value);
    return updateAt(document, steps, (object) => (matches(object) ? withoutKeys(object, omit) : object));
}

/**
 * The case config a given role may receive: every plugin document with its
 * `learnerOmit` paths and matching `learnerOmitWhen` properties removed for
 * roles below reviewer — and the whole document of a plugin room the case has
 * switched off (config.rooms, shared/caseRooms.js), so that room's
 * `available()` fails in any client and its material never reaches a learner.
 * Returns the input untouched (same reference) when there is nothing to
 * strip, so callers can apply it unconditionally.
 *
 * @param {object|null|undefined} config
 * @param {Array<object>} manifests   the frozen manifest snapshot
 * @param {string} role
 * @returns {object|null|undefined}
 */
export function projectPluginDocumentsForRole(config, manifests, role) {
    if (!config || typeof config !== 'object') return config;
    if (roleAllows(role, DOCUMENT_FULL_READ_ROLE)) return config;
    let out = config;
    const off = disabledRooms(config);
    for (const manifest of manifests ?? []) {
        const id = manifest?.id;
        if (id && off.includes(id) && Object.hasOwn(config, id)) {
            if (out === config) out = { ...config };
            delete out[id];
            continue;
        }
        const document = id ? config[id] : null;
        if (!isPlainObject(document)) continue;
        const stripped = learnerOmitPaths(manifest).reduce((doc, path) => omitDocumentPath(doc, path), document);
        const projected = learnerOmitWhenRules(manifest).reduce((doc, rule) => omitDocumentWhen(doc, rule), stripped);
        if (projected === document) continue;
        if (out === config) out = { ...config };
        out[id] = projected;
    }
    return out;
}

/**
 * Same projection for a `sessions.case_snapshot` value as stored (a JSON
 * string, or an already-parsed object). Returns the same type it was given;
 * an unparseable snapshot is returned unchanged rather than thrown on — the
 * read endpoints never failed on it before and must not start now.
 */
export function projectCaseSnapshotForRole(snapshot, manifests, role) {
    if (snapshot == null) return snapshot;
    if (roleAllows(role, DOCUMENT_FULL_READ_ROLE)) return snapshot;
    const isString = typeof snapshot === 'string';
    let parsed = snapshot;
    if (isString) {
        try { parsed = JSON.parse(snapshot); } catch { return snapshot; }
    }
    if (!parsed || typeof parsed !== 'object') return snapshot;
    const config = projectPluginDocumentsForRole(parsed.config, manifests, role);
    if (config === parsed.config) return snapshot;
    const projected = { ...parsed, config };
    return isString ? JSON.stringify(projected) : projected;
}
