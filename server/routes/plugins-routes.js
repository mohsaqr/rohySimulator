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
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import rateLimit from 'express-rate-limit';
// Plugin settings were exempt from every limiter (security audit 2026-10-26,
// L8-15): routes.js skips /plugins/ in the general limiter for deep-zoom.
import { pluginSettingsLimiter } from '../lib/routeLimiters.js';
import { authenticateToken, requireStudent } from '../middleware/auth.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { roleAllows } from '../shared/pluginRegistry.js';
import { pluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { originRequestHeaders } from '../lib/pluginOriginTokens.js';
import { readSettings, mergeSettings, visibleSettingKeys } from '../shared/pluginSettings.js';

import { importOriginsFor } from '../lib/pluginImportOrigins.js';
import { libraryDirs } from '../lib/pluginServerSlot.js';
import { tenantId, auditSuccess, dbGet, dbRun, dbAll } from './_helpers.js';
import { logger } from '../logger.js';
import { contentPath, isRecordedContentPath, recordContentRead } from '../services/pluginContentReads.js';
import { opaqueArchiveId, opaqueRemoteRefs, openOpaqueSegments } from '../lib/pluginOpaqueRefs.js';

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

/**
 * Read an upstream response without ever buffering more than the declared cap.
 * `Response.arrayBuffer()` cannot enforce a limit while bytes arrive: a
 * chunked origin can exhaust the process before a post-read size check runs.
 */
export async function readUpstreamBody(response, maxBytes = MAX_UPSTREAM_BYTES) {
    if (!response.body) return { ok: true, buffer: Buffer.alloc(0) };
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                try { await reader.cancel('plugin response exceeded byte limit'); } catch { /* already closed */ }
                return { ok: false, buffer: null };
            }
            chunks.push(Buffer.from(value));
        }
        return { ok: true, buffer: Buffer.concat(chunks, total) };
    } finally {
        reader.releaseLock();
    }
}

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

/**
 * The catalog shape a plugin declares (`manifest.catalog`), with pathology's
 * original shape as the default.
 *
 * The route used to know one plugin's vocabulary by heart — a `{assets: […]}`
 * collection whose references live in `url` fields — which is fine while there
 * is one plugin and wrong the moment there are two. Radoyon's archive is
 * `{entries: […]}` with references in `ref`, and it was rejected as malformed
 * by a guard that was only ever describing pathology. The defaults keep the
 * pathology manifest working unchanged.
 *
 * @param {object} manifest
 * @returns {{collection: string, refFields: string[], learnerKeys: string[]|null}}
 */
function catalogShape(manifest) {
    const declared = manifest.catalog ?? {};
    return {
        collection: declared.collection ?? 'assets',
        refFields: declared.refFields ?? ['url'],
        // Absent means a learner gets nothing at all, which is the safe
        // reading of a plugin that has not thought about it.
        learnerKeys: Array.isArray(declared.learnerKeys) ? declared.learnerKeys : null,
    };
}

/**
 * The bundle half of a plugin's library, from its content origin.
 *
 * Returns a result rather than writing a response, because the caller now has
 * a second source and must decide what an unavailable bundle means.
 *
 * @param {string} origin
 * @param {string} pluginId
 * @param {{collection: string, refFields: string[]}} shape
 * @returns {Promise<{ok: true, catalog: object}|{ok: false, error: string, code: string}>}
 */
/**
 * The STARTER content a deployment gets before anyone configures an origin.
 *
 * `ROHY_PLUGIN_ORIGINS` names where a deployment's own imaging lives, and
 * until it is set every plugin room is empty and says so by naming an
 * environment variable at an educator who cannot set it. That is the honest
 * answer to "where are the pixels" and a useless one to the person reading it:
 * there is no public host to point the variable at, because an origin is
 * something you BUILD from a licence-audited archive.
 *
 * So rohy ships a small one. It is real, licence-audited imaging — CC0, CC BY
 * and CC BY-SA entries that `redistributableEntries()` already passes — not a
 * phantom, because the archive was audited precisely so that it could ship.
 *
 * Served from disk rather than fetched: these are rohy's own files, so no host
 * is contacted, `normalizeOrigin()` is not involved, and the SSRF surface the
 * proxy exists to bound is untouched. A configured origin always wins — the
 * starter is what a deployment has INSTEAD of one, never as well.
 *
 * It lives under `server/` because the Docker runtime stage copies that whole
 * directory. The lab catalogue learned this the hard way from the repo root.
 */
const DEFAULT_STARTER_ROOT = resolve(fileURLToPath(new URL('../plugin-content', import.meta.url)));

/**
 * Where the starter bundles live.
 *
 * Overridable because the bundles are not part of the source tree — they are
 * gigabytes, generated by `npm run setup:content`, and gitignored. A container
 * therefore wants them on a mounted volume rather than baked into the image,
 * and a test wants a small fixture rather than whatever happens to be on the
 * machine. Both are the same need: the content's location is deployment
 * configuration, not a compiled-in path.
 */
function starterRoot() {
    const override = process.env.ROHY_STARTER_CONTENT_DIR;
    return override ? resolve(override) : DEFAULT_STARTER_ROOT;
}

/** The starter directory for a plugin, or null. Cached: this is on the hot path. */
const starterDirs = new Map();
export function starterContentDir(pluginId) {
    // An operator may refuse the samples outright. Some deployments must show
    // only their own material — a hospital where an unrelated teaching image
    // appearing in a reading room is a governance problem, not a convenience.
    // Read per call rather than cached, so a test can set it per server.
    if (String(process.env.ROHY_STARTER_CONTENT ?? '').toLowerCase() === 'off') return null;
    const root = starterRoot();
    const key = `${root}\u0000${pluginId}`;
    if (!starterDirs.has(key)) {
        // The plugin id is already `[a-z][a-z0-9_]*` by manifest validation, so
        // it cannot traverse; resolving and re-checking the prefix anyway costs
        // nothing and means one changed assumption cannot become a path escape.
        const dir = resolve(join(root, pluginId));
        const inside = dir === root || dir.startsWith(root + sep);
        starterDirs.set(key, inside && existsSync(join(dir, 'content.json')) ? dir : null);
    }
    return starterDirs.get(key);
}

/** Read the starter bundle's catalogue, in the shape fetchBundleCatalog returns. */
function readStarterCatalog(dir, shape) {
    const file = join(dir, 'catalog.json');
    if (!existsSync(file)) {
        return { ok: false, status: 404, error: 'this content origin ships no catalog', code: 'plugin_catalog_missing' };
    }
    let catalog;
    try { catalog = JSON.parse(readFileSync(file, 'utf8')); } catch {
        return { ok: false, status: 502, error: 'plugin catalog is not JSON', code: 'plugin_catalog_invalid' };
    }
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog[shape.collection])) {
        return { ok: false, status: 502, error: 'plugin catalog is malformed', code: 'plugin_catalog_invalid' };
    }
    return { ok: true, catalog };
}

/**
 * Serve one file from a directory on this host: the starter bundle or the
 * managed library.
 *
 * `built.path` has already been parsed and checked against the manifest's
 * declared prefixes by the caller. This resolves it and checks CONTAINMENT
 * anyway: two independent reasons a traversal cannot succeed is the right
 * number for a route that turns a URL into a file read.
 */
/**
 * The Content-Type a local content file is served as, by extension, or null
 * for an extension no plugin content has. A file with an unknown extension is
 * refused rather than served as an image: it used to go out as `image/jpeg`,
 * which is how a slide's multi-gigabyte `source/` original or a `.webp` gross
 * photo was labelled (security audit 2026-10-26, L4-06 / I-4).
 */
const LOCAL_CONTENT_TYPES = Object.freeze({
    '.json': 'application/json',
    '.dzi': 'application/xml',
    '.xml': 'application/xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.dcm': 'application/dicom',
});

export function localContentType(contentPath) {
    const match = /\.[A-Za-z0-9]+$/.exec(String(contentPath));
    return match ? (LOCAL_CONTENT_TYPES[match[0].toLowerCase()] ?? null) : null;
}

function serveLocalFile(res, dir, contentPath, manifest, pluginId) {
    const target = resolve(join(dir, normalize(contentPath).replace(/^[/\\]+/, '')));
    if (target !== dir && !target.startsWith(dir + sep)) {
        log.warn('local plugin content path escaped its directory', { pluginId, contentPath });
        return res.status(403).json({ error: 'forbidden', code: 'plugin_remote_bad_path' });
    }
    let stat;
    try { stat = statSync(target); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
        return res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' });
    }
    // A symlink inside the content root must not reach outside it. The
    // bundles are unpacked with system tar (sha256-pinned, so this is supply
    // chain only), and a link planted in one would otherwise turn a content
    // URL into a read of any file the server can open.
    let realTarget;
    let realDir;
    try {
        realTarget = realpathSync(target);
        realDir = realpathSync(dir);
    } catch {
        return res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' });
    }
    if (realTarget !== realDir && !realTarget.startsWith(realDir + sep)) {
        log.warn('local plugin content resolved outside its directory', { pluginId, contentPath });
        return res.status(403).json({ error: 'forbidden', code: 'plugin_remote_bad_path' });
    }

    const type = localContentType(contentPath);
    if (!type || !manifest.remote.contentTypes.includes(type)) {
        // The manifest lists what this plugin's content may BE. A bundle file
        // outside that list is a packaging error, not something to serve.
        log.warn('local plugin content type is not declared by the manifest', { pluginId, contentPath, type });
        return res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' });
    }

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(stat.size));
    // A tile is immutable by construction — its bytes are named by the pyramid
    // level and position of a fixed image. The catalogue is not.
    // A slide descriptor is fetched again on every open: the server records the
    // read (services/pluginContentReads.js), and a cached descriptor would
    // leave a second learner on the same browser unrecorded.
    res.setHeader('Cache-Control', contentPath.endsWith('.json')
        ? 'no-cache'
        : isRecordedContentPath(contentPath) ? 'private, no-cache'
            : 'public, max-age=31536000, immutable');
    const stream = createReadStream(target);
    stream.once('error', (err) => {
        // The bundle can be replaced between stat() and open(). A stream error
        // without a listener is process-fatal; turn that race into one failed
        // request while the atomically staged replacement becomes visible.
        log.warn('local plugin content stream failed', { pluginId, contentPath, error: err.message });
        if (!res.headersSent) {
            res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' });
        } else {
            res.destroy(err);
        }
    });
    stream.pipe(res);
    return res;
}

async function fetchBundleCatalog(origin, pluginId, shape) {
    let upstream;
    try {
        upstream = await fetch(`${origin}/catalog.json`, {
            method: 'GET', redirect: 'manual',
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            // rohy's own credential for this origin, not the caller's. See
            // pluginOriginTokens.js: two separate authorisations, and the
            // learner's is not the one that travels upstream.
            headers: originRequestHeaders(pluginId, { accept: 'application/json' }),
        });
    } catch (err) {
        log.warn('plugin catalog fetch failed', { pluginId, error: err.message });
        return { ok: false, status: 502, error: 'plugin catalog is unavailable', code: 'plugin_remote_unreachable' };
    }
    if (upstream.status === 404) {
        return { ok: false, status: 404, error: 'this content origin ships no catalog', code: 'plugin_catalog_missing' };
    }
    if (!upstream.ok) {
        return { ok: false, status: 502, error: 'plugin catalog is unavailable', code: 'plugin_remote_status' };
    }
    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > CATALOG_MAX_BYTES) {
        return { ok: false, status: 502, error: 'plugin catalog is too large', code: 'plugin_remote_too_large' };
    }
    const text = await upstream.text();
    if (Buffer.byteLength(text, 'utf8') > CATALOG_MAX_BYTES) {
        return { ok: false, status: 502, error: 'plugin catalog is too large', code: 'plugin_remote_too_large' };
    }
    let catalog;
    try { catalog = JSON.parse(text); } catch {
        return { ok: false, status: 502, error: 'plugin catalog is not JSON', code: 'plugin_catalog_invalid' };
    }
    if (!catalog || typeof catalog !== 'object' || catalog.version !== 1
        || !Array.isArray(catalog[shape.collection])) {
        return { ok: false, status: 502, error: 'plugin catalog has an unexpected shape', code: 'plugin_catalog_invalid' };
    }
    // Every reference must point INTO this plugin's declared paths. A catalog
    // that points elsewhere is the origin operator's mistake, and an author who
    // added such an entry would get a case the guard then rejects.
    //
    // Built from the manifest's field names rather than hardcoding 'url', and
    // escaped-quote-aware ((?:[^"\\]|\\.)*) because a JSON string may contain
    // an escaped quote and a naive [^"]* would stop early and pass a value it
    // never actually read.
    const refPattern = new RegExp(
        `"(?:${shape.refFields.join('|')})":\\s*"(?!remote:)(?:[^"\\\\]|\\\\.)*"`,
    );
    if (refPattern.test(JSON.stringify(catalog))) {
        return { ok: false, status: 502, error: 'plugin catalog carries a reference that is not a remote: reference', code: 'plugin_catalog_invalid' };
    }
    return { ok: true, catalog };
}

/**
 * One catalog item, reduced to the keys a plugin says a learner may read.
 *
 * An allowlist, applied at the top level of each item only: a plugin declares
 * the fields it is willing to expose, and anything a future package version
 * adds is absent until someone decides otherwise. The alternative — stripping
 * named fields — fails open every time upstream adds one, which for this
 * particular catalog means shipping the pathology library's labels to the
 * person being assessed on finding them.
 *
 * @param {object} item
 * @param {string[]} keys
 * @returns {object}
 */
function learnerItem(item, keys) {
    if (!item || typeof item !== 'object') return {};
    return Object.fromEntries(
        keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]),
    );
}

/**
 * What a learner may read of an object nested inside an allowed key (PACS:
 * one `series[]` element) — the fields a viewer needs to lay the images out,
 * plus the plugin's reference fields. Never `description`: a series is
 * described in the words of its finding ("AXIAL CHEST — RUL NODULE").
 */
const LEARNER_NESTED_KEYS = Object.freeze(['key', 'plane', 'instances', 'frames', 'geometry']);

/**
 * Radoyon's archive convention: an entry whose id starts with this is an
 * abnormal example, and its normal-study lookup (`studyForOrder()`,
 * src/components/pacs/caseDocument.js) skips it by that prefix. A sealed id no
 * longer shows the prefix, so the learner projection withholds the entry's
 * `studyId` instead — the one field that lookup matches on — and a plain order
 * still never opens an abnormal study the case did not choose.
 */
const ABNORMAL_ENTRY_PREFIX = 'abnormal/';

/**
 * One catalog item as a LEARNER receives it (security audit 2026-10-26, F-25).
 *
 * The key allowlist above was not enough on its own: the allowed `id` is the
 * bundle path (`abnormal/rul_nodule`), and the allowed `series[]` carried its
 * own `description` and a `ref` repeating the path. So, for a learner:
 *   - `id` is sealed (lib/pluginOpaqueRefs.js) — the case document's archive
 *     baseline is sealed the same way, so the two still match;
 *   - `label` is present and empty, so a host that falls back from a missing
 *     label to the id shows nothing rather than a token;
 *   - nested objects keep only LEARNER_NESTED_KEYS and the reference fields;
 *   - every `remote:` reference is sealed, so the content URLs the browser
 *     then loads carry no name either.
 *
 * @param {string} pluginId
 * @param {object} item
 * @param {{learnerKeys: string[], refFields: string[]}} shape
 * @returns {object}
 */
function learnerCatalogItem(pluginId, item, shape) {
    const base = learnerItem(item, shape.learnerKeys);
    const nestedKeys = [...LEARNER_NESTED_KEYS, ...shape.refFields];
    const projected = Object.fromEntries(Object.entries(base).map(([key, value]) => [
        key,
        Array.isArray(value)
            ? value.map((element) => (element && typeof element === 'object' && !Array.isArray(element)
                ? learnerItem(element, nestedKeys)
                : element))
            : value,
    ]));
    if (typeof item?.id === 'string' && Object.hasOwn(projected, 'id')) {
        projected.id = opaqueArchiveId(pluginId, item.id);
        projected.label = '';
        if (item.id.startsWith(ABNORMAL_ENTRY_PREFIX)) delete projected.studyId;
    }
    return opaqueRemoteRefs(pluginId, projected);
}

/**
 * The READY managed slides for this tenant.
 *
 * A failed read degrades to "no managed slides" so the bundled half of the
 * library is still offered — but it is SAID, at warn, with the request id:
 * silently empty was indistinguishable from a tenant that imported nothing.
 */
async function managedAssets(pluginId, tenant, reqLog = log) {
    try {
        return await dbAll(
            `SELECT id, label, native_objective, native_mpp_x, tiled_objective, width, height
               FROM plugin_assets
              WHERE plugin_id = ? AND tenant_id = ? AND state = 'ready'
              ORDER BY created_at DESC`,
            [pluginId, tenant]
        );
    } catch (err) {
        reqLog.warn('managed assets could not be read; offering the bundled library only', {
            pluginId, tenant_id: tenant, error: err.message,
        });
        return [];
    }
}

/**
 * Managed rows in the package's own catalog shape.
 *
 * Only 'ready' ones reach here. A slide still importing, failed, or awaiting
 * calibration is real but not usable, and offering it would let an author build
 * a case around a slide whose scale is unknown. The editor sees those through
 * the plugin's own /assets instead.
 */
function managedCatalogEntries(rows) {
    return rows.map((row) => managedCatalogEntry(row));
}

/**
 * Optics in the shape the pathology package's catalog validator requires
 * (assetCatalog.js verifiedOptics): `downsample` is the archive's factor from
 * level 0 — native objective over the objective it was tiled at — and the
 * slide dimensions are LEVEL-0 pixels, the archive's times that factor.
 * Without `downsample` the editor refused every imported slide ("optics
 * .downsample must be a finite positive number"). `tiledObjective` stays for
 * anything already reading it.
 */
function managedOptics(row) {
    const downsample = row.tiled_objective ? row.native_objective / row.tiled_objective : 1;
    return {
        nativeObjective: row.native_objective,
        nativeMpp: row.native_mpp_x,
        tiledObjective: row.tiled_objective,
        downsample,
        ...(row.width && row.height
            ? { slideWidthPx: Math.round(row.width * downsample), slideHeightPx: Math.round(row.height * downsample) }
            : {}),
    };
}

function managedCatalogEntry(row) {
    return {
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
            optics: managedOptics(row),
            widthPx: row.width,
            heightPx: row.height,
        }],
    };
}

router.get('/plugins/:pluginId/catalog', authenticateToken, proxyLimiter, async (req, res) => {
    const { pluginId } = req.params;
    const manifest = MANIFESTS_BY_ID.get(pluginId);
    // No editor → no catalog; same shape as an unknown plugin so the route
    // does not reveal which plugins are installed.
    if (!manifest || !manifest.remote || !manifest.authoring) {
        return res.status(404).json({ error: 'no such plugin catalog', code: 'plugin_catalog_unknown' });
    }
    const shape = catalogShape(manifest);
    // Two audiences, and the difference is what a case can be spoiled by.
    //
    // An AUTHOR gets the catalog as it stands. A LEARNER gets it only if the
    // plugin declared what they may see, and then only those fields — because
    // a case entry may name an archive id that only the host can resolve into
    // something a viewer can open, while the same catalog also names the
    // pathology library the case is built from. Serving the whole thing would
    // hand over the answer; serving nothing would leave the study unopenable.
    const mayAuthor = roleAllows(req.user?.role, manifest.authoring.minRole);
    const mayRead = shape.learnerKeys !== null && roleAllows(req.user?.role, manifest.minRole);
    if (!mayAuthor && !mayRead) {
        return res.status(403).json({ error: 'insufficient role for this plugin\'s catalog', code: 'plugin_forbidden' });
    }

    // The library has two independent halves and they fail independently.
    //
    // Until 1.4 this route answered 503 the moment no content ORIGIN was
    // configured, because the bundle was the only source there was. With a
    // managed half that is wrong: a deployment that imports its own slides and
    // ships no content bundle would have an invisible library — the slides are
    // on disk, in the database, and the editor is told the plugin has no
    // catalog. So the bundle is fetched when an origin exists, its absence is
    // recorded rather than returned, and 503 is reserved for having genuinely
    // nothing to show.
    //
    // The managed half is asset-shaped by construction (managedCatalogEntries
    // below builds pathology's rows), so it is only queried for a plugin whose
    // catalog IS that collection. A plugin with another shape has no managed
    // half — an imported slide is not an entry in an imaging archive — and
    // merging one in would put a foreign row into its library.
    const managed = shape.collection === 'assets' ? await managedAssets(pluginId, tenantId(req), req.log || log) : [];
    const origin = pluginOrigins().get(pluginId);
    // A configured origin always wins; the starter bundle is what a deployment
    // has INSTEAD of one, never as well as one. Otherwise an operator who
    // pointed rohy at their own archive would still be served rohy's samples.
    const starter = origin ? null : starterContentDir(pluginId);
    let catalog = { schemaVersion: '1.0.0', version: 1, [shape.collection]: [] };
    let bundleUnavailable = (origin || starter)
        ? null
        // ISSUE-0025, second call site. The content proxy below was reworded in
        // beta.37 but this one — the route a plugin ROOM calls first, so the one
        // an operator actually meets — still named only ROHY_PLUGIN_ORIGINS,
        // sending them after a variable they did not need while the learner sat
        // in an empty workstation. Installing the bundled starter content is the
        // ordinary route and is named first. Keep the two messages in step.
        : {
            status: 503,
            error: `Plugin '${pluginId}' has no content on this deployment. `
                + 'Install the bundled starter content with `npm run setup:content`, '
                + 'or point the plugin at a remote origin with ROHY_PLUGIN_ORIGINS.',
            code: 'plugin_remote_not_configured',
        };

    if (origin) {
        const bundle = await fetchBundleCatalog(origin, pluginId, shape);
        if (bundle.ok) catalog = bundle.catalog;
        else bundleUnavailable = bundle;
    } else if (starter) {
        const bundle = readStarterCatalog(starter, shape);
        if (bundle.ok) catalog = bundle.catalog;
        else bundleUnavailable = bundle;
    }
    if (bundleUnavailable && managed.length === 0) {
        // Nothing from either half — report the operator state, as before.
        // The SAME status the route answered before 1.4 — an operator reading
        // "404 plugin_catalog_missing" should not have it silently become a 502
        // because the library grew a second half.
        return res.status(bundleUnavailable.status)
            .json({ error: bundleUnavailable.error, code: bundleUnavailable.code });
    }

    const items = [...managedCatalogEntries(managed), ...(catalog[shape.collection] ?? [])];
    catalog[shape.collection] = mayAuthor
        ? items
        : items.map((item) => learnerCatalogItem(pluginId, item, shape));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({
        plugin: pluginId,
        catalog,
        // Named so the editor can say "your imported slides are here, the
        // bundled ones are not" instead of showing a short list as if complete.
        ...(bundleUnavailable ? { bundleUnavailable: bundleUnavailable.code } : {}),
    });
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

router.get('/plugins/:pluginId/settings', authenticateToken, pluginSettingsLimiter, async (req, res) => {
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

router.put('/plugins/:pluginId/settings', authenticateToken, pluginSettingsLimiter, async (req, res) => {
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

/** Express 5's wildcard as an array of decoded segments. */
function splatSegments(splat) {
    return Array.isArray(splat) ? splat : (splat ? [splat] : []);
}

// The files that ARE a managed slide — the same layout casePackage.js carries
// (LIBRARY_FILE_RE there). `source/` originals and anything else in the asset
// directory are not content.
const LIBRARY_FILE_RE = /^(slide\.dzi|preview\.jpg|gross\.(jpe?g|png|webp)|slide_files\/\d{1,2}\/\d{1,6}_\d{1,6}\.(jpe?g|png|webp))$/;
// An asset directory name. No dot, so an import's `.<id>.importing-…` staging
// directory never matches.
const LIBRARY_ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// asset id → owning tenant (or null for a directory with no row). A deep-zoom
// pan is hundreds of tile requests for one asset in seconds, so the row is
// read once a minute, not once a tile. Bounded: the map is cleared when full.
const LIBRARY_TENANT_TTL_MS = 60_000;
const LIBRARY_TENANT_CACHE_MAX = 2000;
const libraryTenants = new Map();

async function libraryAssetTenant(pluginId, assetId) {
    const key = `${pluginId}\u0000${assetId}`;
    const hit = libraryTenants.get(key);
    if (hit && hit.expires > Date.now()) return hit.tenant;
    const row = await dbGet('SELECT tenant_id FROM plugin_assets WHERE id = ? AND plugin_id = ?', [assetId, pluginId]);
    if (libraryTenants.size >= LIBRARY_TENANT_CACHE_MAX) libraryTenants.clear();
    const tenant = row ? Number(row.tenant_id) : null;
    libraryTenants.set(key, { tenant, expires: Date.now() + LIBRARY_TENANT_TTL_MS });
    return tenant;
}

/** Test seam: forget the cached asset owners. */
export function resetLibraryTenantCache() { libraryTenants.clear(); }

/**
 * Why a managed-library file must not be served to this caller, or null.
 *
 * A directory with no plugin_assets row is served as before (a library
 * written before rows carried every asset, and test fixtures, have none);
 * a row that names ANOTHER tenant is refused with the same 404 as a missing
 * file, so an id probe learns nothing.
 *
 * @param {string} pluginId
 * @param {string} local   `/<assetId>/<file…>`
 * @param {number} tenant  the caller's tenant
 * @returns {Promise<string|null>} a refusal code
 */
async function libraryRefusal(pluginId, local, tenant, reqLog) {
    const [assetId, ...rest] = local.replace(/^\/+/, '').split('/');
    if (!LIBRARY_ASSET_RE.test(assetId ?? '') || !LIBRARY_FILE_RE.test(rest.join('/'))) {
        return 'plugin_remote_not_found';
    }
    let owner;
    try {
        owner = await libraryAssetTenant(pluginId, assetId);
    } catch (err) {
        // Fail closed: an unreadable owner must not serve another tenant's slide.
        reqLog.error('library asset owner could not be read', { pluginId, error: err.message });
        return 'plugin_remote_not_found';
    }
    if (owner !== null && owner !== Number(tenant)) return 'plugin_remote_not_found';
    return null;
}

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
    const starter = origin ? null : starterContentDir(pluginId);
    // The managed library is rohy's own: rohy writes it (slide imports, case
    // packages), so rohy serves it, whether or not this deployment also has a
    // content bundle or an origin. It used to be reachable only through one of
    // those, so a deployment with a library and no bundle (every Docker
    // install) imported slides it could not show.
    const library = libraryDirs().get(pluginId) ?? null;
    const noContent = () => res.status(503).json({
        // ISSUE-0025: bundled starter content is the ordinary way this
        // deployment gets imaging (`npm run setup:content`, INSTALL.md);
        // a remote origin is the alternative. Naming only the alternative
        // sent operators hunting for a variable they did not need, while
        // learners saw an empty PACS workstation.
        error: `Plugin '${pluginId}' has no content on this deployment. `
            + 'Install the bundled starter content with `npm run setup:content`, '
            + 'or point the plugin at a remote origin with ROHY_PLUGIN_ORIGINS.',
        code: 'plugin_remote_not_configured',
    });
    if (!origin && !starter && !library) return noContent();

    // A learner's references arrive SEALED (lib/pluginOpaqueRefs.js, F-25):
    // `/_o/<token>…` names no finding. Opened here, before anything else
    // looks at the path, so every check below — segment parsing, declared
    // prefixes, the library's tenant, the read record — runs on the real path
    // exactly as it would for an author's unsealed request.
    const opened = openOpaqueSegments(pluginId, splatSegments(req.params.splat));
    if (opened.opaque && !opened.segments) {
        return res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' });
    }
    const segments = opened.opaque ? opened.segments : req.params.splat;
    const built = buildUpstreamPath(segments);
    if (!built.ok) {
        return res.status(400).json({ error: `Invalid content path: ${built.reason}`, code: 'plugin_remote_bad_path' });
    }
    if (!pathIsDeclared(built.path, manifest.remote.paths)) {
        return res.status(403).json({
            error: `Plugin '${pluginId}' does not declare '${built.path}' as remote content`,
            code: 'plugin_remote_undeclared_path',
        });
    }

    // A slide descriptor the user's browser loaded is recorded once it has been
    // served: the course gate's "every slide opened" counts these reads, which
    // the browser cannot post for itself.
    if (isRecordedContentPath(built.path)) {
        const read = { tenantId: tenantId(req), userId: req.user.id, pluginId, path: contentPath(segments) };
        res.on('finish', () => {
            if (res.statusCode !== 200) return;
            recordContentRead(read).catch((err) => log.warn('plugin content read not recorded', { pluginId, error: err.message }));
        });
    }

    // The SAME path has now passed the SAME two gates it would have passed on
    // its way to a remote origin — parsed and confirmed declared — before
    // anything touches the filesystem. Reversing that order is how a content
    // route becomes a file-read primitive.
    if (library && built.path.startsWith('/library/')) {
        // Served from disk when the file is here; otherwise the bundle or the
        // origin answers as before, so a library an origin already serves keeps
        // working unchanged.
        const root = resolve(library);
        const local = built.path.slice('/library'.length);
        if (existsSync(resolve(join(root, normalize(local).replace(/^[/\\]+/, ''))))) {
            // The managed library is per tenant (plugin_assets.tenant_id), and
            // it holds more than the slide: `source/` keeps the original when
            // imports.keepOriginal is on, and an import stages into a
            // `.<id>.importing-…` directory beside the finished ones. Only the
            // slide's own layout is content, and only the owning tenant's
            // (security audit 2026-10-26, L4-06).
            const refusal = await libraryRefusal(pluginId, local, tenantId(req), req.log || log);
            if (refusal) return res.status(404).json({ error: 'not found', code: refusal });
            return serveLocalFile(res, root, local, manifest, pluginId);
        }
    }
    if (starter) return serveLocalFile(res, starter, built.path, manifest, pluginId);
    if (!origin) {
        // Only the library is here: a library file it lacks is simply absent,
        // anything else is content this deployment was never given.
        return built.path.startsWith('/library/')
            ? res.status(404).json({ error: 'not found', code: 'plugin_remote_not_found' })
            : noContent();
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
            headers: originRequestHeaders(pluginId, { accept: manifest.remote.contentTypes.join(', ') }),
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
    if (upstream.status === 401) {
        // The origin refused rohy, not the learner. Distinguished from 403
        // below because the fix is entirely different: a wrong or missing
        // ROHY_PLUGIN_ORIGIN_TOKENS entry, not a wrong slide path. Logged for
        // the operator; the learner is told only that content is unavailable.
        log.warn('plugin origin rejected our credential', { pluginId, path: built.path });
        return res.status(502).json({ error: 'plugin content is unavailable', code: 'plugin_remote_unauthorized' });
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
        try { await upstream.body?.cancel(); } catch { /* body already closed */ }
        return res.status(502).json({ error: 'plugin content is too large', code: 'plugin_remote_too_large' });
    }

    let body;
    try {
        body = await readUpstreamBody(upstream);
    } catch (err) {
        log.warn('plugin upstream body failed', { pluginId, path: built.path, error: err.message });
        return res.status(502).json({ error: 'plugin content is unavailable', code: 'plugin_remote_unreachable' });
    }
    if (!body.ok) {
        return res.status(502).json({ error: 'plugin content is too large', code: 'plugin_remote_too_large' });
    }
    const { buffer } = body;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.byteLength));
    // `private` because the response passed a per-user authorisation check and
    // must not be held by a shared cache. Tiles are immutable once published,
    // so a long max-age is what keeps a deep-zoom pan off the network entirely
    // — which matters more for load than any limit set above.
    res.setHeader('Cache-Control', isRecordedContentPath(built.path) ? 'private, no-cache' : 'private, max-age=86400');
    // The upstream is not a trusted source of security policy for rohy's origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
});

export default router;
