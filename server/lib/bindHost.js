/**
 * The interface the HTTP(S) listeners bind to.
 *
 * ROHY_BIND always wins. Without it, production binds loopback (127.0.0.1)
 * and everything else binds 0.0.0.0. Production deployments put a proxy on
 * the same host (cloudflared, nginx, Caddy) or set ROHY_BIND explicitly (the
 * Docker image and compose.yml set 0.0.0.0, because there the proxy is a
 * separate container). The old 0.0.0.0 default in production exposed the
 * plain-HTTP port to the LAN next to the proxy (security audit 2026-10-26).
 *
 * @param {object} [env=process.env]
 * @returns {string} the host to pass to listen()
 */
export function resolveBindHost(env = process.env) {
    const explicit = typeof env.ROHY_BIND === 'string' ? env.ROHY_BIND.trim() : '';
    if (explicit) return explicit;
    return env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';
}
