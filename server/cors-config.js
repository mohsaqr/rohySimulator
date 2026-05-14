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
 *   - Production: only origins in the static allowlist + FRONTEND_URL
 *     are accepted; unknown origins are rejected with a console warning
 *     so the rejection is observable in logs.
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

export function buildAllowedOrigins({ frontendUrl } = {}) {
    return [...STATIC_DEV_ORIGINS, toOrigin(frontendUrl)].filter(Boolean);
}

export function buildCorsOptions({ nodeEnv, frontendUrl, logger = console } = {}) {
    const isDev = nodeEnv !== 'production';
    const allowed = buildAllowedOrigins({ frontendUrl });

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
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'],
        exposedHeaders: ['X-Request-Id'],
    };
}
