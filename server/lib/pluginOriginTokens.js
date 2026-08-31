/**
 * The credential rohy presents to a plugin's content origin.
 *
 * `pluginRemoteOrigins.js` decides WHERE content may come from. This decides
 * how rohy proves it is allowed to have it, so an origin can be closed to the
 * public rather than merely unadvertised.
 *
 * Format, deliberately the same grammar as ROHY_PLUGIN_ORIGINS so the two are
 * read the same way (one env var, so `docs:gen:config` finds it as a literal):
 *
 *   ROHY_PLUGIN_ORIGIN_TOKENS="pacs=s3cr3t,pathology=other"
 *
 * The token is sent ONLY on rohy's own server-to-server fetch, as
 * `Authorization: Bearer <token>`. It is never returned to a browser, never
 * logged, and is not the caller's credential: the proxy forwards no cookies,
 * no Authorization header and no query string from the learner, and that stays
 * true. Two separate authorisations happen — rohy decides whether this learner
 * may read this plugin's content, and the origin decides whether this
 * DEPLOYMENT may read anything at all — and conflating them is how a proxy
 * becomes a confused deputy.
 *
 * Per deployment, not per user. The origin is being told which installation is
 * asking, so a token can be revoked without touching the others.
 *
 * Unset means the origin is fetched anonymously, which is correct for a public
 * origin and is the existing behaviour. Malformed means the process refuses to
 * start, for the same reason a malformed origin does: a typo must not degrade
 * into "the content quietly stopped loading" while an operator believes the
 * host is authenticated.
 */
import { logger } from '../logger.js';

const log = logger('plugin-origin-tokens');

/**
 * Parse the token map.
 *
 * @param {string|undefined} raw value of ROHY_PLUGIN_ORIGIN_TOKENS
 * @returns {Map<string, string>} plugin id → bearer token
 * @throws {Error} on any malformed entry
 */
export function parsePluginOriginTokens(raw) {
    const out = new Map();
    if (!raw || !raw.trim()) return out;

    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((entry) => {
        const eq = entry.indexOf('=');
        if (eq < 1) {
            // The entry is NOT quoted in the message. It contains a secret.
            throw new Error('a ROHY_PLUGIN_ORIGIN_TOKENS entry is not \'<pluginId>=<token>\'');
        }
        const id = entry.slice(0, eq).trim();
        const token = entry.slice(eq + 1).trim();
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            throw new Error(`ROHY_PLUGIN_ORIGIN_TOKENS names plugin '${id}', which is not a lower_snake_case plugin id`);
        }
        if (!token) {
            throw new Error(`ROHY_PLUGIN_ORIGIN_TOKENS gives plugin '${id}' an empty token`);
        }
        // A comma cannot appear in a token, because a comma separates entries.
        // Said here rather than discovered as a truncated credential producing
        // 401s against a host the operator is sure they configured.
        if (/\s/.test(token)) {
            throw new Error(`the ROHY_PLUGIN_ORIGIN_TOKENS token for '${id}' contains whitespace`);
        }
        if (out.has(id)) {
            throw new Error(`ROHY_PLUGIN_ORIGIN_TOKENS lists plugin '${id}' twice — which credential wins is not something to leave to parse order`);
        }
        out.set(id, token);
    });

    return out;
}

let cached = null;

/**
 * The parsed token map, read once.
 *
 * @returns {Map<string, string>} plugin id → bearer token
 */
export function pluginOriginTokens() {
    if (cached === null) {
        cached = parsePluginOriginTokens(process.env.ROHY_PLUGIN_ORIGIN_TOKENS);
        if (cached.size > 0) {
            // The ids, never the values.
            log.info('plugin origin credentials configured', { plugins: [...cached.keys()] });
        }
    }
    return cached;
}

/** Test seam: forget the parse so a new environment is read. */
export function resetPluginOriginTokens() { cached = null; }

/**
 * The headers for a server-to-server fetch of this plugin's content.
 *
 * @param {string} pluginId
 * @param {object} base headers the caller already wants to send
 * @returns {object} headers, with Authorization added when a token is configured
 */
export function originRequestHeaders(pluginId, base = {}) {
    const token = pluginOriginTokens().get(pluginId);
    return token ? { ...base, authorization: `Bearer ${token}` } : base;
}
