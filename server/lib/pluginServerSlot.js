/**
 * RPS-1 1.4 — the server slot.
 *
 * A plugin may ship a server module at `server/plugins/<id>/index.js`, mounted
 * by the host exactly as its room and editor are:
 *
 *   export default {
 *       jobs:   { 'import_slide': async (job, api) => {…} },
 *       routes: (router, ctx) => { router.post('/imports', …) },
 *   }
 *
 * PEACEFUL EXCLUSION, THE SAME PROPERTY THE CLIENT SLOT HAS
 *
 * `src/plugins/index.js` uses `import.meta.glob` so deleting a plugin directory
 * still leaves a bootable app. The server half must keep that property, so
 * discovery is a directory read and a dynamic import in a try/catch: a plugin
 * whose server module is absent, or which throws while loading, is REPORTED as
 * unavailable and the rest of rohy starts normally. A plugin that can take the
 * server down at boot is not a plugin, it is a dependency.
 *
 * WHAT THE PLUGIN GETS, AND WHY EACH THING IS NARROWED
 *
 * The client standard's rule (§6) is that a capability is an adapter the host
 * builds, never a host singleton. It applies harder here, because a server
 * module runs as the rohy service user:
 *
 *   db          the adapter, unchanged — but see the table rule below
 *   registerJob one queue, one worker, owned by the host (pluginJobs.js)
 *   download    the only way to pull bytes; carries the operator's allowlist
 *               already resolved, so a plugin cannot widen it (pluginFetch.js)
 *   runBinary   allow-listed argv exec, never a shell (pluginSpawn.js)
 *   libraryDir  the ONE directory the plugin may write in, or null
 *   settings    the tenant's effective settings for this plugin
 *
 * THE TABLE RULE IS ENFORCED BY A TEST, NOT BY A SQL PARSER
 *
 * R24 says a plugin's own tables are prefixed `plugin_<id>_`. Enforcing that at
 * runtime means parsing SQL to find table names, and a regex that has to
 * understand joins, CTEs and subqueries is a source of false rejections in the
 * hot path — a guard that breaks legitimate queries is worse than the drift it
 * prevents. So the rule is pinned by a contract test that scans
 * `server/plugins/**` (tests/server/plugin-server-slot.test.js), the same way
 * rohy pins its route-auth manifest. The narrowed things above are the ones
 * where narrowing is cheap and total.
 */
import express from 'express';
import { readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { readSettings, normalizeOrigin } from '../shared/pluginSettings.js';
import { registerJobHandler, enqueueJob, cancelJob } from './pluginJobs.js';
import { downloadToFile } from './pluginFetch.js';
import { runBinary } from './pluginSpawn.js';
import { importOriginsFor } from './pluginImportOrigins.js';
import {
    authenticateToken, requireAdmin, requireEducator, requireReviewer, requireStudent,
} from '../middleware/auth.js';
import { tenantId, auditSuccess } from '../routes/_helpers.js';
import { LEARNING_VERBS, resolveEventMetadata } from '../shared/learningVerbs.js';
import { nowIso, SQL_NOW } from '../shared/time.js';

const log = logger('plugin-server-slot');
const SLOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

/**
 * Per-plugin managed library directories.
 *
 * Plural — one directory per plugin — rather than the single
 * `ROHY_PLUGIN_LIBRARY_DIR` the design note first sketched. A singular variable
 * cannot serve a second plugin, and "the second plugin needs no host edit" is
 * the entire claim RPS-1 makes. Same shape as ROHY_PLUGIN_ORIGINS, deliberately:
 * an operator learns one format.
 *
 *   ROHY_PLUGIN_LIBRARY_DIRS="pathology=/srv/www/plugin-content/pathology/library"
 *
 * Unset means the plugin has no library and its import surface is unavailable —
 * not an error. A deployment that has not provisioned disk for slides is a
 * deployment that does not import slides.
 *
 * @param {string|undefined} raw
 * @returns {Map<string, string>} plugin id → absolute directory
 * @throws  {Error} on a malformed entry, so a typo is fatal at boot
 */
export function parseLibraryDirs(raw) {
    const out = new Map();
    if (!raw || !raw.trim()) return out;
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((entry) => {
        const eq = entry.indexOf('=');
        if (eq < 1) {
            throw new Error(`ROHY_PLUGIN_LIBRARY_DIRS entry '${entry}' is not '<pluginId>=<absolute path>'`);
        }
        const id = entry.slice(0, eq).trim();
        const dir = entry.slice(eq + 1).trim();
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            throw new Error(`ROHY_PLUGIN_LIBRARY_DIRS names plugin '${id}', which is not a lower_snake_case plugin id`);
        }
        // Absolute only. A relative path would resolve against whatever the
        // service's working directory happens to be, which differs between a
        // dev shell, a systemd unit and a Docker image — three different
        // directories for one config line.
        if (!dir.startsWith('/')) {
            throw new Error(`ROHY_PLUGIN_LIBRARY_DIRS path for '${id}' must be absolute, got '${dir}'`);
        }
        if (out.has(id)) {
            throw new Error(`ROHY_PLUGIN_LIBRARY_DIRS lists plugin '${id}' twice`);
        }
        out.set(id, resolve(dir));
    });
    return out;
}

let cachedDirs = null;

/** The parsed library directories, read once. */
export function libraryDirs() {
    if (cachedDirs === null) cachedDirs = parseLibraryDirs(process.env.ROHY_PLUGIN_LIBRARY_DIRS);
    return cachedDirs;
}

/** Test seam. */
export function resetLibraryDirs() { cachedDirs = null; }

/**
 * The context a plugin's server module receives.
 *
 * @param {object} manifest
 * @returns {object}
 */
export function buildServerContext(manifest) {
    const pluginId = manifest.id;
    const libraryDir = libraryDirs().get(pluginId) ?? null;
    const pluginLog = logger(`plugin:${pluginId}`);

    return {
        pluginId,
        manifest,
        log: pluginLog,
        db: dbAdapter,
        libraryDir,

        /** Register a job handler. The kind is namespaced by the host, so two
         *  plugins cannot collide on 'import' — the same discipline as
         *  mergeNamespace() applies to a plugin's verbs. */
        registerJob(kind, handler) {
            registerJobHandler(`${pluginId}:${kind}`, handler);
        },
        enqueue({ tenantId, kind, payload, assetId, userId }) {
            return enqueueJob({ tenantId, pluginId, kind: `${pluginId}:${kind}`, payload, assetId, userId });
        },
        cancel: cancelJob,

        /**
         * The tenant's effective settings for this plugin, flat dotted keys.
         * Read fresh on every call rather than cached: an admin who turns
         * imports off expects the next import to be refused, not the one after
         * a cache expiry.
         */
        async settings(tenantId) {
            const row = await dbAdapter.get(
                'SELECT settings FROM plugin_settings WHERE tenant_id = ? AND plugin_id = ?',
                [tenantId, pluginId]
            );
            return readSettings(manifest.settings, row?.settings ?? null);
        },

        /**
         * Download to a path inside this plugin's library directory.
         *
         * The allowlist is resolved HERE, from the operator's env intersected
         * with the tenant's setting — the plugin passes neither and therefore
         * cannot widen either.
         */
        async download({ tenantId, url, destPath, maxBytes, timeoutMs, onProgress }) {
            if (!libraryDir) {
                throw new Error(`plugin '${pluginId}' has no library directory configured (ROHY_PLUGIN_LIBRARY_DIRS)`);
            }
            const settings = await this.settings(tenantId);
            const operator = importOriginsFor(pluginId);
            const tenant = settings['imports.allowedOrigins'] ?? [];
            // Intersection, not either list. The tenant's stored value is not a
            // permission — the operator's env may have been narrowed since the
            // admin saved it, and the newer, tighter answer must win.
            const allowedOrigins = tenant.filter((o) => operator.includes(normalizeOrigin(o, 'origin')));
            return downloadToFile({
                url, destPath, rootDir: libraryDir, allowedOrigins, maxBytes, timeoutMs, onProgress,
            });
        },

        runBinary,

        /**
         * The clock. RPS-1 §17.
         *
         * A plugin must never reach for `new Date()` or sqlite's
         * `CURRENT_TIMESTAMP` on its own: the first one that did would pick a
         * third timestamp shape, and rohy has already paid for having two.
         * This returns the one contract shape — UTC ISO-8601, `Z`,
         * milliseconds — from the same clock the host stamps with.
         *
         * @returns {string} e.g. `2026-08-29T12:34:56.789Z`
         */
        now: nowIso,

        /**
         * Record a learning event from the SERVER side.
         *
         * Until this existed, every plugin event was emitted by the browser,
         * so a plugin's server work was invisible to analytics: a slide import
         * that ran for four minutes wrote `plugin_jobs` rows and not one
         * learning event, and `plugin_jobs` is not one of the Activity view's
         * sources. Work nobody clicked through — a job finishing, a job
         * failing, an asset expiring — had no way to be seen at all.
         *
         * The verb must be one the plugin DECLARED in its manifest vocabulary.
         * That is the same rule the ingest route applies to the browser, and
         * it is what stops a plugin inventing verbs at runtime that no
         * dashboard, state map or export knows how to interpret.
         *
         * `timestamp` is the server's clock, not a caller-supplied value:
         * a plugin can say what happened, never when.
         *
         * @param {object} event
         * @param {number} event.tenantId
         * @param {string} event.verb        must be in this plugin's vocabulary
         * @param {string} event.objectType
         * @param {number} [event.sessionId] resolves user/case when present
         * @param {number} [event.userId]    used when there is no session
         * @param {string} [event.objectId]
         * @param {string} [event.objectName]
         * @param {string} [event.result]
         * @param {number} [event.durationMs]
         * @param {object} [event.context]   JSON-serialisable
         * @returns {Promise<void>}
         * @throws {Error} when the verb is not declared by this plugin
         */
        async emit({ tenantId: tid, verb, objectType, sessionId = null, userId = null,
                     objectId = null, objectName = null, result = null,
                     durationMs = null, context = null }) {
            const ownVerbs = Object.keys(manifest.vocabulary?.verbs ?? {});
            if (!ownVerbs.includes(verb)) {
                throw new Error(
                    `plugin '${pluginId}' cannot emit '${verb}': not in its manifest vocabulary ` +
                    `(declares ${ownVerbs.length ? ownVerbs.join(', ') : 'no verbs'})`
                );
            }
            // Belt and braces: foldManifests should already have merged the
            // plugin's verbs into LEARNING_VERBS, so a verb that is declared
            // but missing here means the generated manifests are stale rather
            // than that the plugin is wrong. Say which, rather than failing at
            // the CHECK constraint.
            if (!LEARNING_VERBS.includes(verb)) {
                throw new Error(
                    `plugin '${pluginId}' declares '${verb}' but the host does not know it — ` +
                    `run \`npm run plugins:gen\``
                );
            }
            const meta = resolveEventMetadata(verb);
            let resolvedUser = userId;
            let resolvedCase = null;
            if (sessionId != null) {
                const row = await dbAdapter.get(
                    'SELECT user_id, case_id FROM sessions WHERE id = ? AND tenant_id = ?',
                    [sessionId, tid]
                );
                // The trinity is derived, never accepted — the same rule the
                // ingest route follows. A session id from another tenant
                // resolves to nothing rather than to that tenant's user.
                if (!row) {
                    throw new Error(`plugin '${pluginId}' cannot emit for session ${sessionId}: not in tenant ${tid}`);
                }
                resolvedUser = row.user_id;
                resolvedCase = row.case_id;
            }
            await dbAdapter.run(
                `INSERT INTO learning_events (
                    session_id, user_id, case_id, verb, object_type, object_id, object_name,
                    component, result, duration_ms, context, tenant_id, severity, category,
                    room, timestamp
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})`,
                [sessionId, resolvedUser, resolvedCase, verb, objectType, objectId, objectName,
                 `plugin:${pluginId}`, result, durationMs,
                 context ? JSON.stringify(context) : null,
                 tid, meta.severity, meta.category, pluginId]
            );
        },


        /**
         * Remove one asset's directory, and nothing else.
         *
         * The host owns this rather than the plugin, for the same reason it owns
         * download and spawn: it is the destructive one. The id arrives from a
         * URL parameter, so `assetId` of '../../etc' would escape a naively
         * joined path — and unlike a bad read, a bad recursive delete cannot be
         * undone by retrying. Two checks, both required: the id must have the
         * shape the host generates, and the resolved path must still be inside
         * the library.
         *
         * @param {string} assetId
         * @returns {Promise<boolean>} false when there was nothing to remove
         */
        async removeAssetDirectory(assetId) {
            if (!libraryDir) return false;
            if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(assetId))) {
                throw new Error(`refusing to remove '${assetId}': not a valid asset id`);
            }
            const target = resolve(libraryDir, String(assetId));
            // Belt and braces. The pattern above already forbids a separator or
            // a dot, so this cannot fail — which is the point: it is what keeps
            // that true if the pattern is ever loosened.
            if (!target.startsWith(libraryDir.endsWith(sep) ? libraryDir : libraryDir + sep)) {
                throw new Error(`refusing to remove '${assetId}': outside the plugin library directory`);
            }
            await rm(target, { recursive: true, force: true });
            pluginLog.info('asset directory removed', { assetId });
            return true;
        },

        /**
         * The host's auth guards, handed over rather than re-derived.
         *
         * A plugin writing its own role check is a plugin that will eventually
         * write a different one from rohy's — and `authenticateToken` is not
         * only authentication: it verifies the JWT, checks server-side
         * revocation in `active_sessions`, re-reads the role from `users` so a
         * role change takes effect immediately, AND runs CSRF for cookie
         * clients. Every one of those is lost by a hand-rolled equivalent.
         */
        guards: {
            authenticated: authenticateToken,
            student: requireStudent,
            reviewer: requireReviewer,
            educator: requireEducator,
            admin: requireAdmin,
        },

        /** Tenant scoping and the audit chain — the two things every mutation
         *  in rohy does, so a plugin's mutations do them the same way. */
        helpers: { tenantId, auditSuccess },
    };
}

/**
 * Tables the host owns and any plugin may use, because the host defined them
 * for exactly this purpose.
 */
export const SHARED_PLUGIN_TABLES = ['plugin_settings', 'plugin_jobs', 'plugin_assets'];

/**
 * SQL words that follow one of the scanned keywords without being a table.
 *
 * The one that matters is `SET`: an upsert ends `ON CONFLICT (id) DO UPDATE SET
 * …`, so `update` is followed by `SET` and a naive scan reports a table called
 * `set`. The rest are here for the same reason — a lint that cries wolf gets
 * switched off.
 */
const SQL_KEYWORDS = new Set([
    'set', 'select', 'values', 'where', 'exists', 'if', 'not', 'and', 'or', 'on', 'conflict', 'do',
]);

/**
 * Table names a plugin's SQL touches that R24 does not permit it.
 *
 * R24: a plugin's own tables are prefixed `plugin_<id>_`. This finds the table
 * names in a source file and returns the ones that are neither so prefixed nor
 * a shared host table.
 *
 * It is a LINT, not a parser, and is used by a contract test rather than at
 * runtime — see this module's header for why a SQL-parsing guard in the hot
 * path is the wrong trade. It recognises the four statements that can name a
 * table a plugin should not be naming; a plugin determined to evade it can, and
 * the standard is explicit (§1) that plugins are not a security boundary. What
 * it catches is the actual failure: a plugin reaching into `users` or `cases`
 * because that was easier than asking the host.
 *
 * @param {string} source   JS source text
 * @param {string} pluginId
 * @returns {string[]} offending table names, deduplicated and sorted
 */
export function disallowedTables(source, pluginId) {
    const allowedPrefix = `plugin_${pluginId}_`;
    // Comments first: English prose is full of "from a", "update the" and "set",
    // and a detector that reads them reports `a`, `the` and `set` as tables.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Then STRING LITERALS ONLY, and only ones that look like SQL. A table name
    // can only appear inside a query, so anything outside one is noise.
    const literals = code.match(/`[^`]*`|'[^']*'|"[^"]*"/g) ?? [];
    const queries = literals.filter((lit) => /\b(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i.test(lit));

    const found = new Set();
    const re = /\b(?:from|join|into|update|table(?:\s+if\s+not\s+exists)?)\s+([a-z_][a-z0-9_]*)/gi;
    queries.forEach((query) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(query)) !== null) {
            const table = m[1].toLowerCase();
            if (SQL_KEYWORDS.has(table)) continue;
            // `continue`, not `return`: inside a forEach callback a `return`
            // abandons the whole QUERY at its first allowed table, so
            // `FROM plugin_pathology_x JOIN sessions` would report nothing.
            if (table.startsWith(allowedPrefix) || SHARED_PLUGIN_TABLES.includes(table)) continue;
            found.add(table);
        }
    });
    return [...found].sort();
}

/**
 * Discover, load and mount every plugin server module.
 *
 * @param {import('express').Router} router  mounted at /api
 * @returns {Promise<Array<{id: string, ok: boolean, reason: string}>>} a report,
 *          in the same shape as the client registry's diagnostics()
 */
export async function mountPluginServerSlots(router) {
    const report = [];
    let entries;
    try {
        entries = await readdir(SLOT_DIR, { withFileTypes: true });
    } catch {
        // No server/plugins/ at all is the normal state of a deployment with no
        // server-slot plugins, not a failure.
        return report;
    }

    for (const entry of entries.filter((e) => e.isDirectory())) {
        const id = entry.name;
        const manifest = PLUGIN_MANIFESTS.find((m) => m.id === id);
        if (!manifest) {
            // A server module with no manifest would mount routes under an id
            // nothing else in rohy knows about — no minRole, no vocabulary, no
            // settings. Refused, and said out loud.
            report.push({ id, ok: false, reason: 'no manifest — run `npm run plugins:gen`' });
            log.warn('plugin server module has no manifest', { pluginId: id });
            continue;
        }
        let mod;
        try {
            mod = (await import(`../plugins/${id}/index.js`)).default;
        } catch (err) {
            report.push({ id, ok: false, reason: `not loaded: ${err.message}` });
            log.error('plugin server module failed to load', { pluginId: id, error: err.message });
            continue;
        }
        if (!mod || typeof mod !== 'object') {
            report.push({ id, ok: false, reason: 'server module has no default export object' });
            continue;
        }
        try {
            const ctx = buildServerContext(manifest);
            // The plugin's handler receives ctx as a third argument rather than
            // through `this`: a module-level export is not a method, and binding
            // `this` would work until the first time someone destructured the
            // handler out of the object.
            Object.entries(mod.jobs ?? {}).forEach(([kind, handler]) => {
                ctx.registerJob(kind, (job, api) => handler(job, api, ctx));
            });
            if (typeof mod.routes === 'function') {
                // Every route the plugin declares lands under its own id, so the
                // manifest's one identity stays one identity (§2).
                const sub = express.Router();
                mod.routes(sub, ctx);
                router.use(`/plugins/${id}`, sub);
            }
            report.push({
                id,
                ok: true,
                reason: ctx.libraryDir ? 'mounted' : 'mounted without a library directory',
            });
            log.info('plugin server module mounted', {
                pluginId: id,
                jobs: Object.keys(mod.jobs ?? {}).length,
                routes: typeof mod.routes === 'function',
                libraryDir: ctx.libraryDir,
            });
        } catch (err) {
            report.push({ id, ok: false, reason: `mount failed: ${err.message}` });
            log.error('plugin server module failed to mount', { pluginId: id, error: err.message });
        }
    }
    return report;
}
