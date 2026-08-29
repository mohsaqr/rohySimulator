// GET /api/health/plugins — the probe that makes a plugin content origin a
// verifiable deployment fact (RPS-1 §7a.1). For every ROHY_PLUGIN_ORIGINS
// entry it fetches <origin>/content.json and reports reachable + content
// version; the deploy hub's POST_VERIFY (scripts/tech-test.sh) fails on 503.
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { startTestServer } from '../utils/startTestServer.js';

function startOrigin(handler) {
    const server = http.createServer(handler);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

const goodBundle = (plugin = 'pathology') => (req, res) => {
    if (req.url === '/content.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ schemaVersion: '1.0.0', plugin, version: '2026-08-29a', paths: ['/tiles', '/gross'], fileCount: 3 }));
    }
    res.writeHead(404); res.end();
};

describe('GET /api/health/plugins', () => {
    it('reports a reachable origin with its content version (200, status ok)', async () => {
        const upstream = await startOrigin(goodBundle());
        const server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${upstream.origin}` } });
        try {
            const res = await fetch(`${server.baseUrl}/api/health/plugins`);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toMatchObject({ status: 'ok', configured: 1, unreachable: [] });
            // The internal origin URL is deliberately not echoed by a public probe.
            expect(body.plugins.pathology.origin).toBeUndefined();
            expect(JSON.stringify(body)).not.toContain(upstream.origin);
            expect(body.plugins.pathology).toMatchObject({
                known_plugin: true, declared_paths: ['/tiles', '/gross', '/library'],
                reachable: true, status: 200, content_version: '2026-08-29a', content_plugin: 'pathology', file_count: 3,
            });
        } finally { await server.close(); await upstream.close(); }
    }, 60_000);

    it('is 503 + names the plugin when the origin is dark, and when it serves another plugin\'s bundle', async () => {
        const wrong = await startOrigin(goodBundle('ecg'));
        const dark = await startOrigin((req, res) => { res.writeHead(404); res.end(); });
        // 'ecg' is not a registered plugin; the parser accepts any lower_snake id.
        const server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${wrong.origin},ecg=${dark.origin}` } });
        try {
            const res = await fetch(`${server.baseUrl}/api/health/plugins`);
            expect(res.status).toBe(503);
            const body = await res.json();
            expect(body.status).toBe('degraded');
            expect(body.unreachable.sort()).toEqual(['ecg', 'pathology']);
            expect(body.plugins.pathology.error).toMatch(/says plugin 'ecg', expected 'pathology'/);
            expect(body.plugins.ecg).toMatchObject({ known_plugin: false, reachable: false, status: 404 });
        } finally { await server.close(); await wrong.close(); await dark.close(); }
    }, 60_000);

    it('with no origins configured it is 200 with nothing to report — a fresh install is healthy', async () => {
        const server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: '' } });
        try {
            const res = await fetch(`${server.baseUrl}/api/health/plugins`);
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ status: 'ok', configured: 0, unreachable: [], plugins: {} });
        } finally { await server.close(); }
    }, 60_000);
});
