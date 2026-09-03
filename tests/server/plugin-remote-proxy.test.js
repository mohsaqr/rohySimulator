// RPS-1 'remote' capability: GET /api/plugins/:pluginId/*
//
// The proxy exists so a plugin's bulk content (whole-slide pyramids) can live
// on another host without widening rohy's CSP to name that host. Everything
// below is about the difference between "relays what the operator configured"
// and "makes arbitrary requests on behalf of whoever can edit a case".
//
// A real upstream is spawned rather than mocked, because the behaviours that
// matter here — a redirect, a text/html body, a path the proxy must refuse to
// request at all — are properties of an HTTP conversation, and a stub that
// returns whatever it is told would assert nothing about the conversation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { resolveRemoteRefs } from '../../src/plugins/context.js';
import { readUpstreamBody } from '../../server/routes/plugins-routes.js';

const PASSWORD = 'RemoteP4th!';

describe('bounded plugin response reader', () => {
    it('cancels a chunked body as soon as it crosses the byte cap', async () => {
        let pulls = 0;
        let cancelled = false;
        const body = new ReadableStream({
            pull(controller) {
                pulls++;
                controller.enqueue(new Uint8Array(4));
            },
            cancel() { cancelled = true; },
        });

        const result = await readUpstreamBody({ body }, 8);

        expect(result).toEqual({ ok: false, buffer: null });
        expect(pulls).toBeLessThanOrEqual(4);
        expect(cancelled).toBe(true);
    });
});

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
async function seedUser(dbPath, username, role) {
    const db = await openDb(dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, ?, 1, 'active')`,
            [username, username, `${username}@example.com`, hash, role],
            (err) => err ? reject(err) : resolve()));
    } finally { await closeDb(db); }
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    return (await res.json()).token;
}

/** A slide host that can misbehave in each of the ways the proxy must survive. */
function startUpstream() {
    const hits = [];
    const server = http.createServer((req, res) => {
        hits.push(req.url);
        const send = (status, type, body) => {
            res.writeHead(status, type ? { 'content-type': type } : {});
            res.end(body);
        };
        switch (req.url) {
            case '/tiles/slide1.dzi':
                return send(200, 'application/xml', '<Image Width="100"/>');
            case '/tiles/0/0_0.jpg':
                return send(200, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
            case '/tiles/with%20space.jpg':
                return send(200, 'image/jpeg', Buffer.from([0xff, 0xd8]));
            case '/tiles/trap.html':
                return send(200, 'text/html', '<script>alert(1)</script>');
            case '/tiles/elsewhere.jpg':
                res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
                return res.end();
            case '/tiles/gone.jpg':
                return send(404, 'text/plain', 'no such tile');
            case '/tiles/huge.jpg':
                res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(64 * 1024 * 1024) });
                return res.end(Buffer.alloc(16));
            case '/secret/keys':
                return send(200, 'application/xml', '<credentials/>');
            default:
                return send(404, 'text/plain', 'not found');
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ origin: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

describe('plugin remote-content proxy', () => {
    let upstream, server, token;

    beforeAll(async () => {
        upstream = await startUpstream();
        server = await startTestServer({
            seed: false,
            env: { ROHY_PLUGIN_ORIGINS: `pathology=${upstream.origin}` },
        });
        await seedUser(server.dbPath, 'slide-reader', 'student');
        token = await login(server.baseUrl, 'slide-reader');
    });
    afterAll(async () => {
        await server?.close();
        await upstream?.close();
    });

    const get = (path, opts = {}) => fetch(`${server.baseUrl}${path}`, {
        headers: opts.anonymous ? {} : { authorization: `Bearer ${token}` },
    });

    // --- the happy path it exists for ------------------------------------

    it('relays a declared tile from the configured origin', async () => {
        const res = await get('/api/plugins/pathology/tiles/slide1.dzi');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/xml');
        expect(await res.text()).toBe('<Image Width="100"/>');
    });

    it('caches privately, because the response passed a per-user authorisation check', async () => {
        const res = await get('/api/plugins/pathology/tiles/0/0_0.jpg');
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toContain('private');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('preserves a space in a filename instead of splitting the path on it', async () => {
        const res = await get('/api/plugins/pathology/tiles/with%20space.jpg');
        expect(res.status).toBe(200);
        expect(upstream.hits).toContain('/tiles/with%20space.jpg');
    });

    it('passes an upstream 404 through so a wrong slide path reads as missing, not broken', async () => {
        const res = await get('/api/plugins/pathology/tiles/gone.jpg');
        expect(res.status).toBe(404);
    });

    // --- the refusals that make it a proxy rather than a relay -----------

    it('does not follow a redirect off the configured origin', async () => {
        // The single most important assertion in this file. `redirect: 'follow'`
        // is fetch's default, and with it the origin allowlist would be advisory:
        // the slide host could hand rohy the cloud metadata endpoint and rohy
        // would fetch it with the server's own network position.
        const res = await get('/api/plugins/pathology/tiles/elsewhere.jpg');
        expect(res.status).toBe(502);
        expect((await res.json()).code).toBe('plugin_remote_redirect');
    });

    it('refuses a content type the manifest never declared', async () => {
        // Relaying text/html from the upstream would serve attacker-controlled
        // markup from rohy's own origin.
        const res = await get('/api/plugins/pathology/tiles/trap.html');
        expect(res.status).toBe(502);
        expect((await res.json()).code).toBe('plugin_remote_content_type');
    });

    it('refuses a path prefix the manifest does not declare, WITHOUT contacting the upstream', async () => {
        const before = upstream.hits.length;
        const res = await get('/api/plugins/pathology/secret/keys');
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('plugin_remote_undeclared_path');
        // The point is not the status — it is that rohy never made the request.
        // A check applied to the RESPONSE would still have fetched the secret.
        expect(upstream.hits.slice(before)).toEqual([]);
    });

    // Traversal has two spellings and they are stopped by two different checks.
    // Both are asserted because dropping either check leaves one live.
    it('rejects traversal spelled with an encoded dot-segment', async () => {
        const before = upstream.hits.length;
        // Express normalises `%2e%2e/` before routing, so this arrives at the
        // handler as plain `/secret/keys` — outside the declared prefix.
        const res = await get('/api/plugins/pathology/tiles/%2e%2e/secret/keys');
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('plugin_remote_undeclared_path');
        expect(upstream.hits.slice(before)).toEqual([]);
    });

    it('rejects traversal smuggled inside a segment with an encoded slash', async () => {
        const before = upstream.hits.length;
        // `..%2f` is NOT normalised: it survives as one decoded segment,
        // `../secret`, which still looks like it sits under '/tiles'. The
        // prefix check cannot see this one; the separator check is what does.
        const res = await get('/api/plugins/pathology/tiles/..%2fsecret/keys');
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('plugin_remote_bad_path');
        expect(upstream.hits.slice(before)).toEqual([]);
    });

    it('refuses an upstream body larger than the cap', async () => {
        const res = await get('/api/plugins/pathology/tiles/huge.jpg');
        expect(res.status).toBe(502);
        expect((await res.json()).code).toBe('plugin_remote_too_large');
    });

    it('will not proxy for a plugin that is not installed', async () => {
        const res = await get('/api/plugins/ecg/tiles/x.jpg');
        expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
        const res = await get('/api/plugins/pathology/tiles/slide1.dzi', { anonymous: true });
        expect(res.status).toBe(401);
    });

    it('is not writable', async () => {
        const res = await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide1.dzi`, {
            method: 'POST', headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(404);
    });

    it('serves exactly the URL the client-side resolver produces', async () => {
        // The seam most likely to rot: the browser builds these URLs in
        // src/plugins/context.js and the server parses them in
        // plugins-routes.js, and nothing else forces the two to agree. A
        // filename with a space is the case that separates a correct
        // per-segment encoding from a plausible one.
        const resolved = resolveRemoteRefs(
            { slides: [{ dzi: 'remote:tiles/with space.jpg' }] },
            'pathology',
        );
        const url = resolved.slides[0].dzi;
        expect(url).toBe('/api/plugins/pathology/tiles/with%20space.jpg');

        const res = await get(url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/jpeg');
    });

    it('carries a wider per-user budget than the IP-keyed general limiter', async () => {
        // Tile traffic is hundreds of requests per pan. If the route sat under
        // generalLimiter (600/min, keyed by IP) one student reading a slide
        // would spend a whole teaching lab's budget.
        const tile = await get('/api/plugins/pathology/tiles/slide1.dzi');
        const plain = await get('/api/learning-events/verbs');
        expect(Number(tile.headers.get('ratelimit-limit')))
            .toBeGreaterThan(Number(plain.headers.get('ratelimit-limit')));
    });
});

describe('plugin remote-content proxy with no origin configured', () => {
    let server, token;
    beforeAll(async () => {
        // No ROHY_PLUGIN_ORIGINS: the default posture of a fresh install is that
        // rohy talks to nothing.
        // Starter content off as well: with it on, a deployment with no origin
        // serves rohy's own bundled samples from disk rather than 503ing.
        server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: '', ROHY_STARTER_CONTENT: 'off' } });
        await seedUser(server.dbPath, 'unconfigured-reader', 'student');
        token = await login(server.baseUrl, 'unconfigured-reader');
    });
    afterAll(async () => { await server?.close(); });

    it('answers 503 rather than guessing a host', async () => {
        const res = await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide1.dzi`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('plugin_remote_not_configured');
    });
});
