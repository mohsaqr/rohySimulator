// Server-side terms-of-use gate.
//
// Until the security audit of 2026-10-24 the terms gate was client-only:
// /api/terms/status REPORTED that acceptance was pending and TermsGate.jsx
// refused to mount the app, but every API route answered an account that had
// never accepted the current version. Anyone with a token and curl was never
// asked. This middleware makes the server enforce what the UI shows.
//
// Contract:
//   - Runs AFTER authentication (it is called from authenticateToken once
//     req.user is set, and may also be mounted explicitly on a route). A
//     request with no req.user passes through untouched, so the per-route
//     authenticateToken keeps producing its own 401.
//   - When platform_settings.terms_required is '1' and the user has no
//     terms_acceptances row for the CURRENT version, the request is refused
//     with 451 { error, code: 'terms_required', version } — a status the
//     client can tell apart from 401/403 and route to the terms page.
//   - Exempt paths: /auth/* (sign in, verify, refresh, logout — the person
//     must be able to reach and leave the terms page), /terms* (read, status,
//     accept), /health* and /ready (probes), /platform-settings/language (the
//     login page needs it pre-token) and /platform-settings/terms (an admin
//     must be able to fix or switch off a requirement without first accepting
//     the very document being fixed; only admins reach it).
//
// Caching: `terms_required` and `terms_version` are read at most once per
// TERMS_SETTINGS_CACHE_MS (the same 30 s posture as registrationPolicy() in
// routes/_helpers.js); the admin PUT calls resetTermsGateCache() so a change
// applies immediately in-process. Acceptances are cached positively only —
// once (user, version) is accepted it stays accepted; a new version has a new
// key and a purged user cannot authenticate at all — so the steady state costs
// zero extra queries per request.
//
// This module imports dbAdapter and shared/terms.js only: middleware/auth.js
// calls it, and routes/terms-routes.js imports auth.js, so importing either of
// those here would be a cycle.

import dbAdapter from '../dbAdapter.js';
import { DEFAULT_TERMS_VERSION, normalizeTermsVersion } from '../shared/terms.js';
import { logger } from '../logger.js';

const gateLog = logger('terms-gate');

export const TERMS_SETTINGS_CACHE_MS = 30_000;
const ACCEPTED_CACHE_MAX = 10_000;

// Path prefixes (relative to the /api mount) that are never gated.
export const TERMS_GATE_EXEMPT_PREFIXES = Object.freeze([
    '/auth/',
    '/terms',
    '/health',
    '/ready',
    '/platform-settings/language',
    '/platform-settings/terms',
]);

let settingsCache = { value: null, at: 0 };
const acceptedCache = new Set();

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        dbAdapter.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}
function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        dbAdapter.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

/** Drop both caches (admin PUT /platform-settings/terms, tests). */
export function resetTermsGateCache() {
    settingsCache = { value: null, at: 0 };
    acceptedCache.clear();
}

/** The request path relative to the /api mount, without the query string. */
export function termsGatePath(req) {
    const raw = String(req?.originalUrl || req?.url || '');
    const path = raw.split('?')[0];
    return path.startsWith('/api/') ? path.slice(4) : path;
}

export function termsGateExempt(req) {
    const path = termsGatePath(req);
    return TERMS_GATE_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)
        || (prefix.endsWith('/') && path === prefix.slice(0, -1)));
}

/** { required, version } — the same resolution terms-routes.js uses for the master document. */
export async function termsRequirement(now = Date.now()) {
    if (settingsCache.value && now - settingsCache.at < TERMS_SETTINGS_CACHE_MS) {
        return settingsCache.value;
    }
    const rows = await dbAll(
        `SELECT setting_key, setting_value FROM platform_settings
          WHERE setting_key IN ('terms_required', 'terms_version')`,
        [],
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const value = {
        required: byKey.terms_required === '1',
        version: normalizeTermsVersion(byKey.terms_version) || DEFAULT_TERMS_VERSION,
    };
    settingsCache = { value, at: now };
    return value;
}

async function hasAccepted(userId, version) {
    const key = `${userId}:${version}`;
    if (acceptedCache.has(key)) return true;
    const row = await dbGet(
        'SELECT 1 AS ok FROM terms_acceptances WHERE user_id = ? AND version = ? LIMIT 1',
        [userId, version],
    );
    if (!row) return false;
    if (acceptedCache.size >= ACCEPTED_CACHE_MAX) acceptedCache.clear();
    acceptedCache.add(key);
    return true;
}

/**
 * Express middleware. Refuses with 451 when the authenticated user has not
 * accepted the current terms version and acceptance is required. Passes
 * through when there is no req.user or the path is exempt.
 */
export async function requireTermsAccepted(req, res, next) {
    if (!req.user?.id || termsGateExempt(req)) return next();
    try {
        const { required, version } = await termsRequirement();
        if (!required) return next();
        if (await hasAccepted(req.user.id, version)) return next();
        return res.status(451).json({
            error: 'Terms acceptance required',
            code: 'terms_required',
            version,
        });
    } catch (err) {
        // The gate's own read failing must not take the platform down; the
        // client-side gate still shows the agreement on the next status probe.
        (req.log || gateLog).error('terms gate check failed; letting the request through', { error: err.message });
        return next();
    }
}
