/**
 * Security headers middleware.
 *
 * Sets a Content-Security-Policy and a small set of accompanying defensive
 * headers on every response. The audit ("Things the audit itself missed")
 * flagged that no CSP was set anywhere — meaning a future agent template
 * rendered as HTML, or any injected diagnostic-bar metadata, could ride a
 * stored-XSS into prod.
 *
 * Policy choices:
 *   - default-src 'self'  — no third-party origins by default.
 *   - img-src 'self' data: blob: — case authors paste in data: URIs and the
 *     TTS audition path uses blob: URLs.
 *   - media-src 'self' blob: — TTS playback uses blob URLs from
 *     URL.createObjectURL().
 *   - style-src 'self' 'unsafe-inline' — Tailwind ships utility classes,
 *     and a few inline styles slip in via the Three.js renderer. Tightening
 *     to nonces is a follow-up; 'unsafe-inline' on style is a much smaller
 *     XSS vector than on script.
 *   - script-src 'self' — NO 'unsafe-inline' or 'unsafe-eval' in production.
 *     Vite dev injects an eval-using HMR client, so dev mode adds 'unsafe-eval'.
 *   - connect-src 'self' — same-origin only. The cookie-mode auth + CSRF
 *     setup assumes this; loosening it would also weaken CSRF.
 *   - frame-ancestors 'none' — prevents clickjacking.
 *
 * Other headers:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (legacy backstop for browsers that ignore CSP
 *     frame-ancestors)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - X-XSS-Protection: 0  (modern browsers ignore the legacy filter; we
 *     explicitly disable it because it has known bypass-then-reflect bugs)
 */

export function buildCsp({ nodeEnv } = {}) {
    const isDev = nodeEnv !== 'production';
    const scriptSrc = isDev
        ? "'self' 'unsafe-eval' 'unsafe-inline'"   // Vite HMR + React refresh
        : "'self'";
    const directives = [
        `default-src 'self'`,
        `script-src ${scriptSrc}`,
        `style-src 'self' 'unsafe-inline'`,
        // img-src AND connect-src must both allow blob: + data: because
        // Three.js / @react-three/drei's useGLTF unpacks embedded GLB
        // textures by extracting the binary chunk → Blob →
        // URL.createObjectURL() → either an Image element (img-src) OR a
        // fetch() to read the blob bytes back (connect-src). Without
        // blob: on connect-src, every embedded-texture avatar renders as
        // a flat-shaded white model — symptom seen 2026-05-07. Reverting
        // these allowances will reproduce.
        `img-src 'self' data: blob:`,
        `media-src 'self' blob:`,
        `font-src 'self' data:`,
        `connect-src 'self' blob: data:`,
        `worker-src 'self' blob:`,
        `frame-ancestors 'none'`,
        `form-action 'self'`,
        `base-uri 'self'`,
        `object-src 'none'`,
    ];
    return directives.join('; ');
}

export function securityHeaders({ nodeEnv } = {}) {
    const csp = buildCsp({ nodeEnv });
    return (req, res, next) => {
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader(
            'Permissions-Policy',
            // Allow microphone (press-to-talk) and camera (avatar config)
            // only on same origin. Block geolocation, payment, USB, etc.
            'microphone=(self), camera=(self), geolocation=(), payment=(), usb=()'
        );
        next();
    };
}
