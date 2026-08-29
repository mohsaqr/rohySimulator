/**
 * Where a plugin may DOWNLOAD content from — the operator's outer bound.
 *
 * WHY THIS EXISTS WHEN A TENANT ADMIN ALREADY PICKS ORIGINS
 *
 * RPS-1 1.4 gives pathology an `imports.allowedOrigins` setting, and it would be
 * easy to read that as the whole answer: an admin names the hosts, rohy fetches
 * from them. It is not the whole answer, because **a tenant admin is not the
 * server operator.** They are an educator-organisation role inside one
 * deployment; the deployment's network position — what rohy's server can reach
 * that a browser cannot — belongs to whoever runs it.
 *
 * Letting a tenant admin name an arbitrary URL for the server to fetch is
 * exactly the hole rohy has already paid for once: `proxy-routes.js` accepts and
 * deliberately IGNORES a client-supplied `endpoint`, because honouring it was an
 * SSRF and key-exfiltration hole. `pluginRemoteOrigins.js` restates the rule for
 * proxied content — *a case author picks a path, an operator picks a host* — and
 * a 4 GB download from a link is the same shape of risk with a friendlier name.
 *
 * So the two layers compose in one direction only:
 *
 *   ROHY_PLUGIN_IMPORT_ORIGINS   the operator's allowlist  (this file)
 *          ⊇
 *   imports.allowedOrigins       the tenant admin's narrowing  (a setting)
 *
 * An admin may narrow, never widen. Saving an origin outside the operator's list
 * is refused at PUT time naming the origin, and checked again at fetch time —
 * the env can change after a save, and a stored value is not a permission.
 *
 * Format (one env var, one literal read, so `docs:gen:config` can find it):
 *
 *   ROHY_PLUGIN_IMPORT_ORIGINS="pathology=https://openslide.cs.cmu.edu,pathology=https://slides.uni.edu"
 *
 * A plugin id may repeat; the origins accumulate. Unset means NO plugin may
 * import from anywhere, and that is the correct default for a fresh install:
 * a server nobody has told where slides may come from fetches from nowhere.
 * Malformed is fatal at boot, for the same reason it is in pluginRemoteOrigins:
 * a typo must not degrade into "imports quietly stopped working".
 */
import { logger } from '../logger.js';
import { normalizeOrigin } from '../shared/pluginSettings.js';

const log = logger('plugin-import-origins');

/**
 * Parse the import allowlist.
 *
 * @param {string|undefined} raw value of ROHY_PLUGIN_IMPORT_ORIGINS
 * @returns {Map<string, string[]>} plugin id → allowed origins
 * @throws {Error} on any malformed entry
 */
export function parseImportOrigins(raw) {
    const out = new Map();
    if (!raw || !raw.trim()) return out;

    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((entry) => {
        const eq = entry.indexOf('=');
        if (eq < 1) {
            throw new Error(`ROHY_PLUGIN_IMPORT_ORIGINS entry '${entry}' is not '<pluginId>=<origin>'`);
        }
        const id = entry.slice(0, eq).trim();
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            throw new Error(`ROHY_PLUGIN_IMPORT_ORIGINS names plugin '${id}', which is not a lower_snake_case plugin id`);
        }
        const origin = normalizeOrigin(entry.slice(eq + 1).trim(), `ROHY_PLUGIN_IMPORT_ORIGINS origin for '${id}'`);
        const list = out.get(id) ?? [];
        // A repeat is a duplicate, not a conflict: unlike ROHY_PLUGIN_ORIGINS
        // (where two values for one id means "which host wins" is left to parse
        // order) this is a LIST, so the same origin twice is simply idempotent.
        if (!list.includes(origin)) list.push(origin);
        out.set(id, list);
    });
    return out;
}

let cached = null;

/**
 * The parsed allowlist, read once. Throws on malformed input, which
 * validateEnvOrExit surfaces as a refusal to boot.
 *
 * @returns {Map<string, string[]>} plugin id → allowed origins
 */
export function importOrigins() {
    if (cached === null) {
        cached = parseImportOrigins(process.env.ROHY_PLUGIN_IMPORT_ORIGINS);
        if (cached.size > 0) {
            // Logged at boot for the same reason the proxy's origins are: "what
            // will this server download from" should be answerable from the log.
            log.info('plugin import origins configured', { origins: Object.fromEntries(cached) });
        }
    }
    return cached;
}

/**
 * The origins a plugin may import from in this deployment.
 *
 * @param {string} pluginId
 * @returns {string[]} empty when the operator has allowed none
 */
export function importOriginsFor(pluginId) {
    return importOrigins().get(pluginId) ?? [];
}

/** Test seam — forget the parse so a changed env var is re-read. */
export function resetImportOrigins() { cached = null; }
