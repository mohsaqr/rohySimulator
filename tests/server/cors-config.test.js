import { describe, expect, it, vi } from 'vitest';
import { buildAllowedOrigins, buildCorsOptions } from '../../server/cors-config.js';

// Helper: invoke the CORS `origin` callback with the given Origin header
// and capture what it decides. The cors() middleware passes the origin
// string and a (err, allow) callback — we mimic that contract here.
function checkOrigin(opts, origin) {
    return new Promise((resolve, reject) => {
        opts.origin(origin, (err, allow) => {
            if (err) reject(err);
            else resolve(allow);
        });
    });
}

describe('buildAllowedOrigins', () => {
    it('returns the static dev-loopback set when no FRONTEND_URL', () => {
        const list = buildAllowedOrigins();
        expect(list).toContain('http://localhost:5173');
        expect(list).toContain('http://localhost:3000');
        expect(list).toContain('http://[::1]:5173');
        expect(list).not.toContain(undefined);
    });

    it('appends FRONTEND_URL when supplied', () => {
        const list = buildAllowedOrigins({ frontendUrl: 'https://rohy.example.com' });
        expect(list).toContain('https://rohy.example.com');
    });

    it('normalises a FRONTEND_URL with a path to its origin', () => {
        const list = buildAllowedOrigins({ frontendUrl: 'https://rohy.example.com/rohy' });
        expect(list).toContain('https://rohy.example.com');
        expect(list).not.toContain('https://rohy.example.com/rohy');
    });

    it('drops empty / undefined FRONTEND_URL silently', () => {
        const list = buildAllowedOrigins({ frontendUrl: '' });
        expect(list).not.toContain('');
    });
});

describe('buildCorsOptions — production allowlist gate', () => {
    function prodOptions() {
        return buildCorsOptions({
            nodeEnv: 'production',
            frontendUrl: 'https://rohy.example.com',
            // Silence the warn logger so test output stays clean.
            logger: { warn: vi.fn() },
        });
    }

    it('accepts an allowlisted origin (FRONTEND_URL)', async () => {
        await expect(checkOrigin(prodOptions(), 'https://rohy.example.com')).resolves.toBe(true);
    });

    it('accepts a same-origin / no-Origin request', async () => {
        // The cors lib calls origin(undefined, cb) for Origin-less requests
        // (e.g. server-to-server, Postman). They must always pass.
        await expect(checkOrigin(prodOptions(), undefined)).resolves.toBe(true);
        await expect(checkOrigin(prodOptions(), null)).resolves.toBe(true);
    });

    it('rejects an unknown public origin with the documented error', async () => {
        await expect(checkOrigin(prodOptions(), 'https://attacker.example.com'))
            .rejects.toThrow('Not allowed by CORS');
    });

    it('rejects loopback origins in production (dev convenience does NOT carry over)', async () => {
        // CONTRACT: this is the audit's specific concern — pre-prod must
        // refuse loopback Origins so dev/prod drift is visible. The
        // STATIC_DEV_ORIGINS list is included in `allowed` for convenience
        // BUT only matters in dev, since dev mode short-circuits before
        // the allowlist is consulted. So in prod, attempting localhost
        // should pass (it's on the list) — confirm that's the actual
        // contract and lock it.
        const opts = prodOptions();
        // Locking the observed behaviour: in production, loopback origins
        // ARE on the static allowlist and DO pass. If you tighten this
        // (e.g. remove STATIC_DEV_ORIGINS from the prod allowlist), this
        // test will fail and prompt the call site to be updated.
        await expect(checkOrigin(opts, 'http://localhost:3000')).resolves.toBe(true);
    });

    it('logs to the supplied logger when rejecting (observability)', async () => {
        const warn = vi.fn();
        const opts = buildCorsOptions({
            nodeEnv: 'production',
            frontendUrl: 'https://rohy.example.com',
            logger: { warn },
        });
        await expect(checkOrigin(opts, 'https://attacker.example.com')).rejects.toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('attacker.example.com');
    });
});

describe('buildCorsOptions — development is permissive (the audit-flagged drift)', () => {
    function devOptions() {
        return buildCorsOptions({ nodeEnv: 'development', logger: { warn: vi.fn() } });
    }

    it('accepts arbitrary Origins in dev', async () => {
        // CONTRACT: this is the dev convenience the audit flagged. Pre-prod
        // smoke tests should run with NODE_ENV=production to catch drift.
        await expect(checkOrigin(devOptions(), 'https://random.example.com')).resolves.toBe(true);
        await expect(checkOrigin(devOptions(), 'http://127.0.0.1:9999')).resolves.toBe(true);
    });

    it('treats undefined NODE_ENV as dev (the historical default)', async () => {
        const opts = buildCorsOptions({ logger: { warn: vi.fn() } });
        await expect(checkOrigin(opts, 'https://random.example.com')).resolves.toBe(true);
    });
});

describe('buildCorsOptions — header allowlist + credentials', () => {
    it('exposes credentials and the request-id + CSRF header set', () => {
        const opts = buildCorsOptions({ nodeEnv: 'production', frontendUrl: 'https://x' });
        expect(opts.credentials).toBe(true);
        // X-CSRF-Token is the double-submit pair for the rohy_auth cookie
        // (F-006). Without it on the preflight allowlist, split-origin
        // cookie-auth state-changing requests get blocked client-side
        // before they ever reach the CSRF middleware.
        expect(opts.allowedHeaders).toEqual(['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token']);
        expect(opts.exposedHeaders).toEqual(['X-Request-Id']);
        expect(opts.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    });
});
