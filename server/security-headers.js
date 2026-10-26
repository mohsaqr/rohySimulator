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
    // 'wasm-unsafe-eval' (production): the OyonCaptureWidget pill instantiates
    // ONNX Runtime + MediaPipe Vision wasm modules in the SPA context. Without
    // this directive the browser refuses WebAssembly.instantiate() with the
    // "violates 'script-src self'" CompileError. The token is a targeted relax
    // of 'unsafe-eval' — it ALLOWS WebAssembly compilation but NOT eval()/new
    // Function(), so it doesn't widen the XSS surface like full 'unsafe-eval'
    // would. Supported in Chrome ≥91, Safari ≥15.4, Firefox ≥89 — well under
    // the rohy floor. The standalone iframe at /oyon/standalone/ has its own
    // CSP set by allowOyonFrame in server.js and is unaffected.
    const scriptSrc = isDev
        ? "'self' 'unsafe-eval' 'unsafe-inline'"   // Vite HMR + React refresh
        : "'self' 'wasm-unsafe-eval'";
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
        // Explicit rather than inherited from default-src (L5-05): the lesson
        // embed and video iframes are sandboxed, and this states in one place
        // that no third-party document can be framed into the app. Loosening
        // it for video hosts must come with a host allowlist in
        // VideoNodeView/EmbedNodeView, not instead of one.
        `frame-src 'self'`,
        `frame-ancestors 'none'`,
        `form-action 'self'`,
        `base-uri 'self'`,
        `object-src 'none'`,
    ];
    return directives.join('; ');
}

// HSTS (L6-15): the app sent none — only the Docker Caddyfile did, so the
// cloudflared and nginx paths relied on an edge setting nobody could see.
// Sent only in production and only when the request arrived over HTTPS
// through a TRUSTED proxy (req.secure is derived from X-Forwarded-Proto under
// `trust proxy`, and the socket itself is plain HTTP). The direct TLS listener
// (TLS_CERT_PATH) is left out on purpose: that is the self-signed LAN path
// (scripts/gen-self-signed-tls.sh), and HSTS on a self-signed host removes
// the browser's click-through for the whole max-age. Short max-age, no
// includeSubDomains, no preload: easy to back out. ROHY_HSTS_MAX_AGE=0 turns
// it off; any other integer replaces the default.
export const DEFAULT_HSTS_MAX_AGE = 86_400;

export function hstsHeaderValue(env = process.env) {
    const raw = env.ROHY_HSTS_MAX_AGE;
    let maxAge = DEFAULT_HSTS_MAX_AGE;
    if (raw != null && String(raw).trim() !== '') {
        const parsed = Number(String(raw).trim());
        if (Number.isInteger(parsed) && parsed >= 0) maxAge = parsed;
    }
    return maxAge > 0 ? `max-age=${maxAge}` : null;
}

export function shouldSendHsts(req, { nodeEnv } = {}) {
    if (nodeEnv !== 'production') return false;
    if (!req?.secure) return false;
    // Proxy-terminated TLS only: an encrypted socket means our own listener.
    return !req.socket?.encrypted;
}

export function securityHeaders({ nodeEnv, env = process.env } = {}) {
    const csp = buildCsp({ nodeEnv });
    const hsts = hstsHeaderValue(env);
    return (req, res, next) => {
        if (hsts && shouldSendHsts(req, { nodeEnv })) res.setHeader('Strict-Transport-Security', hsts);
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
        // Cross-origin isolation: required so SharedArrayBuffer becomes
        // available, which lets ONNX Runtime Web run multi-threaded WASM
        // inference for the Oyon emotion classifier. Without this, the
        // browser silently drops ORT into single-threaded mode and each
        // inference takes seconds instead of ~50–150ms — the "pill is
        // lagging" symptom we hit in the May 9 session.
        //   COOP=same-origin: any window opened from us is in our agent
        //     cluster only.
        //   COEP=credentialless: third-party subresources (fonts, images
        //     proxied from Rohy) load without credentials but DON'T need
        //     a CORP header — strictly less invasive than require-corp,
        //     so Three.js GLB textures and TTS blobs keep working.
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        next();
    };
}
