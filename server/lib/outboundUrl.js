// Where may this server be told to send a request?
//
// Several settings let a person type a URL that rohy then calls from the
// server: a custom OpenAI-compatible endpoint on an agent template, a
// per-session or per-user `llm_settings.baseUrl`, the admin "detect models"
// probe. A URL typed by a user is an instruction to the server's network
// position, so every such value passes through here before it is stored or
// fetched. The rules are the same everywhere (security audit 2026-10-24,
// findings LLM-1/LLM-2):
//
//   - http or https only (no file:, gopher:, data:);
//   - no credentials in the URL;
//   - the host may not be loopback, link-local (cloud metadata lives at
//     169.254.169.254), a private range, unspecified (0.0.0.0, ::), or a
//     bare "localhost"-style name;
//   - fetches made to such a URL use `redirect: 'manual'`, so a public host
//     cannot bounce the request to a private one.
//
// Hostnames are checked as written. A public name that resolves to a private
// address (DNS rebinding) is not caught here — that needs a resolver hook —
// so operators who need stronger isolation should run rohy in a network
// namespace without a route to internal services. ROHY_ALLOW_PRIVATE_LLM_HOSTS=1
// relaxes the host check for an on-premises model server on the LAN
// (documented in server/.env.example); the scheme and credential rules stay.

import net from 'node:net';

const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

function ipv4IsPrivate(ip) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;          // this-net, RFC1918 10/8, loopback
    if (a === 169 && b === 254) return true;                   // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;          // RFC1918 172.16/12
    if (a === 192 && b === 168) return true;                   // RFC1918 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;         // shared address space 100.64/10
    if (a >= 224) return true;                                 // multicast + reserved
    return false;
}

function ipv6IsPrivate(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;    // unique local fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);         // IPv4-mapped
    if (mapped) return ipv4IsPrivate(mapped[1]);
    return false;
}

/**
 * True when the hostname names an address this server should never be told
 * to call: loopback, link-local, RFC1918, unspecified, or a local-only name.
 * Bracketed IPv6 literals (as `URL.hostname` returns them) are accepted.
 */
export function isPrivateHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) return true;
    if (PRIVATE_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (!host.includes('.') && !host.includes(':')) return true;  // a bare single-label name is only ever a LAN host
    const kind = net.isIP(host);
    if (kind === 4) return ipv4IsPrivate(host);
    if (kind === 6) return ipv6IsPrivate(host);
    return false;
}

/**
 * Validate a URL a person typed for the server to call.
 *
 * @param {unknown} value           the URL as entered
 * @param {{ allowPrivate?: boolean }} [opts]  allowPrivate skips the host
 *   check (defaults to ROHY_ALLOW_PRIVATE_LLM_HOSTS=1)
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 *   `url` is the normalised string (trailing slash removed) to store.
 */
export function validateOutboundUrl(value, { allowPrivate = process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS === '1' } = {}) {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'URL is required' };
    const raw = value.trim();
    if (raw.length > 2048) return { ok: false, reason: 'URL is too long' };
    let url;
    try { url = new URL(raw); } catch { return { ok: false, reason: 'URL is not valid' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'URL must start with http:// or https://' };
    if (url.username || url.password) return { ok: false, reason: 'URL must not contain credentials' };
    if (!allowPrivate && isPrivateHost(url.hostname)) {
        return { ok: false, reason: 'URL must point at a public host (loopback, link-local and private addresses are refused)' };
    }
    return { ok: true, url: url.toString().replace(/\/+$/, '') };
}

/**
 * fetch() options every request to a user-supplied URL should carry: never
 * follow a redirect (the target of the redirect was not validated).
 */
export const OUTBOUND_FETCH_OPTIONS = Object.freeze({ redirect: 'manual' });
