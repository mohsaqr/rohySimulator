// HTTP-surface hardening from security audit 2026-10-26 (lane E2):
//   - CORS: no localhost origins in production; ROHY_EXTRA_ORIGINS; same-origin pass
//   - CSP frame-src, HSTS behind a trusted TLS proxy only
//   - /api/ready + /api/health/plugins: verdicts only for anonymous production callers
//   - the Oyon-disabled 503 keeps its explanation through the production error shield
//   - request-log redaction of invite / key query strings
//   - production binds 127.0.0.1 by default
//
// The unit halves import pure modules. The integration half boots a real
// production-mode server (startTestServer, isolated temp DB).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCorsOptions, buildCorsOptionsDelegate, isSameOrigin } from '../../server/cors-config.js';
import { buildCsp, hstsHeaderValue, securityHeaders, shouldSendHsts } from '../../server/security-headers.js';
import { shieldErrorBody, GENERIC_SERVER_ERROR } from '../../server/middleware/dbErrorShield.js';
import { redactRequestPath } from '../../server/middleware/requestLogger.js';
import { startTestServer } from '../utils/startTestServer.js';

const quiet = { warn: vi.fn() };
const decide = (opts, origin) => new Promise((resolve) => {
    opts.origin(origin, (err, allow) => resolve(err ? 'rejected' : allow));
});

describe('CORS production allowlist (L9 / L6-15)', () => {
    // Regression lock: http://localhost:* origins were trusted, with credentials, in production.
    it.each(['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
        'refuses %s in production', async (origin) => {
            const opts = buildCorsOptions({ nodeEnv: 'production', frontendUrl: 'https://rohy.example.org/rohy', logger: quiet });
            expect(await decide(opts, origin)).toBe('rejected');
        },
    );

    it('still accepts FRONTEND_URL, EXTRA_CORS_ORIGINS and ROHY_EXTRA_ORIGINS', async () => {
        const opts = buildCorsOptions({
            nodeEnv: 'production',
            frontendUrl: 'https://rohy.example.org/rohy',
            extraOrigins: 'https://prova.example.org',
            rohyExtraOrigins: 'https://ops.example.org, http://localhost:9000',
            logger: quiet,
        });
        for (const o of ['https://rohy.example.org', 'https://prova.example.org', 'https://ops.example.org', 'http://localhost:9000']) {
            expect(await decide(opts, o)).toBe(true);
        }
    });

    it('dev stays permissive', async () => {
        expect(await decide(buildCorsOptions({ nodeEnv: 'development', logger: quiet }), 'http://localhost:3000')).toBe(true);
    });

    it('the delegate passes a same-origin request and nothing else extra', async () => {
        const delegate = buildCorsOptionsDelegate({ nodeEnv: 'production', frontendUrl: 'https://rohy.example.org', logger: quiet });
        const optionsFor = (headers) => new Promise((resolve) => delegate({ headers }, (_e, o) => resolve(o)));
        const same = await optionsFor({ origin: 'http://10.0.0.5:4000', host: '10.0.0.5:4000' });
        expect(same.origin).toBe(true);
        const cross = await optionsFor({ origin: 'https://evil.example', host: 'rohy.example.org' });
        expect(await decide(cross, 'https://evil.example')).toBe('rejected');
        expect(isSameOrigin('https://rohy.example.org', 'ROHY.example.org')).toBe(true);
        expect(isSameOrigin('https://rohy.example.org.evil.example', 'rohy.example.org')).toBe(false);
        expect(isSameOrigin(undefined, 'rohy.example.org')).toBe(false);
    });
});

describe('security headers (L5-05, L6-15)', () => {
    it('states frame-src explicitly', () => {
        for (const nodeEnv of ['production', 'development']) {
            const frame = buildCsp({ nodeEnv }).split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-src'));
            expect(frame).toBe("frame-src 'self'");
        }
    });

    function headersFor(req, nodeEnv, env = {}) {
        const set = {};
        const res = { setHeader: (k, v) => { set[k] = v; } };
        securityHeaders({ nodeEnv, env })(req, res, () => {});
        return set;
    }

    // Regression lock: the app never sent HSTS; only the Docker Caddyfile did.
    it('sends a short HSTS only for proxy-terminated HTTPS in production', () => {
        const viaProxy = { secure: true, socket: { encrypted: false } };
        expect(headersFor(viaProxy, 'production')['Strict-Transport-Security']).toBe('max-age=86400');
        expect(headersFor({ secure: false, socket: {} }, 'production')['Strict-Transport-Security']).toBeUndefined();
        // The direct TLS listener is the self-signed LAN path: no HSTS there.
        expect(headersFor({ secure: true, socket: { encrypted: true } }, 'production')['Strict-Transport-Security']).toBeUndefined();
        expect(headersFor(viaProxy, 'development')['Strict-Transport-Security']).toBeUndefined();
        expect(headersFor(viaProxy, 'production', { ROHY_HSTS_MAX_AGE: '0' })['Strict-Transport-Security']).toBeUndefined();
        expect(headersFor(viaProxy, 'production', { ROHY_HSTS_MAX_AGE: '600' })['Strict-Transport-Security']).toBe('max-age=600');
        expect(hstsHeaderValue({ ROHY_HSTS_MAX_AGE: 'junk' })).toBe('max-age=86400');
        expect(hstsHeaderValue({})).not.toMatch(/preload|includeSubDomains/);
        expect(shouldSendHsts(undefined, { nodeEnv: 'production' })).toBe(false);
    });
});

describe('production error shield keeps the Oyon-disabled explanation (L9)', () => {
    const prod = { NODE_ENV: 'production' };
    const req = { request_id: 'r1', log: { warn() {}, error() {} } };

    // Regression lock: the stub's 503 reached the browser as "Internal server error".
    it('passes OYON_DISABLED through with its own words', () => {
        const body = { code: 'OYON_DISABLED', error: 'oyon_disabled', message: 'Oyon is disabled on this server. Set OYON_ENABLED=1 …', stack: 'x' };
        const out = shieldErrorBody({ status: 503, body, req, env: prod });
        expect(out.status).toBe(503);
        expect(out.body).toEqual({ code: 'OYON_DISABLED', error: 'oyon_disabled', message: body.message });
    });

    it('still blanks OYON_IMPORT_FAILED, whose message embeds an error text', () => {
        const out = shieldErrorBody({ status: 503, body: { code: 'OYON_IMPORT_FAILED', error: 'oyon_import_failed', message: 'Cannot find module /opt/x' }, req, env: prod });
        expect(out.body.error).toBe(GENERIC_SERVER_ERROR);
        expect(JSON.stringify(out.body)).not.toContain('/opt/x');
    });

    it('a route cannot smuggle detail out by borrowing the code', () => {
        const out = shieldErrorBody({ status: 500, body: { code: 'OYON_DISABLED', error: 'x', details: { path: '/etc' } }, req, env: prod });
        expect(out.body).not.toHaveProperty('details');
    });
});

describe('request-log redaction of credential query strings (L6-08)', () => {
    // Regression lock: /register?invite=<token> was logged verbatim.
    it.each([
        ['/register?invite=SECRET123', '/register?invite=[redacted]'],
        ['/?invite=SECRET123&lang=fi', '/?invite=[redacted]&lang=fi'],
        ['/x?invite_code=S', '/x?invite_code=[redacted]'],
        ['/x?code=abc&api_key=k1#f', '/x?code=[redacted]&api_key=[redacted]#f'],
        ['/x?KEY=abc', '/x?KEY=[redacted]'],
    ])('%s', (input, expected) => {
        expect(redactRequestPath(input)).toBe(expected);
    });

    it('leaves look-alike keys alone', () => {
        for (const p of ['/api/x?case_code=EN-12', '/api/x?tokens_used=5', '/api/x?keyword=chest', '/api/x?page=2']) {
            expect(redactRequestPath(p)).toBe(p);
        }
    });
});

describe('a production server (integration)', () => {
    let server;
    const ADMIN_PASSWORD = 'Sec2E2-Admin-Pass-1';

    beforeAll(async () => {
        server = await startTestServer({
            env: {
                NODE_ENV: 'production',
                JWT_SECRET: 'sec2-e2-production-test-secret-7Hq2Lm9Zr4',
                FRONTEND_URL: 'https://rohy.example.org/rohy',
                ROHY_ADMIN_USERNAME: 'opsadmin',
                ROHY_ADMIN_PASSWORD: ADMIN_PASSWORD,
                ROHY_ADMIN_EMAIL: 'ops@example.org',
                ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
                OYON_ENABLED: '0',
                ROHY_PROVA_URL: 'off',
                // NOT setting ROHY_BIND: this also proves the loopback default
                // is reachable at http://localhost:<port>.
                ROHY_BIND: '',
            },
        });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    async function adminCookie() {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'opsadmin', password: ADMIN_PASSWORD }),
        });
        expect(res.status).toBe(200);
        const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('rohy_auth='));
        expect(cookie).toBeTruthy();
        return cookie.split(';')[0];
    }

    // Regression lock: anonymous /api/ready disclosed version, uptime and the migration level.
    it('/api/ready gives an anonymous caller verdicts only', async () => {
        const res = await fetch(`${server.baseUrl}/api/ready`);
        const body = await res.json();
        expect([200, 503]).toContain(res.status);
        expect(Object.keys(body).sort()).toEqual(['checks', 'status']);
        for (const v of Object.values(body.checks)) expect(['ok', 'fail']).toContain(v);
        expect(JSON.stringify(body)).not.toMatch(/applied|rejected\/24h|version|uptime/);
    });

    it('/api/ready gives an administrator the full detail', async () => {
        const res = await fetch(`${server.baseUrl}/api/ready`, { headers: { Cookie: await adminCookie() } });
        const body = await res.json();
        expect(typeof body.version).toBe('string');
        expect(body.checks.migrations).toMatch(/^at \d+ \(\d+ applied\)$/);
    });

    it('/api/ready ignores a forged token instead of failing', async () => {
        const res = await fetch(`${server.baseUrl}/api/ready`, { headers: { Authorization: 'Bearer not.a.jwt' } });
        expect([200, 503]).toContain(res.status);
        expect(Object.keys(await res.json()).sort()).toEqual(['checks', 'status']);
    });

    it('/api/health/plugins gives an anonymous caller counts and reachability only', async () => {
        const res = await fetch(`${server.baseUrl}/api/health/plugins`);
        const body = await res.json();
        expect(Object.keys(body).sort()).toEqual(['configured', 'plugins', 'status', 'unreachable']);
        expect(body).not.toHaveProperty('libraries');
        expect(body).not.toHaveProperty('content');
        const admin = await (await fetch(`${server.baseUrl}/api/health/plugins`, { headers: { Cookie: await adminCookie() } })).json();
        expect(admin).toHaveProperty('libraries');
        expect(admin).toHaveProperty('content');
    });

    it('the Oyon-disabled stub answers with its explanation in production', async () => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/settings`, { headers: { Cookie: await adminCookie() } });
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('OYON_DISABLED');
        expect(body.message).toMatch(/OYON_ENABLED=1/);
    });

    it('a loopback Origin is refused, a same-origin one is not', async () => {
        const foreign = await fetch(`${server.baseUrl}/api/health`, { headers: { Origin: 'http://localhost:3000' } });
        expect(foreign.status).toBe(403);
        const same = await fetch(`${server.baseUrl}/api/health`, { headers: { Origin: server.baseUrl } });
        expect(same.status).toBe(200);
        expect(same.headers.get('access-control-allow-origin')).toBe(server.baseUrl);
    });

    // Regression lock: the 8.5 MB /api/report parser read (and parsed) an anonymous body before auth.
    it('the large report / pathology-read parsers never read an anonymous body', async () => {
        for (const p of ['/api/report', '/api/reports/1/messages', '/api/sessions/1/pathology-reads']) {
            // Not even valid JSON: a parser that ran would answer 400, not 401.
            const res = await fetch(`${server.baseUrl}${p}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"not json',
            });
            expect(res.status, p).toBe(401);
            expect((await res.json()).error).toBe('Access token required');
        }
    });

    it('HSTS appears only when a trusted proxy says the request was HTTPS', async () => {
        const plain = await fetch(`${server.baseUrl}/api/health`);
        expect(plain.headers.get('strict-transport-security')).toBeNull();
        const viaTls = await fetch(`${server.baseUrl}/api/health`, { headers: { 'X-Forwarded-Proto': 'https' } });
        expect(viaTls.headers.get('strict-transport-security')).toBe('max-age=86400');
    });
});
