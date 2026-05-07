import { describe, expect, it } from 'vitest';
import { buildCsp, securityHeaders } from '../../server/security-headers.js';

function runMiddleware(middleware, { req = {}, res = makeRes() } = {}) {
    return new Promise((resolve) => {
        middleware(req, res, () => resolve(res));
    });
}

function makeRes() {
    const headers = {};
    return {
        setHeader: (k, v) => { headers[k] = v; },
        getHeader: (k) => headers[k],
        headers,
    };
}

describe('buildCsp', () => {
    it('production: script-src is self only — no unsafe-inline, no unsafe-eval', () => {
        const csp = buildCsp({ nodeEnv: 'production' });
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toContain("'unsafe-inline'  ");
        const scriptDirective = csp.split(';').find(d => d.trim().startsWith('script-src'));
        expect(scriptDirective).not.toContain('unsafe-eval');
        expect(scriptDirective).not.toContain('unsafe-inline');
    });

    it('development: script-src allows unsafe-eval (Vite HMR)', () => {
        const csp = buildCsp({ nodeEnv: 'development' });
        expect(csp).toContain("'unsafe-eval'");
    });

    it('always sets default-src self, frame-ancestors none, object-src none', () => {
        for (const env of ['production', 'development', undefined]) {
            const csp = buildCsp({ nodeEnv: env });
            expect(csp).toContain("default-src 'self'");
            expect(csp).toContain("frame-ancestors 'none'");
            expect(csp).toContain("object-src 'none'");
            expect(csp).toContain("base-uri 'self'");
        }
    });

    it('allows blob: in media-src + worker-src for TTS audio + web workers', () => {
        const csp = buildCsp({ nodeEnv: 'production' });
        expect(csp).toContain('media-src');
        expect(csp.split(';').find(d => d.trim().startsWith('media-src'))).toContain('blob:');
        expect(csp.split(';').find(d => d.trim().startsWith('worker-src'))).toContain('blob:');
    });

    it('allows data: + blob: in img-src for case-authored images', () => {
        const csp = buildCsp({ nodeEnv: 'production' });
        const imgSrc = csp.split(';').find(d => d.trim().startsWith('img-src'));
        expect(imgSrc).toContain('data:');
        expect(imgSrc).toContain('blob:');
    });

    it('connect-src is self only (cookie-mode auth + CSRF assume same-origin)', () => {
        const csp = buildCsp({ nodeEnv: 'production' });
        const connect = csp.split(';').find(d => d.trim().startsWith('connect-src'));
        expect(connect.trim()).toBe("connect-src 'self'");
    });
});

describe('securityHeaders middleware', () => {
    it('sets Content-Security-Policy on every response', async () => {
        const mw = securityHeaders({ nodeEnv: 'production' });
        const res = await runMiddleware(mw);
        expect(res.headers['Content-Security-Policy']).toBeTypeOf('string');
        expect(res.headers['Content-Security-Policy']).toContain('default-src');
    });

    it('sets the defensive header bundle', async () => {
        const mw = securityHeaders({ nodeEnv: 'production' });
        const res = await runMiddleware(mw);
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.headers['X-Frame-Options']).toBe('DENY');
        expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        // Modern browsers ignore the legacy XSS filter; we explicitly
        // disable it because it has known bypass-then-reflect bugs.
        expect(res.headers['X-XSS-Protection']).toBe('0');
    });

    it('sets a Permissions-Policy that allows mic + camera but blocks geolocation/payment/usb', async () => {
        const mw = securityHeaders({ nodeEnv: 'production' });
        const res = await runMiddleware(mw);
        const pp = res.headers['Permissions-Policy'];
        expect(pp).toContain('microphone=(self)');
        expect(pp).toContain('camera=(self)');
        expect(pp).toContain('geolocation=()');
        expect(pp).toContain('payment=()');
    });

    it('calls next() exactly once', async () => {
        const mw = securityHeaders({ nodeEnv: 'production' });
        let calls = 0;
        await new Promise((resolve) => {
            mw({}, makeRes(), () => { calls++; resolve(); });
        });
        expect(calls).toBe(1);
    });
});
