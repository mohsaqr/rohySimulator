/**
 * RPS-1 — the runtime half. Lifecycle, availability, and room chrome.
 *
 * Adapted from the pathology workstation's own registry (viewer/core/registry.js
 * in the upstream package), which proved the "peaceful exclusion rule"
 * empirically: delete a plugin directory, the app still boots, and the switcher
 * reports the module as unavailable with a reason instead of vanishing.
 *
 * One deliberate difference. The workstation loads modules with dynamic
 * import() in a try/catch, so a deleted directory is a runtime miss. Rohy is
 * bundled by Vite, where a static import of a deleted file is a BUILD failure.
 * Discovery therefore uses import.meta.glob (src/plugins/index.js), which
 * resolves at build time against whatever directories actually exist — so
 * deleting a plugin folder still leaves a bootable app, and the property is
 * preserved rather than lost to the bundler.
 */
import { roleAllows, validateManifest } from '../../server/shared/pluginRegistry.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

class PluginRegistry {
    constructor() {
        this.plugins = new Map();
        this.failures = [];
    }

    /** A plugin directory that failed to load at all — kept distinct from
     *  "loaded but unavailable", so a removed plugin reads as removed. */
    noteLoadFailure(id, reason) {
        this.failures.push({ id, ok: false, reason: `not loaded: ${reason}` });
    }

    register(descriptor) {
        const manifest = validateManifest(descriptor?.manifest);
        if (this.plugins.has(manifest.id)) {
            throw new Error(`Duplicate plugin id: ${manifest.id}`);
        }
        if (typeof descriptor.component !== 'function') {
            throw new Error(`Plugin '${manifest.id}' has no component`);
        }
        // Both halves of the authoring slot or neither — the same discipline
        // as manifest.js/index.jsx both having to exist. A manifest offering an
        // editor with no component renders a dead entry; a component with no
        // manifest entry can never be reached and is invisible to review.
        const declaresAuthoring = manifest.authoring !== undefined;
        const hasAuthorComponent = typeof descriptor.authorComponent === 'function';
        if (declaresAuthoring !== hasAuthorComponent) {
            throw new Error(
                declaresAuthoring
                    ? `Plugin '${manifest.id}' declares an 'authoring' manifest block but ships no authorComponent`
                    : `Plugin '${manifest.id}' ships an authorComponent but declares no 'authoring' block — `
                      + `nothing would route to it, and no minRole would gate it`
            );
        }
        // Cross-check against the generated snapshot the SERVER reads. Without
        // this, a runtime descriptor could carry a different id (or a newer
        // vocabulary) than the frozen manifest, and the plugin would mount
        // client-side while the server rejected every event it emitted.
        // `npm run plugins:gen` is what reconciles them.
        const frozen = PLUGIN_MANIFESTS.find((m) => m.id === manifest.id);
        if (!frozen) {
            throw new Error(
                `Plugin '${manifest.id}' is not in the generated manifests — run \`npm run plugins:gen\`. `
                + `Its events would be rejected by the server.`
            );
        }
        const declared = Object.keys(manifest.vocabulary?.verbs ?? {}).sort().join(',');
        const shipped = Object.keys(frozen.vocabulary?.verbs ?? {}).sort().join(',');
        if (declared !== shipped) {
            throw new Error(
                `Plugin '${manifest.id}' vocabulary has drifted from the generated manifest — run \`npm run plugins:gen\`.`
            );
        }
        this.plugins.set(manifest.id, {
            available: () => true,
            props: () => ({}),
            authorProps: () => ({}),
            ...descriptor,
            manifest,
        });
        return manifest.id;
    }

    all() {
        return [...this.plugins.values()]
            .sort((a, b) => (a.manifest.room.order ?? 100) - (b.manifest.room.order ?? 100));
    }

    get(id) {
        return this.plugins.get(id) ?? null;
    }

    manifests() {
        return this.all().map((p) => p.manifest);
    }

    /**
     * Which plugins can run for this context. A plugin that reports itself
     * unavailable — or whose check throws — is left out of navigation and the
     * rest of rohy is unaffected. The reason is retained so exclusion is
     * visible rather than mysterious.
     */
    resolve(makeContext) {
        this.report = this.all().map((plugin) => {
            try {
                // Per-plugin context, not one shared object: a plugin's `data`
                // is its own slice of the case config, keyed by its id, so a
                // single ctx would hand every plugin the wrong slice.
                const ctx = makeContext(plugin.manifest);
                // The role gate runs FIRST and separately, so "you may not open
                // this" is never reported as "this case has no material" —
                // two very different reasons to be missing a tab.
                if (!PluginRegistry.roomAllows(plugin.manifest, ctx?.session?.role)) {
                    return {
                        id: plugin.manifest.id,
                        ok: false,
                        reason: `role '${ctx?.session?.role ?? 'guest'}' is below minRole '${plugin.manifest.minRole}'`,
                        plugin,
                    };
                }
                const ok = Boolean(plugin.available(ctx));
                return { id: plugin.manifest.id, ok, reason: ok ? 'available' : 'declined for this case', plugin };
            } catch (error) {
                return { id: plugin.manifest.id, ok: false, reason: `check failed: ${error.message}`, plugin };
            }
        });
        return this.report.filter((r) => r.ok).map((r) => r.plugin);
    }

    /**
     * Plugins offering an authoring surface this role may open.
     *
     * Deliberately NOT filtered by `available()`: that gate asks whether a
     * plugin has material for THIS case, and an editor exists precisely when
     * it does not yet. Gating authoring on availability would hide the editor
     * exactly when it is needed.
     *
     * @param {string} role
     * @returns {Array<object>} plugin descriptors
     */
    authors(role) {
        return this.all().filter((plugin) => plugin.manifest.authoring
            && roleAllows(role, plugin.manifest.authoring.minRole));
    }

    /**
     * Is this room open to this role?
     *
     * `minRole` shipped with the standard and was enforced nowhere — a field
     * that reads like a guarantee and was not one. Availability now checks it.
     *
     * @param {object} manifest
     * @param {string} role
     * @returns {boolean}
     */
    static roomAllows(manifest, role) {
        return roleAllows(role, manifest.minRole);
    }

    diagnostics() {
        return (this.report ?? []).map(({ id, ok, reason }) => ({ id, ok, reason })).concat(this.failures);
    }
}

export const registry = new PluginRegistry();
