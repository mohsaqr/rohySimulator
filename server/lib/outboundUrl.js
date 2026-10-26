// Where may this server be told to send a request?
//
// Several settings let a person type a URL that rohy then calls from the
// server: a custom OpenAI-compatible endpoint on an agent template, a
// per-session or per-user `llm_settings.baseUrl`, the admin "detect models"
// probe. A URL typed by a user is an instruction to the server's network
// position, so every such value passes through here before it is stored or
// fetched. The rules are the same everywhere (security audits 2026-10-24,
// findings LLM-1/LLM-2, and 2026-10-26, F-01):
//
//   - http or https only (no file:, gopher:, data:);
//   - no credentials in the URL;
//   - the host may not be loopback, link-local (cloud metadata lives at
//     169.254.169.254 and fd00:ec2::254), a private or reserved range,
//     unspecified (0.0.0.0, ::), or a bare "localhost"-style name;
//   - an IPv6 literal that CARRIES an IPv4 address (IPv4-mapped ::ffff:a.b.c.d
//     in either its dotted or its hex spelling, IPv4-compatible ::a.b.c.d,
//     NAT64 64:ff9b::/96 and 64:ff9b:1::/48, 6to4 2002::/16) is judged by the
//     IPv4 address inside it. The WHATWG parser rewrites `[::ffff:127.0.0.1]`
//     to `[::ffff:7f00:1]`, which a string match on the dotted form missed
//     (F-01): the address is classified from its BYTES, never its spelling;
//   - a hostname is checked again when it is RESOLVED: `secureFetch` connects
//     through a lookup hook that refuses a name whose address is private, so
//     a public name pointing at 127.0.0.1 (nip.io, DNS rebinding) is caught at
//     the moment of connection, on the address actually dialled;
//   - fetches made to such a URL never follow a redirect, so a public host
//     cannot bounce the request to a private one.
//
// ROHY_ALLOW_PRIVATE_LLM_HOSTS=1 relaxes the host check for an on-premises
// model server on the LAN (documented in server/.env.example); the scheme and
// credential rules stay, and link-local / cloud-metadata addresses stay
// refused even then — no LAN model server lives at 169.254.169.254.

import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
// Names that resolve to an instance-metadata service on the big clouds.
// Refused even when private hosts are allowed.
const METADATA_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog', 'metadata', 'instance-data', 'instance-data.ec2.internal']);

/** An address class: where a request to this address would land. */
export const ADDRESS_CLASS = Object.freeze({
    PUBLIC: 'public',
    PRIVATE: 'private',      // loopback, RFC1918, ULA, reserved, multicast …
    METADATA: 'metadata',    // link-local / cloud metadata: never, even on a LAN install
});

function buildIpv4BlockList() {
    const list = new net.BlockList();
    [
        ['0.0.0.0', 8],          // "this" network
        ['10.0.0.0', 8],         // RFC1918
        ['100.64.0.0', 10],      // shared address space (CGNAT)
        ['127.0.0.0', 8],        // loopback
        ['172.16.0.0', 12],      // RFC1918
        ['192.0.0.0', 24],       // IETF protocol assignments
        ['192.0.2.0', 24],       // TEST-NET-1
        ['192.88.99.0', 24],     // 6to4 relay anycast
        ['192.168.0.0', 16],     // RFC1918
        ['198.18.0.0', 15],      // benchmarking
        ['198.51.100.0', 24],    // TEST-NET-2
        ['203.0.113.0', 24],     // TEST-NET-3
        ['224.0.0.0', 4],        // multicast
        ['240.0.0.0', 4],        // reserved (includes 255.255.255.255)
    ].forEach(([address, prefix]) => list.addSubnet(address, prefix, 'ipv4'));
    return list;
}

function buildIpv6BlockList() {
    const list = new net.BlockList();
    [
        ['::', 128],             // unspecified
        ['::1', 128],            // loopback
        ['100::', 64],           // discard-only
        ['2001::', 32],          // Teredo (the IPv4 inside is obfuscated; refuse the range)
        ['2001:db8::', 32],      // documentation
        ['fc00::', 7],           // unique local
        ['fec0::', 10],          // site-local (deprecated, still routed by some stacks)
        ['ff00::', 8],           // multicast
    ].forEach(([address, prefix]) => list.addSubnet(address, prefix, 'ipv6'));
    return list;
}

const IPV4_PRIVATE = buildIpv4BlockList();
const IPV6_PRIVATE = buildIpv6BlockList();
const IPV4_METADATA = (() => { const l = new net.BlockList(); l.addSubnet('169.254.0.0', 16, 'ipv4'); return l; })();
const IPV6_METADATA = (() => {
    const l = new net.BlockList();
    l.addSubnet('fe80::', 10, 'ipv6');            // link-local
    l.addAddress('fd00:ec2::254', 'ipv6');        // AWS IMDS over IPv6
    return l;
})();

/** Parse an IPv6 literal (net.isIP === 6) into its 16 bytes. */
function ipv6Bytes(ip) {
    let text = ip.split('%')[0];                  // drop a zone id
    const bytes = new Array(16).fill(0);
    // A trailing dotted IPv4 (::ffff:1.2.3.4) is the last 4 bytes.
    let tail = [];
    const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        tail = dotted[2].split('.').map(Number);
        text = `${dotted[1]}0:0`;
    }
    const [head, rest] = text.includes('::') ? text.split('::') : [text, null];
    const headGroups = head ? head.split(':') : [];
    const restGroups = rest === null ? [] : (rest ? rest.split(':') : []);
    const groups = rest === null
        ? headGroups
        : [...headGroups, ...new Array(8 - headGroups.length - restGroups.length).fill('0'), ...restGroups];
    groups.forEach((g, i) => {
        const v = parseInt(g || '0', 16);
        bytes[i * 2] = (v >> 8) & 0xff;
        bytes[i * 2 + 1] = v & 0xff;
    });
    if (tail.length === 4) tail.forEach((b, i) => { bytes[12 + i] = b; });
    return bytes;
}

const allZero = (bytes, from, to) => bytes.slice(from, to).every((b) => b === 0);
const v4 = (bytes, at) => bytes.slice(at, at + 4).join('.');

/**
 * The IPv4 address an IPv6 address stands for, when it is one of the
 * IPv4-carrying forms; null otherwise.
 */
export function embeddedIpv4(ip) {
    if (net.isIP(ip) !== 6) return null;
    const b = ipv6Bytes(ip);
    // ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (SIIT translated)
    if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(b, 12);
    if (allZero(b, 0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return v4(b, 12);
    // ::a.b.c.d (IPv4-compatible, deprecated) — but not :: or ::1
    if (allZero(b, 0, 12) && !(allZero(b, 12, 15) && b[15] <= 1)) return v4(b, 12);
    // 64:ff9b::/96 (NAT64 well-known) and 64:ff9b:1::/48 (local-use NAT64)
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
        if (allZero(b, 4, 12)) return v4(b, 12);
        if (b[4] === 0x00 && b[5] === 0x01) return v4(b, 12);
    }
    // 2002:aabb:ccdd::/48 (6to4)
    if (b[0] === 0x20 && b[1] === 0x02) return v4(b, 2);
    return null;
}

/**
 * Classify an IP address by its bytes. Not an IP → null.
 * @returns {'public'|'private'|'metadata'|null}
 */
export function classifyAddress(address) {
    const ip = String(address || '').trim().replace(/^\[|\]$/g, '');
    const kind = net.isIP(ip);
    if (kind === 4) {
        if (IPV4_METADATA.check(ip, 'ipv4')) return ADDRESS_CLASS.METADATA;
        if (IPV4_PRIVATE.check(ip, 'ipv4')) return ADDRESS_CLASS.PRIVATE;
        return ADDRESS_CLASS.PUBLIC;
    }
    if (kind === 6) {
        const inner = embeddedIpv4(ip);
        if (inner) {
            const innerClass = classifyAddress(inner);
            // 2002::/16 wrapping a public v4 is a public 6to4 address; any
            // wrapper around a non-public v4 takes the inner class.
            return innerClass;
        }
        const bare = ip.split('%')[0];
        if (IPV6_METADATA.check(bare, 'ipv6')) return ADDRESS_CLASS.METADATA;
        if (IPV6_PRIVATE.check(bare, 'ipv6')) return ADDRESS_CLASS.PRIVATE;
        return ADDRESS_CLASS.PUBLIC;
    }
    return null;
}

function normaliseHost(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Classify a hostname as written (no DNS). A name that is not an IP literal
 * and not a local-only name is 'public' here; secureFetch checks what it
 * resolves to.
 */
export function classifyHost(hostname) {
    const host = normaliseHost(hostname);
    if (!host) return ADDRESS_CLASS.PRIVATE;
    if (METADATA_HOSTNAMES.has(host)) return ADDRESS_CLASS.METADATA;
    const ipClass = classifyAddress(host);
    if (ipClass) return ipClass;
    if (PRIVATE_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return ADDRESS_CLASS.PRIVATE;
    }
    if (!host.includes('.')) return ADDRESS_CLASS.PRIVATE;   // a bare single-label name is only ever a LAN host
    return ADDRESS_CLASS.PUBLIC;
}

/**
 * True when the hostname names an address this server should never be told
 * to call: loopback, link-local, RFC1918, reserved, unspecified, an
 * IPv4-carrying IPv6 form of one of those, or a local-only name.
 * Bracketed IPv6 literals (as `URL.hostname` returns them) are accepted.
 */
export function isPrivateHost(hostname) {
    return classifyHost(hostname) !== ADDRESS_CLASS.PUBLIC;
}

/** May a request go to an address of this class? */
function classAllowed(cls, allowPrivate) {
    if (cls === ADDRESS_CLASS.PUBLIC) return true;
    if (cls === ADDRESS_CLASS.PRIVATE) return allowPrivate;
    return false;   // metadata: never
}

const allowPrivateDefault = () => process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS === '1';

/**
 * Validate a URL a person typed for the server to call.
 *
 * @param {unknown} value           the URL as entered
 * @param {{ allowPrivate?: boolean }} [opts]  allowPrivate admits private
 *   (LAN) hosts, never link-local / metadata ones (defaults to
 *   ROHY_ALLOW_PRIVATE_LLM_HOSTS=1)
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 *   `url` is the normalised string (trailing slash removed) to store.
 */
export function validateOutboundUrl(value, { allowPrivate = allowPrivateDefault() } = {}) {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'URL is required' };
    const raw = value.trim();
    if (raw.length > 2048) return { ok: false, reason: 'URL is too long' };
    let url;
    try { url = new URL(raw); } catch { return { ok: false, reason: 'URL is not valid' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'URL must start with http:// or https://' };
    if (url.username || url.password) return { ok: false, reason: 'URL must not contain credentials' };
    if (!classAllowed(classifyHost(url.hostname), allowPrivate)) {
        return { ok: false, reason: 'URL must point at a public host (loopback, link-local and private addresses are refused)' };
    }
    return { ok: true, url: url.toString().replace(/\/+$/, '') };
}

/**
 * fetch() options every request to a user-supplied URL should carry: never
 * follow a redirect (the target of the redirect was not validated).
 */
export const OUTBOUND_FETCH_OPTIONS = Object.freeze({ redirect: 'manual' });

/** Thrown (as the cause of a 'fetch failed' TypeError) when a destination is refused. */
export class OutboundBlockedError extends Error {
    constructor(message, { host = null, address = null } = {}) {
        super(message);
        this.name = 'OutboundBlockedError';
        this.code = 'OUTBOUND_BLOCKED';
        this.host = host;
        this.address = address;
    }
}

/**
 * A `lookup` for net/http that resolves the name and refuses it when ANY of
 * its addresses is not allowed — the connection is then made to the address
 * that was checked, so there is no window between check and connect.
 * `resolver` is injectable for tests (defaults to dns.lookup).
 */
export function guardedLookup({ allowPrivate = allowPrivateDefault(), resolver = dns.lookup } = {}) {
    return function lookup(hostname, options, callback) {
        const cb = typeof options === 'function' ? options : callback;
        const opts = typeof options === 'object' && options !== null ? options : {};
        resolver(hostname, { ...opts, all: true }, (err, addresses) => {
            if (err) return cb(err);
            const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || net.isIP(addresses) }];
            if (list.length === 0) return cb(new OutboundBlockedError(`${hostname} did not resolve`, { host: hostname }));
            const refused = list.find((a) => !classAllowed(classifyAddress(a.address), allowPrivate));
            if (refused) {
                return cb(new OutboundBlockedError(`${hostname} resolves to a refused address`, { host: hostname, address: refused.address }));
            }
            if (opts.all) return cb(null, list);
            return cb(null, list[0].address, list[0].family || net.isIP(list[0].address));
        });
    };
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * fetch() for a URL a person typed. Same shape as global fetch (returns a
 * WHATWG Response) but:
 *   - the URL must pass validateOutboundUrl (scheme, credentials, literal host);
 *   - the hostname is resolved through guardedLookup, so a public name that
 *     resolves to a private or metadata address is refused at connect time;
 *   - redirects are never followed (a 3xx comes back as the response);
 *   - the body is not decompressed (`accept-encoding: identity` is sent).
 * A refused destination or a network failure rejects with
 * `TypeError('fetch failed')` whose `cause` is the underlying error
 * (OutboundBlockedError for a refusal), matching global fetch's contract so
 * callers' existing `fetch failed` handling still applies.
 *
 * @param {string} input
 * @param {{ method?: string, headers?: Record<string,string>, body?: string|Buffer|Uint8Array, signal?: AbortSignal,
 *           allowPrivate?: boolean, resolver?: Function }} [init]
 * @returns {Promise<Response>}
 */
export function secureFetch(input, init = {}) {
    const allowPrivate = init.allowPrivate ?? allowPrivateDefault();
    const checked = validateOutboundUrl(String(input), { allowPrivate });
    if (!checked.ok) {
        return Promise.reject(new TypeError('fetch failed', { cause: new OutboundBlockedError(checked.reason, { host: safeHost(input) }) }));
    }
    const url = new URL(String(input));
    const transport = url.protocol === 'https:' ? https : http;
    const headers = { ...(init.headers || {}) };
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept-encoding')) headers['accept-encoding'] = 'identity';
    const body = init.body == null ? null : (typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.from(init.body));
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) headers['content-length'] = String(body.length);

    return new Promise((resolve, reject) => {
        if (init.signal?.aborted) {
            reject(init.signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
            return;
        }
        const req = transport.request(url, {
            method: init.method || 'GET',
            headers,
            agent: false,                // no pooled socket: every connection goes through the lookup
            lookup: guardedLookup({ allowPrivate, resolver: init.resolver }),
            signal: init.signal,
            servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        }, (res) => {
            const responseHeaders = new Headers();
            Object.entries(res.headers).forEach(([k, v]) => {
                if (Array.isArray(v)) v.forEach((item) => responseHeaders.append(k, item));
                else if (v !== undefined) responseHeaders.set(k, String(v));
            });
            const status = res.statusCode || 502;
            const nullBody = NULL_BODY_STATUSES.has(status) || (init.method || 'GET').toUpperCase() === 'HEAD';
            if (nullBody) res.resume();
            try {
                resolve(new Response(nullBody ? null : Readable.toWeb(res), {
                    status: status < 200 || status > 599 ? 502 : status,
                    statusText: res.statusMessage || '',
                    headers: responseHeaders,
                }));
            } catch (err) {
                res.destroy();
                reject(new TypeError('fetch failed', { cause: err }));
            }
        });
        req.on('error', (err) => {
            if (err?.name === 'AbortError' && init.signal?.aborted) {
                reject(init.signal.reason ?? err);
                return;
            }
            reject(new TypeError('fetch failed', { cause: err }));
        });
        if (body) req.write(body);
        req.end();
    });
}

function safeHost(input) {
    try { return new URL(String(input)).hostname; } catch { return null; }
}
