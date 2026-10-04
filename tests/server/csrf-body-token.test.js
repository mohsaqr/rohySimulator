// Regression lock: navigator.sendBeacon cannot set X-CSRF-Token, so the unload flush of learning events was refused 403 and lost (QA 2026-10-04, PRV-24)
//
// verifyCsrf now also accepts the double-submit token as `_csrf` in the JSON
// body. It must stay exactly as strict: the body token has to match the cookie,
// a wrong one is refused, and the header still wins when both are sent.

import { describe, it, expect } from 'vitest';
import { verifyCsrf } from '../../server/middleware/csrf.js';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg';
const req = ({ header, body } = {}) => ({
    headers: { cookie: `rohy_csrf=${TOKEN}`, ...(header ? { 'x-csrf-token': header } : {}) },
    body,
});

describe('verifyCsrf — body token for header-less beacons', () => {
    it('accepts a matching _csrf in the body when no header is sent', () => {
        expect(verifyCsrf(req({ body: { _csrf: TOKEN, events: [] } }))).toBeNull();
    });

    it('refuses a wrong body token', () => {
        expect(verifyCsrf(req({ body: { _csrf: 'X'.repeat(TOKEN.length) } }))?.status).toBe(403);
    });

    it('still refuses when neither header nor body token is present', () => {
        expect(verifyCsrf(req({ body: { events: [] } }))).toEqual({ status: 403, body: { error: 'CSRF token missing' } });
    });

    it('ignores a non-string _csrf', () => {
        expect(verifyCsrf(req({ body: { _csrf: { forged: true } } }))?.status).toBe(403);
    });

    it('lets the header win over a body token', () => {
        expect(verifyCsrf(req({ header: 'Y'.repeat(TOKEN.length), body: { _csrf: TOKEN } }))?.status).toBe(403);
        expect(verifyCsrf(req({ header: TOKEN, body: { _csrf: 'nope' } }))).toBeNull();
    });
});
