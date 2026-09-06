// Plugin-shipped translations — layer 2 of the resolution order.
//
//   1. src/locales/<lang>/<ns>.json          rohy's catalogue — reviewed, locked, WINS
//   2. src/plugins/<id>/locales/<lang>.json  what the plugin shipped   ← this file
//   3. t(key, 'English') in the code         the inline fallback
//
// A plugin ships translated strings so it works on install without rohy
// translating anything; rohy can still shadow any of them, and only rohy's
// override goes through review and locking. Layering is enforced by ORDER of
// addResourceBundle: rohy's own bundles are added first (or eagerly, for
// English), and these go in with overwrite = false.
//
// Catalogues are globbed rather than read from the manifest because
// manifests.generated.js is imported by the server, which renders no strings.
// The glob is non-eager, so each plugin language is its own chunk and a
// student downloads only the language they use.

import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { localeNamespaceOf, resolveLocaleLayers } from '../../server/shared/pluginRegistry.js';

const namespaceById = new Map(PLUGIN_MANIFESTS.map(m => [m.id, localeNamespaceOf(m)]));

// src/plugins/<id>/locales/<lang>.json — id and lang come from the path, so a
// plugin folder that is deleted simply stops contributing (the same
// peaceful-exclusion property the plugin registry has).
const catalogueModules = import.meta.glob('../plugins/*/locales/*.json');

const PATH_SHAPE = /\/plugins\/([\w-]+)\/locales\/([\w-]+)\.json$/;

/** Namespaces any plugin contributes to, so i18n can declare them up front. */
export function pluginNamespaces() {
    const seen = new Set();
    for (const path of Object.keys(catalogueModules)) {
        const match = path.match(PATH_SHAPE);
        if (match && namespaceById.has(match[1])) seen.add(namespaceById.get(match[1]));
    }
    return [...seen];
}

/**
 * Load every plugin's catalogue for one language.
 *
 * @param {string} lng  Registry language code.
 * @returns {Promise<Record<string, Record<string, string>>>} namespace → key → string.
 *   Empty when no plugin ships that language — the caller then renders rohy's
 *   own catalogue, or the code's inline English.
 */
export async function loadPluginLocales(lng) {
    const entries = await Promise.all(
        Object.entries(catalogueModules)
            .map(([path, load]) => ({ path, load, match: path.match(PATH_SHAPE) }))
            .filter(({ match }) => match && match[2] === lng && namespaceById.has(match[1]))
            .map(async ({ load, match }) => ({
                id: match[1],
                namespace: namespaceById.get(match[1]),
                table: (await load()).default
            }))
    );
    return resolveLocaleLayers(entries);
}

/**
 * Add a language's plugin strings to i18next UNDERNEATH whatever rohy already
 * has. Never throws outward: a plugin with a broken catalogue must not stop
 * the app from rendering — it degrades to rohy's strings, then to the inline
 * English, which is exactly what layer 3 is for.
 *
 * @param {import('i18next').i18n} i18n
 * @param {string} lng
 * @returns {Promise<void>}
 */
export async function applyPluginLocales(i18n, lng) {
    let byNamespace;
    try {
        byNamespace = await loadPluginLocales(lng);
    } catch (err) {
        // A collision between two plugins, or a malformed catalogue. Loud in
        // the console and caught by `npm run plugins:check` in CI; not fatal
        // to a student mid-session.
        console.error(`[i18n] plugin locales for '${lng}' were not applied:`, err);
        return;
    }
    for (const [ns, table] of Object.entries(byNamespace)) {
        // deep = true, overwrite = FALSE: this is the whole layering rule.
        i18n.addResourceBundle(lng, ns, table, true, false);
    }
}
