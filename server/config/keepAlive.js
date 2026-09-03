// HTTP keep-alive timeouts for the listeners in server.js.
//
// Rohy sits behind a connection-pooling proxy in production: cloudflared
// (ingress rule → http://localhost:4000) keeps idle origin sockets for 90 s
// by default. Node's http.Server closes an idle keep-alive socket after
// 5 s. Whenever the proxy reused a socket node had just closed, the request
// got a TCP RST before Express ever saw it, and Cloudflare turned that into
// a 502 "Bad gateway" page — a lost chat message, once every few hours of
// use (2026-09-03 incident, eight resets in 14 days).
//
// The rule is that the upstream must outlive the proxy's pool:
//   keepAliveTimeout  > proxy idle timeout   (95 s > cloudflared's 90 s)
//   headersTimeout    > keepAliveTimeout     (node reintroduces the race
//                                             when this ordering is wrong)
// Nginx-fronted or bare deployments only gain from the longer idle window.

/** Proxy-side idle timeout we must outlive (cloudflared default). */
export const PROXY_IDLE_TIMEOUT_MS = 90_000;

/** How long node keeps an idle keep-alive socket open. */
export const KEEP_ALIVE_TIMEOUT_MS = 95_000;

/** Upper bound on receiving a request's headers; must exceed keep-alive. */
export const HEADERS_TIMEOUT_MS = 96_000;

/**
 * Apply the keep-alive timeouts to an http/https server.
 *
 * @param {import('node:http').Server} server
 * @returns {import('node:http').Server} the same server, for chaining
 */
export function applyKeepAliveTimeouts(server) {
    if (!server || typeof server.listen !== 'function') {
        throw new TypeError('applyKeepAliveTimeouts expects an http.Server');
    }
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    return server;
}
