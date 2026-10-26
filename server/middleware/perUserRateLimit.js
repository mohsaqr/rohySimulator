// Per-USER rate limiter for routes that fan out to third-party APIs.
//
// The global limiter in server/routes.js is per IP and generous (600/min)
// because it protects the process, not an upstream. The catalogue search
// proxies (RxNorm, openFDA, Clinical Tables) turn one request into up to
// 1 + ENRICH_CAP upstream calls, so a single authenticated user can burn
// the shared upstream quota — and NAT'd campuses share one IP, so a per-IP
// cap would punish the wrong people. This limiter keys on the authenticated
// user id (mount it AFTER authenticateToken; an unauthenticated request
// falls back to the IPv6-safe ip key so it can never be unlimited).
//
// Same express-rate-limit mechanism as every other limiter in the tree; the
// 429 body is the standard `{ error, code }` shape apiClient.js reads.

import rateLimit from 'express-rate-limit';
import { principalKey } from '../lib/requestPrincipal.js';

export const RATE_LIMITED_CODE = 'RATE_LIMITED';

/**
 * @param {object} opts
 * @param {number} opts.max        requests per window per user
 * @param {number} [opts.windowMs] window length (default 60 s)
 * @param {string} [opts.message]  human-readable error text
 * @param {(req) => boolean} [opts.skip]  requests that bypass the limiter
 * @param {boolean} [opts.skipFailedRequests]  do not count requests answered >= 400
 *
 * The key is `req.user.id` when authenticateToken has already run, else the
 * user a validly signed token names (lib/requestPrincipal.js), else the IP —
 * so the limiter is per user even when it is mounted ahead of the router.
 */
export function perUserRateLimit({ max, windowMs = 60 * 1000, message = 'Too many requests. Please slow down.', skip, skipFailedRequests = false }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: principalKey,
        ...(skip ? { skip } : {}),
        ...(skipFailedRequests ? { skipFailedRequests: true } : {}),
        handler: (req, res) => res.status(429).json({ error: message, code: RATE_LIMITED_CODE }),
    });
}
