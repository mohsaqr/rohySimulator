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

router.get('/plugins/:pluginId/*splat', authenticateToken, requireStudent, proxyLimiter, async (req, res) => {
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
