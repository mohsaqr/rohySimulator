// Boot-time environment validator.
//
// Goal: fail fast with a clear, actionable message rather than letting a
// missing/misconfigured env var surface later as a silent CORS 500, an
// audit-token signing crash, or a DB-wiped-by-npm-ci incident.
//
// Two severities:
//   - errors[]    → fatal. validateEnvOrExit() will print and process.exit(1).
//   - warnings[]  → printed but non-fatal. Common in dev where short JWT
//                   secrets and missing FRONTEND_URL are expected.
//
// Pure function. validateEnv(env) returns { errors, warnings }; the
// process-killing wrapper is separate so unit tests can drive it without
// killing vitest.

import path from 'node:path';
import { logger } from '../logger.js';
import { parsePluginOriginTokens } from '../lib/pluginOriginTokens.js';
import { parsePluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { parseImportOrigins } from '../lib/pluginImportOrigins.js';
import { parseLibraryDirs } from '../lib/pluginServerSlot.js';
import { jwtSecretWeakness, MIN_JWT_SECRET_LENGTH } from '../lib/jwtSecretPolicy.js';

const defaultLog = logger('env');

function isProd(env) {
    return env.NODE_ENV === 'production';
}

// JWT_SECRET placeholder / low-entropy rule: server/lib/jwtSecretPolicy.js
// (dependency-free so deploy/preflight.sh can load it on a production host).
export { jwtSecretWeakness, MIN_JWT_DISTINCT_CHARS } from '../lib/jwtSecretPolicy.js';

// A URL as it is safe to log: user:password@ removed. ROHY_KOKORO_URL and
// FRONTEND_URL were echoed verbatim, so credentials in the authority reached
// the journal (L6-15).
function urlForLog(raw) {
    try {
        const u = new URL(raw);
        if (u.username || u.password) {
            u.username = '';
            u.password = '';
            return `${u.toString()} (credentials removed)`;
        }
        return u.toString();
    } catch {
        return '[unparseable URL]';
    }
}

function isLocalUrl(url) {
    try {
        const u = new URL(url);
        return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
    } catch { return false; }
}

export function validateEnv(env = process.env) {
    const errors = [];
    const warnings = [];

    // JWT_SECRET — fatal everywhere. Token signing is non-negotiable.
    if (!env.JWT_SECRET) {
        errors.push(
            'JWT_SECRET is not set. Set a long random secret in your env file. ' +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
        );
    } else if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        // Every session token is signed with this. A short secret is a
        // brute-forceable one, and a forged token is a login as anyone — so in
        // production it is fatal, not advisory (security audit 2026-10-24).
        // Dev and test keep the warning so a throwaway secret still boots.
        const msg =
            `JWT_SECRET is only ${env.JWT_SECRET.length} chars; it must be at least ` +
            `${MIN_JWT_SECRET_LENGTH} (session tokens are signed with it). ` +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";
        (isProd(env) ? errors : warnings).push(msg);
    } else if (isProd(env)) {
        // Production only: dev and test boot on throwaway secrets by design.
        const weakness = jwtSecretWeakness(env.JWT_SECRET);
        if (weakness) {
            errors.push(
                `JWT_SECRET is not a usable secret: ${weakness}. Anyone who can guess it can sign ` +
                'a session token for any account. Generate one with: ' +
                "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
            );
        }
    }

    // ROHY_PLUGIN_ORIGINS — fatal if malformed. Checked here rather than left
    // to the first tile request, because the failure mode this prevents is an
    // operator who believes slides are coming from a host rohy never contacts.
    // A malformed credential map is fatal for the same reason a malformed
    // origin is: a typo must not degrade into "the imaging quietly stopped
    // loading" while an operator believes the host is authenticated.
    if (env.ROHY_PLUGIN_ORIGIN_TOKENS) {
        try {
            parsePluginOriginTokens(env.ROHY_PLUGIN_ORIGIN_TOKENS);
        } catch (err) {
            // The parser's message names the variable and never quotes the
            // entry, because the entry is the thing that is secret.
            errors.push(err.message);
        }
    }

    if (env.ROHY_PLUGIN_ORIGINS) {
        try {
            parsePluginOrigins(env.ROHY_PLUGIN_ORIGINS);
        } catch (err) {
            errors.push(err.message);
        }
    }

    // ROHY_PLUGIN_IMPORT_ORIGINS / ROHY_PLUGIN_LIBRARY_DIRS — fatal if
    // malformed, for the same reason as ROHY_PLUGIN_ORIGINS above. A typo in
    // an import allowlist does not degrade into "imports are stricter than
    // intended"; it degrades into an operator believing a host is permitted
    // that rohy will refuse, discovered by an educator mid-import.
    if (env.ROHY_PLUGIN_IMPORT_ORIGINS) {
        try {
            parseImportOrigins(env.ROHY_PLUGIN_IMPORT_ORIGINS);
        } catch (err) {
            errors.push(err.message);
        }
    }
    if (env.ROHY_PLUGIN_LIBRARY_DIRS) {
        try {
            parseLibraryDirs(env.ROHY_PLUGIN_LIBRARY_DIRS);
        } catch (err) {
            errors.push(err.message);
        }
    }

    // ROHY_KOKORO_URL — remote Kokoro TTS. Fatal if malformed: the failure
    // mode is an operator who believes voices come from the GPU host while
    // every reply quietly synthesizes on this box's CPU (the local fallback
    // hides the misconfiguration from learners, so boot must not).
    if (env.ROHY_KOKORO_URL) {
        let kokoroUrl = null;
        try {
            kokoroUrl = new URL(env.ROHY_KOKORO_URL);
        } catch { /* reported below */ }
        if (!kokoroUrl || !['http:', 'https:'].includes(kokoroUrl.protocol)) {
            errors.push(`ROHY_KOKORO_URL is not an http(s) URL (got ${urlForLog(env.ROHY_KOKORO_URL)}; expected e.g. https://api.example.org/v1).`);
        } else {
            if (kokoroUrl.protocol === 'http:' && isProd(env) && !isLocalUrl(env.ROHY_KOKORO_URL)) {
                warnings.push('ROHY_KOKORO_URL uses plain http in production: the API key and every spoken line cross the network unencrypted.');
            }
            if (!env.ROHY_KOKORO_API_KEY) {
                warnings.push('ROHY_KOKORO_URL is set but ROHY_KOKORO_API_KEY is not: the remote host will refuse every request and all speech will fall back to the local model.');
            }
        }
    } else if (env.ROHY_KOKORO_API_KEY) {
        warnings.push('ROHY_KOKORO_API_KEY is set but ROHY_KOKORO_URL is not, so the key is unused and Kokoro synthesizes locally.');
    }
    if (env.ROHY_KOKORO_TIMEOUT_MS != null && env.ROHY_KOKORO_TIMEOUT_MS !== ''
        && !/^[1-9]\d*$/.test(String(env.ROHY_KOKORO_TIMEOUT_MS))) {
        errors.push(`ROHY_KOKORO_TIMEOUT_MS="${env.ROHY_KOKORO_TIMEOUT_MS}" is not a positive integer (milliseconds).`);
    }

    // PORT / HTTPS_PORT — must be numeric if set.
    for (const key of ['PORT', 'HTTPS_PORT']) {
        if (env[key] != null && env[key] !== '' && !/^\d+$/.test(String(env[key]))) {
            errors.push(`${key}="${env[key]}" is not a positive integer.`);
        }
    }

    // FRONTEND_URL — must parse if set; warn in prod if unset.
    if (env.FRONTEND_URL) {
        try {
            new URL(env.FRONTEND_URL);
        } catch {
            errors.push(`FRONTEND_URL="${urlForLog(env.FRONTEND_URL)}" is not a valid URL.`);
        }
    } else if (isProd(env)) {
        warnings.push(
            'FRONTEND_URL is not set in production. Browser requests from any non-localhost ' +
            'origin will be CORS-rejected (silently — see middleware/errorHandler.js maps these to 403). ' +
            'Set FRONTEND_URL to your public deploy URL (e.g. https://example.com/rohy).'
        );
    }

    // ROHY_DB — must be absolute if set; warn if unset in prod (DB lives in repo).
    if (env.ROHY_DB) {
        if (!path.isAbsolute(env.ROHY_DB)) {
            warnings.push(
                `ROHY_DB="${env.ROHY_DB}" is not an absolute path. The DB will be resolved ` +
                'relative to cwd, which may differ between systemd, dev, and CLI runs. ' +
                'Use an absolute path like /opt/data/rohy/database.sqlite.'
            );
        }
    } else if (isProd(env)) {
        warnings.push(
            'ROHY_DB is not set in production. The database will live inside the repo at ' +
            'server/database.sqlite — vulnerable to a clean clone or npm ci that wipes the ' +
            'working tree. Set ROHY_DB to an absolute path outside the repo.'
        );
    }

    // TLS — when one of CERT/KEY is set, both must be set.
    const hasCert = Boolean(env.TLS_CERT_PATH);
    const hasKey = Boolean(env.TLS_KEY_PATH);
    if (hasCert !== hasKey) {
        errors.push(
            'TLS_CERT_PATH and TLS_KEY_PATH must both be set together (or both unset). ' +
            `Got TLS_CERT_PATH=${hasCert ? 'set' : 'unset'}, TLS_KEY_PATH=${hasKey ? 'set' : 'unset'}.`
        );
    }
    if (isProd(env) && !hasCert && !hasKey && env.FRONTEND_URL) {
        try {
            const u = new URL(env.FRONTEND_URL);
            if (u.protocol === 'http:' && !isLocalUrl(env.FRONTEND_URL)) {
                warnings.push(
                    `FRONTEND_URL="${urlForLog(env.FRONTEND_URL)}" uses plain HTTP and no TLS_CERT_PATH/TLS_KEY_PATH ` +
                    'is set. Browsers block getUserMedia (mic) on non-localhost insecure origins, ' +
                    'so press-to-talk will not work. Either terminate TLS at nginx or set ' +
                    'TLS_CERT_PATH/TLS_KEY_PATH for the rohy process.'
                );
            }
        } catch { /* URL parse already errored above; skip duplicate report */ }
    }

    // TRANSFORMERS_CACHE — warn in prod regardless of provider so a future
    // tts_provider switch to kokoro doesn't immediately re-trigger the
    // crash loop documented in AGENT-NOTE-DEPLOY §4.
    if (isProd(env) && !env.TRANSFORMERS_CACHE) {
        warnings.push(
            'NODE_ENV=production but TRANSFORMERS_CACHE is not set. The Kokoro model cache ' +
            'will live inside node_modules and be wiped by every npm ci → re-download → ' +
            'truncated download → ORT crash → systemd restart loop. Set TRANSFORMERS_CACHE ' +
            'to a persistent path like /var/cache/rohy-hf.'
        );
    }

    // ALLOW_DEFAULT_USERS — seeds the well-known demo accounts (admin/admin123
    // and friends). In production that is a published password on an admin
    // account, so it is fatal (security audit 2026-10-24); a first admin is
    // provisioned with ROHY_ADMIN_USERNAME/ROHY_ADMIN_PASSWORD instead, which
    // the install and deploy scripts set.
    if (isProd(env) && env.ALLOW_DEFAULT_USERS === '1') {
        errors.push(
            'ALLOW_DEFAULT_USERS=1 in production seeds the demo accounts with their published ' +
            'passwords (admin/admin123). Remove it and provision the first administrator with ' +
            'ROHY_ADMIN_USERNAME and ROHY_ADMIN_PASSWORD instead.'
        );
    }

    // ROHY_TRUST_PROXY — the rate limiters, the audit log and login_logs key
    // on req.ip. Behind a reverse proxy on ANOTHER host or container (nginx in
    // its own container, a cloud load balancer) every request arrives from the
    // proxy's address: with the default 'loopback' X-Forwarded-For is ignored,
    // every client shares one rate-limit bucket (one student's burst locks the
    // whole class out of login) and every audit row names the proxy.
    const trustProxyRaw = env.ROHY_TRUST_PROXY == null ? '' : String(env.ROHY_TRUST_PROXY).trim();
    if (isProd(env) && (trustProxyRaw === '' || trustProxyRaw === 'loopback')) {
        warnings.push(
            `ROHY_TRUST_PROXY is ${trustProxyRaw === '' ? 'not set (default "loopback")' : '"loopback"'} in production. ` +
            'That is right only when the reverse proxy runs on this host. Behind nginx in another ' +
            'container or a load balancer, every client shares ONE rate-limit bucket and the audit ' +
            "log records the proxy's address — set ROHY_TRUST_PROXY to the proxy's IP/CIDR or hop count."
        );
    }

    // Typo guard. The Express docs accept several values; we only validate
    // that it parses as one of the documented forms.
    if (trustProxyRaw !== '') {
        const v = trustProxyRaw;
        const valid =
            v === 'true' || v === 'false' ||
            v === 'loopback' || v === 'linklocal' || v === 'uniquelocal' ||
            /^\d+$/.test(v) ||                         // hop count
            v.includes('.') || v.includes(':') ||      // single IP / CIDR / list
            v.startsWith('[');
        if (!valid) {
            warnings.push(
                `ROHY_TRUST_PROXY="${v}" doesn't look like a documented Express trust-proxy value. ` +
                'Expected: "loopback", "linklocal", "uniquelocal", "true", "false", a hop-count integer, ' +
                'an IP, a CIDR, or a comma-separated list. See Express docs.'
            );
        }
    }

    // Switches that are right in CI and wrong on a live site. Accepted (the
    // CI audit job boots in production mode with one of them), but never
    // silently: an operator who copied a CI env file should see it at boot.
    if (isProd(env)) {
        for (const key of ['ROHY_DISABLE_AUTH_RATE_LIMIT', 'ROHY_DISABLE_GENERAL_RATE_LIMIT']) {
            const value = env[key] == null ? '' : String(env[key]).trim();
            if (value !== '' && value !== '0' && value.toLowerCase() !== 'false') {
                warnings.push(
                    `${key} is set in production: that rate limiter is OFF, so password guessing and ` +
                    'request floods are not throttled. Remove it unless this is a test run.'
                );
            }
        }
        if (trustProxyRaw === 'true') {
            warnings.push(
                'ROHY_TRUST_PROXY=true in production trusts EVERY X-Forwarded-For hop, so any client can ' +
                'choose the address the rate limiters and the audit log record. Name the proxy instead ' +
                '("loopback", "uniquelocal", its IP/CIDR, or a hop count).'
            );
        }
    }

    return { errors, warnings };
}

// Process-killing wrapper. log defaults to the project `logger('env')` so
// the output format matches every other server component.
export function validateEnvOrExit(env = process.env, log = defaultLog) {
    const { errors, warnings } = validateEnv(env);

    for (const w of warnings) log.warn?.(w);
    for (const e of errors) log.error?.(e);

    if (errors.length > 0) {
        log.error?.(`${errors.length} fatal config error(s) — refusing to start. Fix the env file and try again.`);
        process.exit(1);
    }

    return { errors, warnings };
}
