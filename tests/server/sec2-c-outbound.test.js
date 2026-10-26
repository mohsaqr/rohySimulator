// Regression lock: security audit 2026-10-26, F-01 / L3-01 — the outbound-URL
// guard matched loopback only in its DOTTED spelling. The WHATWG parser turns
// `[::ffff:127.0.0.1]` into `[::ffff:7f00:1]`, so an educator's agent endpoint
// or session baseUrl reached 127.0.0.1; IPv4-compatible, NAT64, 6to4, Teredo,
// site-local, 198.18/15 and 192.0.0/24 were open too, and a public NAME that
// resolves to loopback was never checked at all.
//
// Every case goes THROUGH validateOutboundUrl (the parser's output, not a
// hand-written string), and the resolve-time half through secureFetch with
// dns.lookup mocked.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns';
import http from 'node:http';
import {
    ADDRESS_CLASS,
    OutboundBlockedError,
    classifyAddress,
    embeddedIpv4,
    secureFetch,
    validateOutboundUrl,
} from '../../server/lib/outboundUrl.js';

const strict = { allowPrivate: false };
const lan = { allowPrivate: true };

describe('validateOutboundUrl classifies the parsed address by its bytes', () => {
    // Regression lock: IPv4-carrying IPv6 spellings of loopback/private/metadata passed the guard (F-01)
    it.each([
        'http://[::ffff:127.0.0.1]:3000/v1',      // mapped, dotted (parser rewrites to hex)
        'http://[::ffff:7f00:1]:3000/v1',         // mapped, hex
        'http://[0:0:0:0:0:ffff:7f00:1]/',        // mapped, long form
        'http://[::ffff:0:7f00:1]/',              // SIIT-translated
        'http://[::127.0.0.1]/',                  // IPv4-compatible
        'http://[::7f00:1]/',                     // IPv4-compatible, hex
        'http://[64:ff9b::7f00:1]/',              // NAT64 well-known prefix
        'http://[64:ff9b::127.0.0.1]/',           // NAT64, dotted
        'http://[64:ff9b:1::a00:1]/',             // local-use NAT64 → 10.0.0.1
        'http://[2002:7f00:1::]/',                // 6to4 wrapping 127.0.0.1
        'http://[2002:c0a8:101::1]/',             // 6to4 wrapping 192.168.1.1
        'http://[2001::1]/',                      // Teredo
        'http://[fec0::1]/',                      // site-local
        'http://[fc00::1]/', 'http://[fdff::1]/', // ULA
        'http://[ff02::1]/',                      // multicast
        'http://198.18.0.1/', 'http://198.19.255.255/',   // benchmarking 198.18/15
        'http://192.0.0.8/',                      // IETF protocol assignments
        'http://100.64.0.1/', 'http://0.0.0.0/', 'http://240.0.0.1/', 'http://255.255.255.255/',
        'http://127.1/', 'http://0177.0.0.1/', 'http://2130706433/',
    ])('refuses %s', (url) => {
        const r = validateOutboundUrl(url, strict);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('public host');
    });

    // Regression lock: ROHY_ALLOW_PRIVATE_LLM_HOSTS=1 also unblocked link-local / cloud metadata (L3 info)
    it.each([
        'http://169.254.169.254/latest/meta-data/',
        'http://[::ffff:169.254.169.254]/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://[fe80::1]/',
        'http://[fd00:ec2::254]/',
        'http://metadata.google.internal/computeMetadata/v1/',
    ])('refuses %s even when private hosts are allowed', (url) => {
        expect(validateOutboundUrl(url, lan).ok).toBe(false);
    });

    it('still lets an operator reach a LAN model server when private hosts are allowed', () => {
        expect(validateOutboundUrl('http://10.0.0.8:11434/v1', lan)).toEqual({ ok: true, url: 'http://10.0.0.8:11434/v1' });
        expect(validateOutboundUrl('http://[::ffff:10.0.0.8]:11434/v1', lan).ok).toBe(true);
        expect(validateOutboundUrl('http://localhost:1234/v1', lan).ok).toBe(true);
    });

    it.each([
        'https://api.openai.com/v1', 'http://8.8.8.8/', 'http://[2606:4700::1111]/',
        'http://[64:ff9b::808:808]/',   // NAT64 of a public address
        'http://[2002:808:808::1]/',     // 6to4 of a public address
        'http://172.32.0.1/', 'http://198.20.0.1/',
    ])('accepts public %s', (url) => {
        expect(validateOutboundUrl(url, strict).ok).toBe(true);
    });

    it('extracts the IPv4 inside each carrying form', () => {
        expect(embeddedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
        expect(embeddedIpv4('::7f00:1')).toBe('127.0.0.1');
        expect(embeddedIpv4('64:ff9b::a9fe:a9fe')).toBe('169.254.169.254');
        expect(embeddedIpv4('2002:a00:1::')).toBe('10.0.0.1');
        expect(embeddedIpv4('::1')).toBeNull();
        expect(embeddedIpv4('2606:4700::1111')).toBeNull();
        expect(classifyAddress('::ffff:a9fe:a9fe')).toBe(ADDRESS_CLASS.METADATA);
        expect(classifyAddress('not an ip')).toBeNull();
    });
});

describe('secureFetch checks the address a name RESOLVES to', () => {
    let server;
    let port;
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            res.writeHead(req.url === '/redirect' ? 302 : 200, req.url === '/redirect' ? { Location: 'http://127.0.0.1/' } : { 'content-type': 'text/plain' });
            res.end('reached');
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        port = server.address().port;
    });
    afterAll(() => new Promise((r) => server.close(r)));
    afterEach(() => vi.restoreAllMocks());

    const loopbackLookup = (hostname, options, cb) => {
        const callback = typeof options === 'function' ? options : cb;
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
    };

    // Regression lock: a public hostname resolving to loopback (nip.io, DNS rebinding) was never checked (F-01)
    it('refuses a public name that resolves to loopback (dns.lookup mocked)', async () => {
        const spy = vi.spyOn(dns, 'lookup').mockImplementation(loopbackLookup);
        const err = await secureFetch(`http://llm.example.com:${port}/v1/models`, strict).catch((e) => e);
        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toBe('fetch failed');
        expect(err.cause).toBeInstanceOf(OutboundBlockedError);
        expect(err.cause.address).toBe('127.0.0.1');
        expect(spy).toHaveBeenCalled();
    });

    it('refuses a name resolving to the metadata address even when private hosts are allowed', async () => {
        vi.spyOn(dns, 'lookup').mockImplementation((h, o, cb) => (typeof o === 'function' ? o : cb)(null, [{ address: '169.254.169.254', family: 4 }]));
        const err = await secureFetch('http://meta.example.com/latest/', lan).catch((e) => e);
        expect(err.cause).toBeInstanceOf(OutboundBlockedError);
    });

    it('refuses when ANY resolved address is private', async () => {
        vi.spyOn(dns, 'lookup').mockImplementation((h, o, cb) => (typeof o === 'function' ? o : cb)(null, [
            { address: '93.184.216.34', family: 4 }, { address: '::ffff:7f00:1', family: 6 },
        ]));
        const err = await secureFetch(`http://mixed.example.com:${port}/`, strict).catch((e) => e);
        expect(err.cause).toBeInstanceOf(OutboundBlockedError);
    });

    it('refuses a literal private address before connecting', async () => {
        const err = await secureFetch(`http://[::ffff:127.0.0.1]:${port}/`, strict).catch((e) => e);
        expect(err.cause).toBeInstanceOf(OutboundBlockedError);
    });

    it('connects when the operator allows private hosts, and never follows a redirect', async () => {
        vi.spyOn(dns, 'lookup').mockImplementation(loopbackLookup);
        const ok = await secureFetch(`http://llm.example.com:${port}/v1`, { ...lan, method: 'POST', body: '{}' });
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe('reached');
        const redirected = await secureFetch(`http://llm.example.com:${port}/redirect`, lan);
        expect(redirected.status).toBe(302);
        expect(redirected.headers.get('location')).toBe('http://127.0.0.1/');
    });
});
