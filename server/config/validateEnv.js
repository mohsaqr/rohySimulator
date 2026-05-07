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

const MIN_JWT_SECRET_LENGTH = 32;

function isProd(env) {
    return env.NODE_ENV === 'production';
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
        warnings.push(
            `JWT_SECRET is only ${env.JWT_SECRET.length} chars. ` +
            `Recommend ≥${MIN_JWT_SECRET_LENGTH} for production-grade entropy.`
        );
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
            errors.push(`FRONTEND_URL="${env.FRONTEND_URL}" is not a valid URL.`);
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
                    `FRONTEND_URL="${env.FRONTEND_URL}" uses plain HTTP and no TLS_CERT_PATH/TLS_KEY_PATH ` +
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

    // ALLOW_DEFAULT_USERS — bootstrap-only flag; warn if left on in prod.
    if (isProd(env) && env.ALLOW_DEFAULT_USERS === '1') {
        warnings.push(
            'ALLOW_DEFAULT_USERS=1 in production. This is only safe for the FIRST boot to ' +
            'seed default users. Remove it from /etc/rohy/env once admin login works.'
        );
    }

    // ROHY_TRUST_PROXY — typo guard. The Express docs accept several values;
    // we only validate that it parses as one of the documented forms.
    if (env.ROHY_TRUST_PROXY != null && env.ROHY_TRUST_PROXY !== '') {
        const v = String(env.ROHY_TRUST_PROXY).trim();
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

    return { errors, warnings };
}

// Process-killing wrapper. Logger has the same shape as logger('foo') — uses
// .error/.warn/.info methods. Defaults to console for callers that haven't
// initialized the project logger yet (e.g. very early in server.js boot).
export function validateEnvOrExit(env = process.env, log = console) {
    const { errors, warnings } = validateEnv(env);

    for (const w of warnings) {
        if (typeof log.warn === 'function') log.warn('[env] ' + w);
        else if (typeof log.info === 'function') log.info('[env] WARN ' + w);
    }
    for (const e of errors) {
        if (typeof log.error === 'function') log.error('[env] ' + e);
    }

    if (errors.length > 0) {
        const msg = `[env] ${errors.length} fatal config error(s) — refusing to start. Fix the env file and try again.`;
        if (typeof log.error === 'function') log.error(msg);
        // Tests cover validateEnv() pure form; this branch is intentionally
        // not unit-tested via process.exit but covered via spawn-based test.
        process.exit(1);
    }

    return { errors, warnings };
}
