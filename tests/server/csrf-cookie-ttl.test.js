// Regression lock: the rohy_csrf cookie expires WITH the auth cookie
// (UI swarm finding #34, v2.9.108).
//
// `rohy_auth` (HttpOnly) and `rohy_csrf` (readable by client JS) are two
// halves of ONE credential: authenticateToken runs the double-submit check for
// every cookie-auth mutation, so a request with a live auth cookie and no CSRF
// cookie is rejected 403 "CSRF token missing".
//
// The CSRF half was pinned at a hardcoded 4 h while authTtlSeconds() defaults
// to 7 days. After four idle hours the browser still held a perfectly valid
// session and had nothing to copy into X-CSRF-Token, so every background POST
// from a long-open tab 403'd silently until something re-minted the pair. The
// TTL is now derived, so the two cannot drift.
//
// Deliberately a unit test: csrfCookieOptions() is pure, and the whole point
// of the fix's shape is that middleware/csrf.js stays importable WITHOUT
// dragging in middleware/auth.js → dbAdapter → db.js (which opens, migrates
// and seeds the sqlite file named by ROHY_DB at import time). Importing this
// file must not touch a database — that is why authTtlSeconds() lives in its
// own dependency-free module.

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { csrfCookieOptions } from '../../server/middleware/csrf.js';
import { authTtlSeconds } from '../../server/middleware/authTtl.js';

afterEach(() => { delete process.env.JWT_EXPIRY; });
afterAll(() => { delete process.env.JWT_EXPIRY; });

describe('csrfCookieOptions().maxAge', () => {
    it('tracks authTtlSeconds() at the default 7-day TTL', () => {
        delete process.env.JWT_EXPIRY;
        // Un-fixed: 4 * 60 * 60 * 1000, whatever the auth TTL was.
        expect(csrfCookieOptions().maxAge).toBe(authTtlSeconds() * 1000);
        expect(csrfCookieOptions().maxAge).toBe(7 * 86400 * 1000);
    });

    it.each([
        ['45s', 45],
        ['90m', 90 * 60],
        ['4h', 4 * 3600],
        ['12h', 12 * 3600],
        ['7d', 7 * 86400],
        ['3600', 3600],
    ])('follows JWT_EXPIRY=%s (%d seconds)', (spec, expected) => {
        process.env.JWT_EXPIRY = spec;
        expect(authTtlSeconds()).toBe(expected);
        expect(csrfCookieOptions().maxAge).toBe(expected * 1000);
    });

    it('follows an unparseable JWT_EXPIRY to the same fallback auth uses', () => {
        process.env.JWT_EXPIRY = 'four hours';
        expect(csrfCookieOptions().maxAge).toBe(authTtlSeconds() * 1000);
    });

    it('is read per call, not frozen at import', () => {
        process.env.JWT_EXPIRY = '1h';
        const short = csrfCookieOptions().maxAge;
        process.env.JWT_EXPIRY = '2h';
        expect(csrfCookieOptions().maxAge).toBe(short * 2);
    });

    it('still honours an explicit override — clearCookie passes 0', () => {
        expect(csrfCookieOptions(0).maxAge).toBe(0);
        expect(csrfCookieOptions(60).maxAge).toBe(60_000);
    });

    it('keeps the rest of the double-submit contract intact', () => {
        const opts = csrfCookieOptions();
        // NOT HttpOnly: client JS must read this half to build the header.
        expect(opts.httpOnly).toBe(false);
        expect(opts.sameSite).toBe('lax');
        expect(opts.path).toBe('/');
    });
});
