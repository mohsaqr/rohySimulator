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

export const CSRF_COOKIE_NAME = 'rohy_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function generateCsrfToken() {
    // 32 bytes base64url → 43 chars. Plenty of entropy to defeat guessing
    // and short enough to fit comfortably in a cookie + header pair.
    return crypto.randomBytes(32).toString('base64url');
}

export function csrfCookieOptions(maxAgeSeconds = 4 * 60 * 60) {
    return {
        // CRUCIAL: this cookie is NOT HttpOnly — client JS reads it to
        // populate the X-CSRF-Token header. The auth cookie next to it
        // (rohy_auth) IS HttpOnly; this one is the public half of the
        // double-submit pair.
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
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

/**
 * Verify the double-submit pair on a cookie-auth state-changing request.
 *
 * Returns null on success, or { status, body } on rejection — caller writes
 * the response. Splitting the verdict from the response lets callers (e.g.
 * authenticateToken) integrate this into their existing 401/403 chain
 * without re-implementing the express response semantics.
 */
export function verifyCsrf(req) {
    const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
    const headerValue = req.headers?.[CSRF_HEADER_NAME];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!cookieToken || !headerToken) {
        return { status: 403, body: { error: 'CSRF token missing' } };
    }
    if (cookieToken.length !== headerToken.length) {
        return { status: 403, body: { error: 'CSRF token invalid' } };
    }
    let ok = false;
    try {
        ok = crypto.timingSafeEqual(
            Buffer.from(cookieToken),
            Buffer.from(headerToken),
        );
    } catch {
        // Buffer.from() can throw on non-UTF-8 input — treat as mismatch.
        ok = false;
    }
    if (!ok) {
        return { status: 403, body: { error: 'CSRF token invalid' } };
    }
    return null;
}
