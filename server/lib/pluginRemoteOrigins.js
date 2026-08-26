/**
 * Where a plugin's remote content is allowed to come from.
 *
 * This module exists to keep one sentence true: **a case author picks a path,
 * an operator picks a host.** rohy has already paid for the alternative once —
 * `proxy-routes.js` accepts and then deliberately IGNORES a client-supplied
 * `endpoint`, because honouring it was an SSRF and API-key exfiltration hole.
 * A plugin proxy is the same shape of risk with a friendlier name, so the
 * origin never appears in a manifest, a case config, or a request.
 *
 * Format (one env var so `docs:gen:config` can find it as a literal read):
 *
 *   ROHY_PLUGIN_ORIGINS="pathology=https://slides.example.edu,ecg=https://ecg.example.edu"
 *
 * Unset means no plugin has a remote origin, and every proxy route answers 503.
 * That is the default and the right one: a fresh install talks to nothing.
 *
 * Malformed means the process refuses to start. A typo here does not degrade
 * into "remote content quietly stopped working" — it degrades into an operator
 * believing slides are served from a host that rohy never contacts.
 */
import { logger } from '../logger.js';

const log = logger('plugin-origins');

/**
 * Parse the origin allowlist.
 *
 * @param {string|undefined} raw value of ROHY_PLUGIN_ORIGINS
 * @returns {Map<string, string>} plugin id → origin, normalised to scheme://host[:port]
 * @throws {Error} on any malformed entry
 */
export function parsePluginOrigins(raw) {
    const out = new Map();
    if (!raw || !raw.trim()) return out;

    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((entry) => {
        const eq = entry.indexOf('=');
        if (eq < 1) {
            throw new Error(`ROHY_PLUGIN_ORIGINS entry '${entry}' is not '<pluginId>=<origin>'`);
        }
        const id = entry.slice(0, eq).trim();
        const value = entry.slice(eq + 1).trim();
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            throw new Error(`ROHY_PLUGIN_ORIGINS names plugin '${id}', which is not a lower_snake_case plugin id`);
        }
        if (out.has(id)) {
            throw new Error(`ROHY_PLUGIN_ORIGINS lists plugin '${id}' twice — which host wins is not something to leave to parse order`);
        }

        let url;
        try {
            url = new URL(value);
        } catch {
            throw new Error(`ROHY_PLUGIN_ORIGINS origin for '${id}' is not a URL: '${value}'`);
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error(`ROHY_PLUGIN_ORIGINS origin for '${id}' must be http or https, got '${url.protocol}'`);
        }
        // Credentials in the URL would be forwarded on every tile request and
        // logged by every intermediary. If an upstream needs auth, it needs a
        // design, not a userinfo segment.
        if (url.username || url.password) {
            throw new Error(`ROHY_PLUGIN_ORIGINS origin for '${id}' carries credentials in the URL; that is not a supported way to authenticate an upstream`);
        }
        // A path/query on the origin would silently prefix or corrupt every
        // proxied request. The origin is a HOST, and the manifest owns paths.
        if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
            throw new Error(`ROHY_PLUGIN_ORIGINS origin for '${id}' must be a bare origin with no path, query or fragment — the manifest declares the paths`);
        }
        out.set(id, url.origin);
    });

    return out;
}

let cached = null;

/**
 * The parsed allowlist, read once. Throws on malformed input, which
 * validateEnvOrExit surfaces as a refusal to boot.
 *
 * @returns {Map<string, string>} plugin id → origin
 */
export function pluginOrigins() {
    if (cached === null) {
        cached = parsePluginOrigins(process.env.ROHY_PLUGIN_ORIGINS);
        if (cached.size > 0) {
            // Logged at boot on purpose: "which hosts will this server talk to"
            // should be answerable from the log, not only from the env file.
            log.info('plugin remote origins configured', {
                origins: Object.fromEntries(cached),
            });
        }
    }
    return cached;
}

/** Test seam — forget the parse so a changed env var is re-read. */
export function resetPluginOrigins() { cached = null; }

export default pluginOrigins;
