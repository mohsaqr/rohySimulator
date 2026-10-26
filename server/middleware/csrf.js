/**
 * CSRF protection for the cookie-auth path.
 *
 * Pairs with the rohy_auth HttpOnly cookie introduced in audit #4. With
 * cookies-by-default a cross-site attacker's POST to /api/* would carry
 * the user's auth cookie automatically (modulo SameSite=Lax) — which is
 * the textbook CSRF risk. The defence is the double-submit cookie pattern:
 *
 *   1. Server sets `rohy_csrf` (NOT HttpOnly) at login. Client JS can
 *      read it.
 *   2. Client copies the cookie value into an `X-CSRF-Token` header on
 *      every state-changing request.
 *   3. Server compares the cookie to the header with a timing-safe
 *      equality check. Mismatch → 403.
 *
 * A cross-site attacker cannot set the X-CSRF-Token header to the right
 * value because they cannot read the cookie (same-origin policy). The
 * cookie alone gets auto-attached but is not enough.
 *
 *   4. The token is BOUND to the session (csrfTokenForSession): it is an HMAC
 *      of the session's token hash, so a cookie planted from a sibling
 *      sub-domain cannot be paired with a header of the attacker's choosing
 *      (security audit 2026-10-26, F-13).
 *
 * Scope:
 *   - Only enforced on POST/PUT/PATCH/DELETE. Read methods don't mutate.
 *   - Only enforced when the request authed via the cookie path
 *     (req.tokenSource === 'cookie'). Bearer-auth requests are not a CSRF
 *     vector (cross-site attackers can't auto-attach a bearer header), so
 *     pre-cookie clients keep working unchanged.
 *   - Login / register are exempt because there's no session yet — the
 *     authLimiter and registerLimiter handle those paths.
 */

import crypto from 'crypto';
import { authTtlSeconds, cookieSecure } from './authTtl.js';

export const CSRF_COOKIE_NAME = 'rohy_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function generateCsrfToken() {
    // 32 bytes base64url → 43 chars. Plenty of entropy to defeat guessing
    // and short enough to fit comfortably in a cookie + header pair.
    //
    // NOT what the server issues any more: an unbound random value fails
    // verifyCsrfBinding(). The auth routes mint csrfTokenForSession() instead.
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * The CSRF token that belongs to ONE session: HMAC-SHA256(JWT_SECRET, the
 * session's token hash), base64url (43 chars, the same shape as before).
 *
 * Why bound (security audit 2026-10-26, F-13): the double-submit check alone
 * only proves that the cookie and the header agree. Anyone who can plant a
 * `rohy_csrf` cookie in the victim's browser (JS on a sibling sub-domain can set
 * `Domain=.lacarm.com`) picks both halves, and a form post from there passes.
 * A token derived from the session cannot be chosen: without JWT_SECRET nobody
 * can compute the value that matches the victim's session.
 *
 * Read per call, like authTtlSeconds(): tests set JWT_SECRET per child process,
 * and importing this module must not require it.
 *
 * @param {string} tokenHash  sha256 hex of the session's JWT (active_sessions.token_hash)
 * @returns {string}
 * @throws {Error} when JWT_SECRET is unset or tokenHash is empty
 */
export function csrfTokenForSession(tokenHash) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required to derive a CSRF token');
    if (typeof tokenHash !== 'string' || !tokenHash) throw new Error('a session token hash is required');
    return crypto.createHmac('sha256', secret).update(`rohy-csrf-v1:${tokenHash}`).digest('base64url');
}

/**
 * Cookie options for the `rohy_csrf` half of the double-submit pair.
 *
 * The TTL is DERIVED from authTtlSeconds(), never hardcoded. It used to be a
 * flat 4 h while the auth cookie ran for 7 days: after four idle hours the
 * public half expired and the HttpOnly half did not, so the browser kept
 * sending a valid session with no CSRF cookie to copy — every background POST
 * came back 403 ("CSRF token missing") until something re-minted the pair.
 * The two halves are one credential and must expire together; that is the same
 * rule authTtlSeconds() already enforces across the JWT exp, the rohy_auth
 * cookie and the active_sessions row.
 *
 * The TTL comes from ./authTtl.js, not from ./auth.js: auth.js imports
 * csrfRequired/verifyCsrf from HERE, and it also pulls in dbAdapter → db.js,
 * which opens and migrates the sqlite database at module-load time. Sharing
 * the dependency-free parser instead keeps this module importable on its own.
 *
 * @param {number} [maxAgeSeconds]  override, e.g. 0 to clear the cookie
 * @returns {{httpOnly: boolean, secure: boolean, sameSite: string, path: string, maxAge: number}}
 */
export function csrfCookieOptions(maxAgeSeconds = authTtlSeconds()) {
    return {
        // CRUCIAL: this cookie is NOT HttpOnly — client JS reads it to
        // populate the X-CSRF-Token header. The auth cookie next to it
        // (rohy_auth) IS HttpOnly; this one is the public half of the
        // double-submit pair.
        httpOnly: false,
        // Same rule as the rohy_auth cookie — see cookieSecure() in authTtl.js.
        secure: cookieSecure(),
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    };
}

// Single-cookie reader, matching auth.js's inlined parser. Kept local so
// this module has zero dependencies on the auth module's internals.
function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const pair of raw.split(';')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const k = pair.slice(0, eq).trim();
        if (k !== name) continue;
        const v = pair.slice(eq + 1).trim();
        try { return decodeURIComponent(v); }
        catch { return v; }
    }
    return null;
}

/**
 * True when the request needs a CSRF check. Pure function — exported so the
 * existing authenticateToken can call it without importing private state.
 */
export function csrfRequired(req) {
    if (req.tokenSource !== 'cookie') return false;
    return STATE_CHANGING_METHODS.has(req.method?.toUpperCase());
}

// The request bodies an HTML form, or a cross-site fetch that needs no CORS
// preflight, can produce. A `_csrf` field in one of these is attacker-writable
// from any page, so it never counts as a token. (Before F-13 the body fallback
// applied to every content type, urlencoded forms included.) The one legitimate
// body-token sender, navigator.sendBeacon in BackendSurface.js, posts an
// application/json Blob — which a cross-site page cannot send without a
// preflight that CORS refuses.
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

function bodyTokenAllowed(req) {
    const type = String(req.headers?.['content-type'] || '').trim().toLowerCase();
    return !FORM_CONTENT_TYPES.some((form) => type.startsWith(form));
}

/** The token the caller presented: the header, else (JSON bodies only) `_csrf`. */
function presentedToken(req) {
    const headerValue = req.headers?.[CSRF_HEADER_NAME];
    // The token may also ride in the JSON body as `_csrf`. navigator.sendBeacon
    // cannot set headers, so the learning-event flush on page unload carried
    // no token and every one was refused — the last events before each reload
    // or tab close were lost (QA 2026-10-04, PRV-24). The header still wins
    // when both are present.
    const bodyToken = bodyTokenAllowed(req) && typeof req.body?._csrf === 'string' ? req.body._csrf : undefined;
    return (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? bodyToken;
}

function sameToken(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        // Buffer.from() can throw on non-UTF-8 input — treat as mismatch.
        return false;
    }
}

/**
 * Verify the double-submit pair on a cookie-auth state-changing request.
 *
 * Returns null on success, or { status, body } on rejection — caller writes
 * the response. Splitting the verdict from the response lets callers (e.g.
 * authenticateToken) integrate this into their existing 401/403 chain
 * without re-implementing the express response semantics.
 *
 * This is only half the check: authenticateToken also runs
 * verifyCsrfBinding(), which ties the token to the session.
 */
export function verifyCsrf(req) {
    const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
    const headerToken = presentedToken(req);

    if (!cookieToken || !headerToken) {
        return { status: 403, body: { error: 'CSRF token missing' } };
    }
    if (!sameToken(cookieToken, headerToken)) {
        return { status: 403, body: { error: 'CSRF token invalid' } };
    }
    return null;
}

/**
 * The presented token must be the one derived from THIS session
 * (csrfTokenForSession). Fails closed when the session hash is unknown.
 *
 * A rejection carries `heal`: the correct token for this session. A tab that
 * was open across the deploy that introduced binding still holds a random
 * (unbound) cookie; authenticateToken re-sets the cookie to `heal` on the 403 so
 * the client's next attempt succeeds instead of failing until a reload. Handing
 * it out is safe: it goes into a cookie only the session's own origin can read.
 *
 * @returns {null | {status: number, body: object, heal?: string}}
 */
export function verifyCsrfBinding(req) {
    if (!req.tokenHash) {
        return { status: 403, body: { error: 'CSRF token invalid' } };
    }
    const expected = csrfTokenForSession(req.tokenHash);
    if (sameToken(presentedToken(req), expected)) return null;
    return { status: 403, body: { error: 'CSRF token invalid', code: 'csrf_stale' }, heal: expected };
}
