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
