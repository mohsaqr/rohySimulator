/**
 * CORS configuration factory.
 *
 * Extracted from server.js so the dev-vs-prod allowlist behaviour can be
 * unit-tested without spinning up the full Express app (audit #19).
 *
 * Behaviour:
 *   - Same-origin / no-Origin requests always pass.
 *   - Development (NODE_ENV !== 'production'): every Origin is accepted.
 *     This is the dev convenience the audit flagged — pre-prod smoke
 *     should run with NODE_ENV=production to catch drift.
 *   - Production: only FRONTEND_URL + EXTRA_CORS_ORIGINS / ROHY_EXTRA_ORIGINS
 *     (comma-separated, for first-party tools such as Prova reading
 *     /api/health, or an operator's own tooling) are accepted, plus a
 *     same-origin request (Origin's host equals the Host header — the page
 *     the server itself served). Unknown origins are rejected with a warning
 *     so the rejection is observable in logs.
 *   - The static localhost origins are a DEVELOPMENT list only. They used to
 *     sit in the production allowlist too, with `credentials: true`, so any
 *     page served from http://localhost:3000 on a user's machine — another
 *     dev server, a local tool — was a trusted origin for a production
 *     instance (security audit 2026-10-26, L9/L6-15).
 */

const STATIC_DEV_ORIGINS = [
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',      // Local production
    'http://localhost:4000',      // Alternative port
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://[::1]:5173',          // IPv6 loopback - Vite dev server
    'http://[::1]:3000',          // IPv6 loopback - local production
];

// Browsers send `Origin: <scheme>://<host>[:<port>]` — never with a path.
// FRONTEND_URL is the full app URL (for example https://example.com/rohy),
// so compare against only its origin.
function toOrigin(url) {
    if (!url) return null;
    try { return new URL(url).origin; } catch { return null; }
}

// Other first-party tools that read Rohy from a browser — today Prova (test management) fetching
// /api/health to learn the running build. Comma-separated full origins in EXTRA_CORS_ORIGINS,
// set in /etc/rohy/env, so adding one needs no code change:
//   EXTRA_CORS_ORIGINS=https://prova.lacarm.com
function extraOrigins(value) {
    return String(value ?? '')
        .split(',')
        .map((entry) => toOrigin(entry.trim()))
        .filter(Boolean);
}

export function buildAllowedOrigins({ nodeEnv, frontendUrl, extraOrigins: extra, rohyExtraOrigins } = {}) {
    const devOrigins = nodeEnv === 'production' ? [] : STATIC_DEV_ORIGINS;
    return [...devOrigins, toOrigin(frontendUrl), ...extraOrigins(extra), ...extraOrigins(rohyExtraOrigins)].filter(Boolean);
}

/**
 * True when the browser's Origin names the host this request was sent to —
 * the page was served by this server, so it is not a cross-origin caller.
 *
 * @param {string|undefined} origin  the Origin header
 * @param {string|undefined} host    the Host header
 * @returns {boolean}
 */
export function isSameOrigin(origin, host) {
    if (!origin || !host) return false;
    try { return new URL(origin).host === String(host).toLowerCase(); } catch { return false; }
}

export function buildCorsOptions({ nodeEnv, frontendUrl, extraOrigins: extra, rohyExtraOrigins, logger = console } = {}) {
    const isDev = nodeEnv !== 'production';
    const allowed = buildAllowedOrigins({ nodeEnv, frontendUrl, extraOrigins: extra, rohyExtraOrigins });

    return {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (isDev) return callback(null, true);
            if (allowed.includes(origin)) {
                return callback(null, true);
            }
            logger?.warn?.(`[CORS] Blocked request from origin: ${origin}`);
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        // X-CSRF-Token is the double-submit value paired with the rohy_auth
        // cookie. Without it in the preflight allowlist, split-origin
        // cookie-auth state-changing requests get blocked by the browser
        // before reaching the CSRF middleware (F-006).
        // X-Rohy-Auth: authService's rememberToken opt-in asks for the JWT in
        // the response body (lane A, F-14); only a cross-origin caller needs
        // it in the preflight list.
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token', 'X-Rohy-Auth'],
        exposedHeaders: ['X-Request-Id'],
    };
}

/**
 * The `cors()` options delegate the server mounts: buildCorsOptions, plus the
 * same-origin pass that needs the request's Host header.
 *
 * @param {object} config  as for buildCorsOptions
 * @returns {(req: object, cb: Function) => void}
 */
export function buildCorsOptionsDelegate(config = {}) {
    const base = buildCorsOptions(config);
    return (req, callback) => {
        const origin = req.headers?.origin;
        if (isSameOrigin(origin, req.headers?.host)) return callback(null, { ...base, origin: true });
        return callback(null, base);
    };
}
