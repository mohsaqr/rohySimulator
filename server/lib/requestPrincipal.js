// Who is this request from, BEFORE authenticateToken has run?
//
// The rate limiters in server/routes.js run ahead of every router, so
// `req.user` is not set yet when they pick a bucket. Keying them by IP alone
// put a whole classroom behind one NAT into one bucket (security audit
// 2026-10-26, F-40 / L8-07). This verifies the JWT's signature and expiry —
// the cheap, in-memory half of authenticateToken — and returns the user id it
// names, so a limiter can key by user. Nothing here authorises anything:
// revocation, the user's current role and CSRF are still checked by
// authenticateToken on the route itself. A forged token fails the signature
// check and falls back to the IP key, so it cannot buy a fresh bucket.

import jwt from 'jsonwebtoken';
import { ipKeyGenerator } from 'express-rate-limit';
import { extractToken } from '../middleware/auth.js';

const PEEKED = Symbol('rohy.peekedPrincipal');

/**
 * The verified `{ id, tenantId }` the request's bearer header or auth cookie
 * names, or null. Memoised on the request.
 */
export function peekVerifiedPrincipal(req) {
    if (req[PEEKED] !== undefined) return req[PEEKED];
    let principal = null;
    try {
        const { token } = extractToken(req);
        const secret = process.env.JWT_SECRET;
        if (token && secret) {
            const payload = jwt.verify(token, secret);
            if (payload && payload.id != null) {
                principal = { id: payload.id, tenantId: payload.tenant_id ?? 1 };
            }
        }
    } catch {
        // An invalid or expired token is simply not a principal here; the
        // route's authenticateToken answers it properly.
        principal = null;
    }
    req[PEEKED] = principal;
    return principal;
}

/** A rate-limit key: the verified user when there is one, else the IPv6-safe IP key. */
export function principalKey(req) {
    const principal = req.user?.id != null ? { id: req.user.id } : peekVerifiedPrincipal(req);
    return principal ? `user:${principal.id}` : `ip:${ipKeyGenerator(req.ip || '')}`;
}

/**
 * Middleware: refuse (401) a request that carries no validly signed token.
 * For mounting in front of a large body parser so an anonymous caller cannot
 * make the server read megabytes before authenticateToken refuses it
 * (L8-08). The route's own authenticateToken still runs afterwards.
 */
export function requireSignedToken(req, res, next) {
    if (peekVerifiedPrincipal(req)) return next();
    return res.status(401).json({ error: 'Access token required' });
}
