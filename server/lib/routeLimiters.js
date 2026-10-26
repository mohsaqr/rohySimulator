// Per-user rate limiters mounted from server/routes.js (and plugins-routes.js)
// for surfaces the general limiter exempts or covers too loosely.
//
// Security audit 2026-10-26:
//   F-40 / L8-07 — the general limiter was keyed by IP, so a classroom behind
//     one NAT shared one 600/min bucket. It is now keyed by the verified user
//     (lib/requestPrincipal.js); anonymous requests keep a per-IP bucket.
//   L8-09 — the "report a problem" relay forwards to Prova, whose quota is per
//     installation: one account could spend it for everyone.
//   L8-15 — plugin server-slot routes and /plugins/:id/settings were exempt
//     from every limiter (the general one skips /plugins/ for deep-zoom).

import rateLimit from 'express-rate-limit';
import { envInt } from './concurrencyGate.js';
import { peekVerifiedPrincipal, principalKey } from './requestPrincipal.js';
import { perUserRateLimit } from '../middleware/perUserRateLimit.js';

const disabled = () => process.env.ROHY_DISABLE_GENERAL_RATE_LIMIT === '1';

/** General /api budget per signed-in user per minute. */
export const GENERAL_USER_RATE_PER_MIN = envInt('ROHY_GENERAL_USER_RATE_PER_MIN', 600);
/** General /api budget per IP per minute for requests with no valid token. */
export const GENERAL_ANON_RATE_PER_MIN = envInt('ROHY_GENERAL_ANON_RATE_PER_MIN', 1200);

/**
 * The general limiter: per verified user when the request carries a validly
 * signed token, per IP otherwise (a lab's login page shares one address, so
 * the anonymous budget is the larger one). `skip` names the paths with their
 * own limiter.
 */
export function createGeneralLimiter({ skip }) {
    return rateLimit({
        windowMs: 60 * 1000,
        limit: (req) => (peekVerifiedPrincipal(req) ? GENERAL_USER_RATE_PER_MIN : GENERAL_ANON_RATE_PER_MIN),
        keyGenerator: principalKey,
        message: { error: 'Too many requests. Please slow down.' },
        standardHeaders: true,
        legacyHeaders: false,
        skip,
    });
}

/**
 * POST /api/report — a problem report relayed to Prova (L8-09). Only reports
 * that were relayed count (a refused body spends no Prova quota); Prova's own
 * per-installation limit still applies behind this one.
 */
export const reportSubmitLimiter = perUserRateLimit({
    max: envInt('ROHY_REPORT_RATE_PER_15MIN', 20),
    skipFailedRequests: true,
    windowMs: 15 * 60 * 1000,
    message: 'Too many reports in a short time. Please wait a few minutes.',
    skip: (req) => disabled() || req.method !== 'POST',
});

/** POST /api/reports/:id/messages — writing back on a report (L8-09). */
export const reportMessageLimiter = perUserRateLimit({
    max: envInt('ROHY_REPORT_MESSAGE_RATE_PER_15MIN', 30),
    skipFailedRequests: true,
    windowMs: 15 * 60 * 1000,
    message: 'Too many messages in a short time. Please wait a few minutes.',
    skip: (req) => disabled() || req.method !== 'POST',
});

/**
 * Every /api/plugins/* request, per user (L8-15). As generous as the content
 * proxy's own limiter (2000/min) because a deep-zoom pan is hundreds of tile
 * requests in seconds; its job is to put SOME bound on the slot routes and
 * plugin settings, which had none.
 */
export const pluginSurfaceLimiter = perUserRateLimit({
    max: envInt('ROHY_PLUGIN_RATE_PER_MIN', 2000),
    windowMs: 60 * 1000,
    skip: disabled,
});

/** GET/PUT /plugins/:id/settings — a settings page, not a tile stream. */
export const pluginSettingsLimiter = perUserRateLimit({
    max: envInt('ROHY_PLUGIN_SETTINGS_RATE_PER_MIN', 120),
    windowMs: 60 * 1000,
    skip: disabled,
});
