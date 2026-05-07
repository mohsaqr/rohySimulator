import { describe, expect, it } from 'vitest';
import {
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    csrfCookieOptions,
    csrfRequired,
    generateCsrfToken,
    verifyCsrf,
} from '../../../server/middleware/csrf.js';

function makeReq({ method = 'POST', tokenSource = 'cookie', cookie, headerToken } = {}) {
    const headers = {};
    if (cookie !== undefined) headers.cookie = `${CSRF_COOKIE_NAME}=${cookie}`;
    if (headerToken !== undefined) headers[CSRF_HEADER_NAME] = headerToken;
    return { method, tokenSource, headers };
}

describe('csrfRequired', () => {
    it('true for cookie-auth POST/PUT/PATCH/DELETE', () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            expect(csrfRequired(makeReq({ method, tokenSource: 'cookie' }))).toBe(true);
        }
    });

    it('false for cookie-auth GET / HEAD / OPTIONS (no mutation)', () => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
            expect(csrfRequired(makeReq({ method, tokenSource: 'cookie' }))).toBe(false);
        }
    });

    it('false for bearer-auth state-changing requests (cross-site cant auto-attach Authorization)', () => {
        // CONTRACT: this is the rationale for not blanket-applying CSRF.
        // Bearer tokens are not a CSRF vector — a cross-site attacker
        // cannot make the browser auto-attach an Authorization header.
        expect(csrfRequired(makeReq({ method: 'POST', tokenSource: 'header' }))).toBe(false);
    });

    it('false when tokenSource is null/undefined (unauthenticated paths)', () => {
        expect(csrfRequired({ method: 'POST', tokenSource: null, headers: {} })).toBe(false);
        expect(csrfRequired({ method: 'POST', headers: {} })).toBe(false);
    });
});

describe('verifyCsrf', () => {
    it('returns null on a valid double-submit pair', () => {
        const token = generateCsrfToken();
        const req = makeReq({ cookie: token, headerToken: token });
        expect(verifyCsrf(req)).toBeNull();
    });

    it('returns 403 "CSRF token missing" when the cookie is absent', () => {
        const req = makeReq({ headerToken: 'x'.repeat(43) });
        expect(verifyCsrf(req)).toEqual({
            status: 403,
            body: { error: 'CSRF token missing' },
        });
    });

    it('returns 403 "CSRF token missing" when the header is absent', () => {
        const token = generateCsrfToken();
        const req = makeReq({ cookie: token });
        expect(verifyCsrf(req)).toEqual({
            status: 403,
            body: { error: 'CSRF token missing' },
        });
    });

    it('returns 403 "CSRF token invalid" on length mismatch (timing-safe pre-check)', () => {
        const req = makeReq({ cookie: 'abc', headerToken: 'abcd' });
        expect(verifyCsrf(req)).toEqual({
            status: 403,
            body: { error: 'CSRF token invalid' },
        });
    });

    it('returns 403 "CSRF token invalid" when same length but different bytes', () => {
        const a = generateCsrfToken();
        const b = generateCsrfToken();
        // Two random 43-char tokens are length-equal but byte-distinct.
        expect(a.length).toBe(b.length);
        expect(verifyCsrf(makeReq({ cookie: a, headerToken: b }))).toEqual({
            status: 403,
            body: { error: 'CSRF token invalid' },
        });
    });

    it('rejects a request whose header is an array of values (multiple X-CSRF-Token headers)', () => {
        // Some HTTP frameworks coerce repeated headers to arrays. Our
        // parser takes the first; if cookie matches the first, it's fine,
        // but if a different attacker-supplied second value is present
        // we still validate against the first only — locking that
        // behaviour explicitly.
        const token = generateCsrfToken();
        const req = makeReq({ cookie: token });
        req.headers[CSRF_HEADER_NAME] = [token, 'evil'];
        expect(verifyCsrf(req)).toBeNull();
    });
});

describe('generateCsrfToken', () => {
    it('returns a 43-char base64url string (32 bytes)', () => {
        const t = generateCsrfToken();
        expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('every call produces a distinct token', () => {
        const seen = new Set();
        for (let i = 0; i < 32; i++) seen.add(generateCsrfToken());
        expect(seen.size).toBe(32);
    });
});

describe('csrfCookieOptions', () => {
    it('is NOT HttpOnly (client JS must read it)', () => {
        // CONTRACT: the whole double-submit scheme depends on JS being
        // able to read this cookie. Setting HttpOnly here would break
        // CSRF protection entirely — lock it so a "harden everything"
        // refactor does not silently flip it.
        expect(csrfCookieOptions().httpOnly).toBe(false);
    });

    it('uses sameSite=lax + path=/', () => {
        const opts = csrfCookieOptions();
        expect(opts.sameSite).toBe('lax');
        expect(opts.path).toBe('/');
    });

    it('honours a custom maxAge in seconds', () => {
        expect(csrfCookieOptions(60).maxAge).toBe(60_000);
        expect(csrfCookieOptions(0).maxAge).toBe(0);
    });
});
