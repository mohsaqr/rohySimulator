/**
 * The one way a plugin may pull bytes off the network (RPS-1 1.4).
 *
 * A plugin's server module does not call `fetch`. It calls this, and this
 * enforces the four properties a plugin author would otherwise have to
 * re-implement — and would eventually re-implement wrong:
 *
 *   1. the origin is on the OPERATOR's allowlist, checked again on every
 *      redirect hop, so an on-list host cannot hand rohy an off-list one;
 *   2. the transfer is capped in bytes, checked while streaming and not only
 *      against a Content-Length a server is free to lie about;
 *   3. the destination is inside the caller's own directory, so a crafted
 *      filename cannot write through it;
 *   4. what arrived is digested, so provenance survives the source going away.
 *
 * WHY REDIRECTS ARE FOLLOWED AT ALL, WHEN THE CONTENT PROXY REFUSES THEM
 *
 * `plugins-routes.js` sets `redirect: 'manual'` and treats any 3xx as a failure,
 * because there the upstream is ONE configured origin serving its own tiles and
 * a redirect is a sign something is wrong. Here the operator has allow-listed a
 * set of hosts a human chose, and public slide repositories legitimately
 * redirect between them. So redirects are followed — but each hop is re-checked
 * against the same allowlist, which is the property that matters: the guarantee
 * is not "no redirects", it is "never a byte from a host the operator did not
 * name". A redirect to 169.254.169.254 fails the allowlist like any other host.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fetchWithTimeout } from '../services/fetchWithTimeout.js';
import { logger } from '../logger.js';

const log = logger('plugin-fetch');

const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 60_000;

/** A refusal a caller can branch on, and a route can map to a status. */
export class PluginFetchError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'PluginFetchError';
        this.code = code;
    }
}

/**
 * Is `child` inside `root`? Ported from the asset service's `containedPath`.
 *
 * Compares RESOLVED paths with a trailing separator. Without the separator,
 * `/library/a2` reads as being inside `/library/a` — a prefix match is not a
 * containment check, and that is the classic spelling of this bug.
 *
 * @param {string} root
 * @param {string} child
 * @returns {boolean}
 */
export function containedPath(root, child) {
    const r = resolve(root);
    const c = resolve(child);
    return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * Validate a URL for download.
 *
 * @param {string}   raw
 * @param {string[]} allowedOrigins
 * @returns {URL}
 * @throws {PluginFetchError}
 */
export function validateHttpUrl(raw, allowedOrigins) {
    let url;
    try {
        url = new URL(String(raw));
    } catch {
        throw new PluginFetchError(`'${raw}' is not a URL`, 'plugin_import_bad_url');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new PluginFetchError(`'${url.protocol}' is not a supported scheme`, 'plugin_import_bad_scheme');
    }
    // Credentials in a URL would be written into the job payload, the audit row
    // and the asset's provenance. There is no way to store this safely, so it is
    // refused rather than stripped — stripping would silently change what the
    // author asked for and then fail with a confusing 401.
    if (url.username || url.password) {
        throw new PluginFetchError('a URL carrying credentials is not supported', 'plugin_import_credentials');
    }
    if (!allowedOrigins.includes(url.origin)) {
        throw new PluginFetchError(
            allowedOrigins.length === 0
                ? 'this deployment allows no import origins for this plugin'
                : `'${url.origin}' is not an allowed import origin`,
            'plugin_import_forbidden_origin'
        );
    }
    return url;
}

/**
 * Download a URL to a file, enforcing every property in the header.
 *
 * @param {object}   spec
 * @param {string}   spec.url             the source
 * @param {string}   spec.destPath        absolute path to write
 * @param {string}   spec.rootDir         the directory destPath must be inside
 * @param {string[]} spec.allowedOrigins  the operator's list, already narrowed
 * @param {number}   spec.maxBytes
 * @param {number}   [spec.timeoutMs]
 * @param {function} [spec.onProgress]    (bytes, totalOrNull) => void
 * @returns {Promise<{bytes: number, sha256: string, contentType: string, finalUrl: string}>}
 * @throws  {PluginFetchError}
 */
export async function downloadToFile({
    url, destPath, rootDir, allowedOrigins, maxBytes,
    timeoutMs = DEFAULT_TIMEOUT_MS, onProgress = null,
}) {
    if (!containedPath(rootDir, destPath)) {
        // Not a caller mistake to tolerate: a destination outside the plugin's
        // own directory means a path was built from something untrusted.
        throw new PluginFetchError('refusing to write outside the plugin library directory', 'plugin_import_path_escape');
    }
    let current = validateHttpUrl(url, allowedOrigins);
    let response;
    for (let hop = 0; ; hop += 1) {
        response = await fetchWithTimeout(current.toString(), {
            method: 'GET',
            redirect: 'manual',
            headers: { accept: '*/*' },
        }, { timeoutMs });
        if (response.status < 300 || response.status >= 400) break;
        if (hop >= MAX_REDIRECTS) {
            throw new PluginFetchError(`too many redirects (${MAX_REDIRECTS})`, 'plugin_import_redirect_loop');
        }
        const location = response.headers.get('location');
        if (!location) {
            throw new PluginFetchError('upstream sent a redirect with no Location', 'plugin_import_bad_redirect');
        }
        // Re-validated against the SAME allowlist. This is the line that keeps
        // an allow-listed host from becoming a redirector into the network.
        current = validateHttpUrl(new URL(location, current).toString(), allowedOrigins);
    }

    if (!response.ok) {
        throw new PluginFetchError(`upstream answered ${response.status}`, 'plugin_import_upstream_status');
    }
    const declared = Number(response.headers.get('content-length'));
    // An early out only. A server may omit it or lie; the streaming check below
    // is the actual limit.
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new PluginFetchError(`source is ${declared} bytes, over the ${maxBytes} limit`, 'plugin_import_too_large');
    }
    if (!response.body) {
        throw new PluginFetchError('upstream sent no body', 'plugin_import_empty');
    }

    await mkdir(dirname(destPath), { recursive: true });
    const hash = createHash('sha256');
    let bytes = 0;
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;

    async function* metered(source) {
        for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > maxBytes) {
                throw new PluginFetchError(`source exceeded the ${maxBytes} byte limit`, 'plugin_import_too_large');
            }
            hash.update(chunk);
            if (onProgress) onProgress(bytes, total);
            yield chunk;
        }
    }

    try {
        await pipeline(metered(Readable.fromWeb(response.body)), createWriteStream(destPath));
    } catch (err) {
        // A partial file is worse than none: it looks like a slide to everything
        // downstream. Remove it and let the caller see the real reason.
        await rm(destPath, { force: true });
        if (err instanceof PluginFetchError) throw err;
        throw new PluginFetchError(`download failed: ${err.message}`, 'plugin_import_transfer_failed');
    }

    const written = await stat(destPath);
    log.info('plugin import downloaded', {
        origin: current.origin, bytes: written.size, dest: destPath,
    });
    return {
        bytes: written.size,
        sha256: hash.digest('hex'),
        contentType: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
        finalUrl: current.toString(),
    };
}
