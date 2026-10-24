// Regression lock: security audit 2026-10-24 (LLM-1/LLM-2) — a user-typed
// URL the server will call must be http(s), carry no credentials, and never
// name a loopback / link-local / private host.
import { describe, it, expect } from 'vitest';
import { isPrivateHost, validateOutboundUrl, OUTBOUND_FETCH_OPTIONS } from '../../server/lib/outboundUrl.js';

describe('isPrivateHost', () => {
    it.each([
        'localhost', 'LOCALHOST', 'localhost.', 'foo.localhost', 'printer.local', 'db.internal', 'rohy',
        '127.0.0.1', '127.9.9.9', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
        '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
        '::1', '::', '[::1]', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3',
    ])('%s is private', (host) => {
        expect(isPrivateHost(host)).toBe(true);
    });

    it.each([
        'api.openai.com', 'example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.167.0.1', '2606:4700::1111', '[2606:4700::1111]',
    ])('%s is public', (host) => {
        expect(isPrivateHost(host)).toBe(false);
    });
});

describe('validateOutboundUrl', () => {
    const noPrivate = { allowPrivate: false };

    it('accepts a public https base URL and strips the trailing slash', () => {
        expect(validateOutboundUrl('https://api.example.com/v1/', noPrivate)).toEqual({ ok: true, url: 'https://api.example.com/v1' });
        expect(validateOutboundUrl('http://llm.example.edu:8000/v1', noPrivate)).toEqual({ ok: true, url: 'http://llm.example.edu:8000/v1' });
    });

    it.each([
        ['', 'required'],
        [null, 'required'],
        [42, 'required'],
        ['not a url', 'not valid'],
        ['ftp://example.com/', 'http:// or https://'],
        ['file:///etc/passwd', 'http:// or https://'],
        ['javascript:alert(1)', 'http:// or https://'],
        ['https://user:pw@example.com/v1', 'credentials'],
        ['http://127.0.0.1:3000/api', 'public host'],
        ['http://localhost:11434/v1', 'public host'],
        ['http://169.254.169.254/latest/meta-data/', 'public host'],
        ['http://[::1]:3000/', 'public host'],
        ['http://10.0.0.8/v1', 'public host'],
        ['http://0x7f000001/', 'public host'],       // WHATWG normalises to 127.0.0.1
        ['http://2130706433/', 'public host'],       // decimal 127.0.0.1
        ['https://' + 'a'.repeat(2100) + '.com', 'too long'],
    ])('refuses %j', (value, reason) => {
        const r = validateOutboundUrl(value, noPrivate);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain(reason);
    });

    it('lets an operator opt in to private hosts, but never to a bad scheme or credentials', () => {
        expect(validateOutboundUrl('http://10.0.0.8:11434/v1', { allowPrivate: true })).toEqual({ ok: true, url: 'http://10.0.0.8:11434/v1' });
        expect(validateOutboundUrl('ftp://10.0.0.8/', { allowPrivate: true }).ok).toBe(false);
        expect(validateOutboundUrl('http://a:b@10.0.0.8/', { allowPrivate: true }).ok).toBe(false);
    });

    it('defaults allowPrivate from ROHY_ALLOW_PRIVATE_LLM_HOSTS', () => {
        const prev = process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS;
        try {
            process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS = '1';
            expect(validateOutboundUrl('http://localhost:11434/v1').ok).toBe(true);
            delete process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS;
            expect(validateOutboundUrl('http://localhost:11434/v1').ok).toBe(false);
        } finally {
            if (prev === undefined) delete process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS; else process.env.ROHY_ALLOW_PRIVATE_LLM_HOSTS = prev;
        }
    });

    it('never follows redirects from a user-supplied URL', () => {
        expect(OUTBOUND_FETCH_OPTIONS.redirect).toBe('manual');
        expect(Object.isFrozen(OUTBOUND_FETCH_OPTIONS)).toBe(true);
    });
});
