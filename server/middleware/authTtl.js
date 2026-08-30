/**
 * One knob for how long a login lasts.
 *
 * FOUR lifetimes MUST agree or logins die at the shortest one: the JWT `exp`
 * claim, the `rohy_auth` cookie's maxAge, the `active_sessions` row's
 * `expires_at`, and the `rohy_csrf` cookie's maxAge. They used to be
 * hardcoded separately (all at 4h); `authTtlSeconds()` is the single source
 * all four derive from.
 *
 * JWT_EXPIRY accepts '45s', '90m', '12h', '7d', or a bare number of seconds.
 * The default is 7 days: a session survives overnight and weekend gaps
 * instead of collapsing after 4 idle hours. That is safe to hold this long
 * because tokens are server-revocable — every request re-checks
 * active_sessions, so logout / admin force-logout / password change
 * invalidates a still-cryptographically-valid JWT immediately. Deployments
 * wanting a tighter window set JWT_EXPIRY (e.g. '4h').
 *
 * WHY ITS OWN MODULE. It used to live in `middleware/auth.js`, which
 * `middleware/csrf.js` cannot import: auth.js pulls in dbAdapter → db.js,
 * and db.js opens (and migrates, and seeds) the sqlite file named by ROHY_DB
 * at module-load time. A csrf unit test importing csrf.js would have booted
 * the developer's real database as a side effect. This module reads
 * `process.env` and nothing else, so both middlewares can share ONE
 * definition without either dragging the database behind it.
 *
 * @module server/middleware/authTtl
 */

const DEFAULT_TTL_SECONDS = 7 * 86400; // '7d'
const TTL_UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * How long a login lasts, in seconds, from JWT_EXPIRY.
 *
 * Read per call rather than cached at import: tests set JWT_EXPIRY between
 * cases, and a cached value would silently answer with the first one.
 *
 * @returns {number} seconds; the 7-day default for a missing or unparseable
 *                   JWT_EXPIRY (never NaN, never 0)
 */
export function authTtlSeconds() {
    const raw = String(process.env.JWT_EXPIRY || '7d').trim();
    const match = raw.match(/^(\d+)\s*([smhd]?)$/i);
    if (!match) return DEFAULT_TTL_SECONDS;
    return Number(match[1]) * TTL_UNIT_SECONDS[(match[2] || 's').toLowerCase()];
}
