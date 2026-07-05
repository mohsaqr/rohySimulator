// Regression lock for liveness + readiness contracts.
//
// /api/health and /api/ready are wired BEFORE the rate limiter and BEFORE
// authenticateToken. Both promises are load-bearing for the deploy
// pipeline (smoke.sh, systemd watchdog, nginx upstream check). If either
// gets accidentally moved behind auth or rate limiting, deploys silently
// regress to "process up but probes 401" — these tests fail in that case.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

describe('GET /api/health — liveness', () => {
    let server;

    beforeAll(async () => { server = await startTestServer(); }, 90_000);
    afterAll(async () => { await server?.close(); });

    it('responds 200 + JSON without auth', async () => {
        const r = await fetch(`${server.baseUrl}/api/health`);
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.status).toBe('ok');
        expect(typeof j.version).toBe('string');
        expect(typeof j.uptime_s).toBe('number');
        expect(j.uptime_s).toBeGreaterThanOrEqual(0);
    });

    it('does not require an authorization header', async () => {
        const r = await fetch(`${server.baseUrl}/api/health`, {
            headers: { 'authorization': '' },
        });
        expect(r.status).toBe(200);
    });
});

describe('GET /api/ready — readiness', () => {
    let server;

    beforeAll(async () => { server = await startTestServer(); }, 90_000);
    afterAll(async () => { await server?.close(); });

    it('responds 200 + status:ok when DB is reachable and migrations are at HEAD', async () => {
        const r = await fetch(`${server.baseUrl}/api/ready`);
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.status).toBe('ok');
        expect(j.checks.db).toBe('ok');
        // migrations check string format: "at NNNN (M applied)"
        expect(j.checks.migrations).toMatch(/^at \d+ \(\d+ applied\)$/);
    });

    it('does not require an authorization header', async () => {
        const r = await fetch(`${server.baseUrl}/api/ready`);
        expect(r.status).toBe(200);
    });

    it('returns the same version as /api/health', async () => {
        const [h, r] = await Promise.all([
            fetch(`${server.baseUrl}/api/health`).then(x => x.json()),
            fetch(`${server.baseUrl}/api/ready`).then(x => x.json()),
        ]);
        expect(h.version).toBe(r.version);
        expect(h.started_at).toBe(r.started_at);
    });
});
