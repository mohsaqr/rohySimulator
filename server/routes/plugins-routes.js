// Plugin remote-content proxy (RPS-1, the 'remote' capability).
//
//   GET /api/plugins/:pluginId/*  — read-only relay to the plugin's configured
//                                   origin, for content too large or too
//                                   licence-encumbered to live in rohy's image.
//
// WHY A PROXY AND NOT A CSP ALLOWANCE
//
// The alternative was widening `img-src`/`connect-src` in server/security-headers.js
// to name the slide host. That is one line and it is the wrong line: it puts a
// third-party origin inside the page's trust boundary for EVERY case and every
// tenant, permanently, and it hands the browser — not the server — the job of
// deciding what rohy is allowed to load. Proxying keeps the CSP at 'self',
// keeps upstream reachability a server-side fact, and makes "who may read which
// slide" a question rohy can actually answer.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
//   - It does not accept an origin from the client. See pluginRemoteOrigins.js.
//   - It does not follow redirects. A 302 from the configured origin to
//     169.254.169.254 would turn an origin allowlist into an open SSRF, and
//     `redirect: 'follow'` would take it without asking.
//   - It does not forward the caller's cookies, Authorization header, or query
//     string upstream, and it does not return upstream Set-Cookie downstream.
//     The two sides share a path and nothing else.
//   - It does not write. GET only: a proxy that can POST is a confused deputy
//     with rohy's network position.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requireStudent } from '../middleware/auth.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { roleAllows } from '../shared/pluginRegistry.js';
import { pluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { readSettings, mergeSettings, visibleSettingKeys } from '../shared/pluginSettings.js';
import { importOriginsFor } from '../lib/pluginImportOrigins.js';
import { tenantId, auditSuccess, dbGet, dbRun, dbAll } from './_helpers.js';
import { logger } from '../logger.js';

const log = logger('plugin-proxy');
const router = express.Router();

// A deep-zoom pan is hundreds of tile requests in a few seconds — this is the
// one route in rohy where that is normal traffic rather than abuse, which is
// why routes.js exempts it from generalLimiter and it carries its own much
// wider budget instead. Keyed per (tenant, user), never per IP: a teaching lab
// shares one NAT address and one student reading a slide must not exhaust the
// room's budget.
const proxyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    message: { error: 'Too many plugin content requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.tenant_id || 'tenant'}:${req.user?.id || 'user'}`,
});

// Upstream budgets. A tile is tens of kilobytes; a DZI descriptor is bytes.
// The cap is not about tiles, it is about what a compromised or simply broken
// upstream can push through rohy into a browser before anyone notices.
const UPSTREAM_TIMEOUT_MS = 15000;
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;

const MANIFESTS_BY_ID = new Map(PLUGIN_MANIFESTS.map((m) => [m.id, m]));

/**
 * Rebuild the upstream path from Express 5's decoded wildcard segments.
 *
 * Traversal arrives in two spellings and they are caught in two different
 * places — verified against Express 5.2, not assumed:
 *
 *   `/tiles/%2e%2e/secret`  the router normalises the URL BEFORE matching, so
 *                           this is already `/secret` by the time the handler
 *                           runs. The '..' is gone; what stops it is the
 *                           declared-prefix check in the handler.
 *   `/tiles/..%2fsecret`    the encoded SLASH is not normalised, so this
 *                           survives as ONE decoded segment, `../secret`. No
 *                           amount of prefix checking sees it — the segment
 *                           still reads as being under '/tiles'. What stops it
 *                           is the separator check below.
 *
 * Neither check is redundant, and dropping either leaves a live spelling.
 *
 * There is a third layer under both: segments are re-encoded INDIVIDUALLY on
 * the way out, so `../secret` would go upstream as `..%2Fsecret` and could not
 * escape the prefix even if the check above were deleted (measured — removing
 * the check turns that request into an upstream 404, not a breakout). The check
 * still earns its place, because the difference between the two outcomes is
 * whether rohy makes an outbound request at all on a caller's malformed say-so.
 * Encoding also means a legitimate space in a filename survives the round trip.
 *
 * @param {string[]|string|undefined} splat
 * @returns {{ok: true, path: string}|{ok: false, reason: string}}
 */
export function buildUpstreamPath(splat) {
    const segments = Array.isArray(splat) ? splat : (splat ? [splat] : []);
    if (segments.length === 0) return { ok: false, reason: 'empty path' };
    for (const seg of segments) {
        if (seg === '' || seg === '.' || seg === '..') return { ok: false, reason: 'traversal or empty segment' };
        if (seg.includes('/') || seg.includes('\\')) return { ok: false, reason: 'separator inside a segment' };
        // A NUL truncates the path for some upstream filesystems while looking
        // harmless in a log line.
        if (seg.includes('\0')) return { ok: false, reason: 'null byte' };
    }
    return { ok: true, path: `/${segments.map(encodeURIComponent).join('/')}` };
}

/**
 * Is `path` inside one of the manifest's declared prefixes?
 *
 * Prefix matching is done on segment boundaries, so a declared '/tiles' grants
 * '/tiles/a.jpg' but not '/tiles-private/a.jpg'.
 *
 * @param {string} path
 * @param {string[]} prefixes
 * @returns {boolean}
 */
export function pathIsDeclared(path, prefixes) {
    return (prefixes || []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// The plugin's slide/asset CATALOG for authors (RPS-1 §7a.1). The content
// bundle ships `catalog.json` at the origin's root — the library the editor
// offers, every URL a `remote:` reference — and this relays it to roles that
// may author. Declared BEFORE the splat route so it is matched first; it is
// deliberately NOT part of the learner-facing content proxy: the catalog is
// JSON (the proxy's content types are images/XML) and it describes what an
// institution owns, which is an author's concern, not a learner's.
const CATALOG_MAX_BYTES = 4 * 1024 * 1024;

router.get('/plugins/:pluginId/catalog', authenticateToken, proxyLimiter, async (req, res) => {
    const { pluginId } = req.params;
    const manifest = MANIFESTS_BY_ID.get(pluginId);
    // No editor → no catalog; same shape as an unknown plugin so the route
    // does not reveal which plugins are installed.
    if (!manifest || !manifest.remote || !manifest.authoring) {
        return res.status(404).json({ error: 'no such plugin catalog', code: 'plugin_catalog_unknown' });
    }
    if (!roleAllows(req.user?.role, manifest.authoring.minRole)) {
        return res.status(403).json({ error: 'insufficient role for this plugin\'s catalog', code: 'plugin_forbidden' });
    }
    const origin = pluginOrigins().get(pluginId);
    if (!origin) {
        return res.status(503).json({
            error: `No remote origin is configured for plugin '${pluginId}'. Set ROHY_PLUGIN_ORIGINS.`,
            code: 'plugin_remote_not_configured',
        });
    }
    let upstream;
    try {
        upstream = await fetch(`${origin}/catalog.json`, {
            method: 'GET', redirect: 'manual',
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            headers: { accept: 'application/json' },
        });
    } catch (err) {
        log.warn('plugin catalog fetch failed', { pluginId, error: err.message });
        return res.status(502).json({ error: 'plugin catalog is unavailable', code: 'plugin_remote_unreachable' });
    }
    if (upstream.status === 404) {
        return res.status(404).json({ error: 'this content origin ships no catalog', code: 'plugin_catalog_missing' });
    }
    if (!upstream.ok) {
        return res.status(502).json({ error: 'plugin catalog is unavailable', code: 'plugin_remote_status' });
    }
    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > CATALOG_MAX_BYTES) {
        return res.status(502).json({ error: 'plugin catalog is too large', code: 'plugin_remote_too_large' });
    }
    const text = await upstream.text();
    if (Buffer.byteLength(text, 'utf8') > CATALOG_MAX_BYTES) {
        return res.status(502).json({ error: 'plugin catalog is too large', code: 'plugin_remote_too_large' });
    }
    let catalog;
    try { catalog = JSON.parse(text); } catch {
        return res.status(502).json({ error: 'plugin catalog is not JSON', code: 'plugin_catalog_invalid' });
    }
    if (!catalog || typeof catalog !== 'object' || catalog.version !== 1 || !Array.isArray(catalog.assets)) {
        return res.status(502).json({ error: 'plugin catalog has an unexpected shape', code: 'plugin_catalog_invalid' });
    }
    // Every URL must be a reference INTO this plugin's declared paths. A
    // catalog that points elsewhere is the origin operator's mistake, and an
    // author who adds such a slide would get a case the guard then rejects.
    const stray = JSON.stringify(catalog).match(/"url":\s*"(?!remote:)[^"]*"/);
    if (stray) {
        return res.status(502).json({ error: 'plugin catalog carries a URL that is not a remote: reference', code: 'plugin_catalog_invalid' });
    }
    // Merge in the MANAGED half of the library (RPS-1 1.4). The bundle is what
    // a content deploy shipped; these are slides this tenant imported from a
    // link. The editor asks one endpoint and gets one library, because "which
    // half did this slide come from" is an operator's question, not an author's.
    //
    // Only 'ready' assets. A slide that is still importing, has failed, or is
    // awaiting calibration is real but not yet usable, and offering it here
    // would let an author build a case around a slide whose scale is unknown.
    // The full library, every state and its error text, is the plugin's own
    // /assets route.
    const managed = await dbAll(
        `SELECT id, label, native_objective, native_mpp_x, tiled_objective, width, height
           FROM plugin_assets
          WHERE plugin_id = ? AND tenant_id = ? AND state = 'ready'
          ORDER BY created_at DESC`,
        [pluginId, tenantId(req)]
    ).catch(() => []);
    if (managed.length > 0) {
        catalog.assets = [
            ...managed.map((row) => ({
                id: row.id,
                label: row.label,
                status: 'ready',
                managed: true,
                preview: { url: `remote:library/${row.id}/preview.jpg` },
                currentRevisionId: 'managed',
                revisions: [{
                    id: 'managed',
                    status: 'ready',
                    derivatives: { dzi: { url: `remote:library/${row.id}/slide.dzi` } },
                    optics: {
                        nativeObjective: row.native_objective,
                        nativeMpp: row.native_mpp_x,
                        tiledObjective: row.tiled_objective,
                    },
                    widthPx: row.width,
                    heightPx: row.height,
                }],
            })),
            ...(catalog.assets ?? []),
        ];
    }
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ plugin: pluginId, catalog });
});

// --- the settings slot (RPS-1 1.4, §11c) ---------------------------------
//
// The host stores and validates plugin settings GENERICALLY, from the schema
// the manifest declares. Pathology is the first user; a second plugin gets an
// admin page by declaring fields, not by shipping a React screen — which is the
// difference between closing §14.4's gap and closing it once.
//
// Both routes are declared BEFORE the content splat so it does not swallow them.

/** A tenant's stored flat map, or {} when it has never saved. */
async function storedSettings(tenant, pluginId) {
    const row = await dbGet(
        'SELECT settings FROM plugin_settings WHERE tenant_id = ? AND plugin_id = ?',
        [tenant, pluginId]
    );
    return row?.settings ?? null;
}

/**
 * Deployment-wide ceilings for a manifest's numeric fields.
 *
 * A field declares the NAME of an env var (`ceilingEnv`); the value is read
 * here, on the server, because server/shared/ is bundled into the browser and
 * a limit read from a non-existent `process` would be no limit at all. A tenant
 * admin may lower a value below the ceiling and never raise one above it — an
 * operator who caps a deployment is not overridden by a manifest that declares
 * a bigger max.
 *
 * @param {object} manifest
 * @returns {object} dotted setting key → integer ceiling
 */
function hostConstraints(manifest, pluginId) {
    // Read LITERALLY, one line per bound, because docs-gen/gen-config.mjs
    // discovers environment variables by scanning source for their literal
    // spelling. A computed lookup by `field.ceilingEnv` works at runtime and is
    // invisible to that scan — the config reference would omit the knob, and an
    // operator would have no documented way to find it.
    // server/shared/pluginSettings.js's HOST_CEILING_ENVS and
    // HOST_ORIGIN_ALLOWLIST_ENVS are the closed lists a manifest may bind to,
    // checked at plugins:gen time.
    const ceilingValues = {
        ROHY_PLUGIN_IMPORT_MAX_BYTES: process.env.ROHY_PLUGIN_IMPORT_MAX_BYTES,
    };
    const out = {};
    Object.entries(manifest.settings.fields).forEach(([key, field]) => {
        if (field.ceilingEnv) {
            const raw = Number(ceilingValues[field.ceilingEnv]);
            // An unset or unparseable ceiling is the field's own max, not zero:
            // a typo'd env var must not silently forbid every legal value.
            if (Number.isInteger(raw) && raw > 0) (out[key] ??= {}).ceiling = raw;
        }
        if (field.allowlistEnv === 'ROHY_PLUGIN_IMPORT_ORIGINS') {
            // The opposite default to a ceiling, and deliberately so: an ABSENT
            // origin allowlist means the operator has permitted nothing, and
            // the safe reading of "nowhere is named" is "nowhere", not "any".
            (out[key] ??= {}).allowedOrigins = importOriginsFor(pluginId);
        }
    });
    return out;
}

/** Shared 404: an unknown plugin and a plugin with no settings slot answer the
 *  same way, so the route does not reveal which plugins are installed. */
function settingsManifest(pluginId) {
    const manifest = MANIFESTS_BY_ID.get(pluginId);
    return manifest && manifest.settings ? manifest : null;
}

router.get('/plugins/:pluginId/settings', authenticateToken, async (req, res) => {
    const { pluginId } = req.params;
    const manifest = settingsManifest(pluginId);
    if (!manifest) {
        return res.status(404).json({ error: 'no such plugin settings', code: 'plugin_settings_unknown' });
    }
    // Per-FIELD role gating, not per-route: the plan's library card is readable
    // by an educator while the import policy above it is admin-only, and those
    // are two audiences for one page. A field with no stated minRole reads as
    // admin — the safe reading of an omission is the strictest one.
    const visible = new Set(visibleSettingKeys(manifest.settings, req.user?.role, roleAllows));
    if (visible.size === 0) {
        return res.status(403).json({ error: 'insufficient role for this plugin\'s settings', code: 'plugin_forbidden' });
    }
    const effective = readSettings(manifest.settings, await storedSettings(tenantId(req), pluginId));
    res.json({
        plugin: pluginId,
        // The schema travels with the values so the client renders from one
        // source of truth rather than a second copy of the field list.
        schema: {
            groups: manifest.settings.groups,
            fields: Object.fromEntries(
                Object.entries(manifest.settings.fields).filter(([key]) => visible.has(key))
            ),
        },
        settings: Object.fromEntries(Object.entries(effective).filter(([key]) => visible.has(key))),
    });
});

router.put('/plugins/:pluginId/settings', authenticateToken, async (req, res) => {
    const { pluginId } = req.params;
    const manifest = settingsManifest(pluginId);
    if (!manifest) {
        return res.status(404).json({ error: 'no such plugin settings', code: 'plugin_settings_unknown' });
    }
    const tenant = tenantId(req);
    const writable = new Set(visibleSettingKeys(manifest.settings, req.user?.role, roleAllows));
    const forbidden = Object.keys(req.body ?? {}).find((key) => !writable.has(key));
    // Checked BEFORE the merge, and reported as 403 rather than 400: an
    // educator naming an admin-only key has made an authorisation mistake, not
    // a validation one, and answering "unknown field" would be a lie that
    // hides the real reason.
    if (forbidden && manifest.settings.fields[forbidden]) {
        return res.status(403).json({
            error: `Setting '${forbidden}' is not writable by your role`,
            code: 'plugin_setting_forbidden',
        });
    }
    const current = await storedSettings(tenant, pluginId);
    const merged = mergeSettings(manifest.settings, current, req.body, hostConstraints(manifest, pluginId));
    if (!merged.ok) {
        // The field is named because an operator staring at a rejected form
        // needs to know WHICH row is wrong, and a generic 400 sends them
        // guessing through four cards.
        return res.status(400).json({
            error: merged.field ? `Setting '${merged.field}' ${merged.message}` : merged.message,
            code: 'plugin_setting_invalid',
            field: merged.field || undefined,
        });
    }
    await dbRun(
        `INSERT INTO plugin_settings (tenant_id, plugin_id, settings, updated_at, updated_by)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT (tenant_id, plugin_id)
         DO UPDATE SET settings = excluded.settings, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`,
        [tenant, pluginId, JSON.stringify(merged.value), req.user?.id ?? null]
    );
    auditSuccess(req, {
        action: 'plugin_settings_update',
        resourceType: 'plugin',
        resourceId: pluginId,
        // The KEYS the caller changed, never the values: an allowlist of hosts
        // is operational detail an audit row should name, but the row is read
        // far more often than it is authorised, so it carries the shape of the
        // change and the settings table carries the change.
        metadata: { keys: Object.keys(req.body ?? {}).sort() },
    });
    req.log?.info('plugin settings updated', { pluginId, keys: Object.keys(req.body ?? {}).length });
    res.json({ plugin: pluginId, settings: merged.value });
});

// The content proxy is a CATCH-ALL under /plugins/:pluginId/, so it lives on its
// own router and routes.js mounts it LAST — after any plugin's own server-slot
// routes. Mounted with the rest, a plugin's `GET /plugins/pathology/jobs/:id`
// would be matched here first and answered as an undeclared content path.
export const pluginContentProxy = express.Router();

pluginContentProxy.get('/plugins/:pluginId/*splat', authenticateToken, requireStudent, proxyLimiter, async (req, res) => {
    const { pluginId } = req.params;
    const manifest = MANIFESTS_BY_ID.get(pluginId);

    // An unknown plugin and an installed plugin that never asked for remote
    // content are the same answer on purpose: this route's existence should not
    // reveal which plugins a deployment has installed.
    if (!manifest || !manifest.remote) {
        return res.status(404).json({ error: 'no such plugin content', code: 'plugin_remote_unknown' });
    }
    // minRole is declared per plugin and, until now, was declared and never
    // enforced anywhere. It is enforced here because this is the first plugin
    // surface the server itself serves.
    if (!roleAllows(req.user?.role, manifest.minRole)) {
        return res.status(403).json({ error: 'insufficient role for this plugin', code: 'plugin_forbidden' });
    }

    const origin = pluginOrigins().get(pluginId);
    if (!origin) {
        return res.status(503).json({
            error: `No remote origin is configured for plugin '${pluginId}'. Set ROHY_PLUGIN_ORIGINS.`,
            code: 'plugin_remote_not_configured',
        });
    }

    const built = buildUpstreamPath(req.params.splat);
    if (!built.ok) {
        return res.status(400).json({ error: `Invalid content path: ${built.reason}`, code: 'plugin_remote_bad_path' });
    }
    if (!pathIsDeclared(built.path, manifest.remote.paths)) {
        return res.status(403).json({
            error: `Plugin '${pluginId}' does not declare '${built.path}' as remote content`,
            code: 'plugin_remote_undeclared_path',
        });
    }

    const target = `${origin}${built.path}`;
    let upstream;
    try {
        upstream = await fetch(target, {
            method: 'GET',
            // See the header comment: following a redirect would let the
            // configured origin hand rohy any other address on the network.
            redirect: 'manual',
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            headers: { accept: manifest.remote.contentTypes.join(', ') },
        });
    } catch (err) {
        // Deliberately not surfaced to the caller: the failure text names the
        // upstream host, and a student's browser is not where a deployment's
        // internal topology should be readable.
        log.warn('plugin upstream fetch failed', { pluginId, path: built.path, error: err.message });
        return res.status(502).json({ error: 'plugin content is unavailable', code: 'plugin_remote_unreachable' });
    }

    if (upstream.status >= 300 && upstream.status < 400) {
        log.warn('plugin upstream returned a redirect, which is not followed', {
            pluginId, path: built.path, status: upstream.status,
        });
        return res.status(502).json({ error: 'plugin content is unavailable', code: 'plugin_remote_redirect' });
    }
    if (!upstream.ok) {
        // 404 and 403 are passed through because they are the author's problem
        // (a wrong slide path) rather than the operator's, and OpenSeadragon
        // renders a missing tile far better than it renders a 502.
        const status = upstream.status === 404 || upstream.status === 403 ? upstream.status : 502;
        return res.status(status).json({ error: 'plugin content is unavailable', code: 'plugin_remote_status' });
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!manifest.remote.contentTypes.includes(contentType)) {
        // Without this, a text/html response from the configured origin would
        // be relayed same-origin from rohy — an HTML injection primitive handed
        // out by a well-meaning image proxy.
        log.warn('plugin upstream returned an undeclared content type', { pluginId, path: built.path, contentType });
        return res.status(502).json({ error: 'plugin content is unavailable', code: 'plugin_remote_content_type' });
    }

    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_BYTES) {
        return res.status(502).json({ error: 'plugin content is too large', code: 'plugin_remote_too_large' });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    // Checked again after reading: a chunked response has no Content-Length to
    // check up front, so the header test above is an early out, not the limit.
    if (buffer.byteLength > MAX_UPSTREAM_BYTES) {
        return res.status(502).json({ error: 'plugin content is too large', code: 'plugin_remote_too_large' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.byteLength));
    // `private` because the response passed a per-user authorisation check and
    // must not be held by a shared cache. Tiles are immutable once published,
    // so a long max-age is what keeps a deep-zoom pan off the network entirely
    // — which matters more for load than any limit set above.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // The upstream is not a trusted source of security policy for rohy's origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
});

export default router;
