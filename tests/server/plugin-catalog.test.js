// GET /api/plugins/:pluginId/catalog — the slide library a plugin's EDITOR
// offers, relayed from the content origin's catalog.json (RPS-1 §7a.1).
// Regression lock: the editor's slide library was EMPTY on a host because
// rohy handed it no asset service; the catalog is now part of the content
// contract and relayed to authors here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const CATALOG = {
    schemaVersion: '1.0.0', version: 1, title: 'test library',
    assets: [{
        id: 'local-lmh-p', label: 'TMA392 — H&E', status: 'ready',
        preview: { url: 'remote:tiles/previews/lmh_p.jpg', widthPx: 427, heightPx: 320 },
        currentRevisionId: 'r1',
        revisions: [{ id: 'r1', status: 'ready', derivatives: { dzi: { url: 'remote:tiles/lmh_p.dzi' } },
            optics: { nativeObjective: 40, nativeMpp: 0.25, downsample: 4 } }],
    }],
};

function startOrigin(routes) {
    const server = http.createServer((req, res) => {
        const r = routes[req.url];
        if (!r) { res.writeHead(404); return res.end(); }
        res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'application/json' });
        res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
        resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    }));
}
function dbRun(dbPath, sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (e) => {
            if (e) return reject(e);
            db.run(sql, params, function done(err) { db.close(() => (err ? reject(err) : resolve(this))); });
        });
    });
}
async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
const authed = (baseUrl, token) => (path) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('GET /api/plugins/:pluginId/catalog', () => {
    let upstream; let server; let admin; let student;

    beforeAll(async () => {
        upstream = await startOrigin({
            '/catalog.json': { body: CATALOG },
            '/content.json': { body: { plugin: 'pathology', version: 't' } },
        });
        server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${upstream.origin}` } });
        const hash = await bcrypt.hash('Student1!', 4);
        await dbRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, 'student', 1, 'active')`, ['cat-student', 'cat-student', 'cat-student@example.com', hash]);
        admin = authed(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        student = authed(server.baseUrl, await login(server.baseUrl, 'cat-student', 'Student1!'));
    }, 90_000);
    afterAll(async () => { await server?.close(); await upstream?.close(); });

    it('relays the catalog to an author, unchanged, with every URL still a remote: reference', async () => {
        const res = await admin('/api/plugins/pathology/catalog');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.plugin).toBe('pathology');
        expect(body.catalog).toEqual(CATALOG);
        expect(res.headers.get('cache-control')).toMatch(/private/);
    });

    it('is gated on the plugin\'s authoring role — a student gets 403, not the library', async () => {
        expect((await student('/api/plugins/pathology/catalog')).status).toBe(403);
        expect((await fetch(`${server.baseUrl}/api/plugins/pathology/catalog`)).status).toBe(401);
    });

    it('unknown plugin → 404; and /api/health/plugins now reports has_catalog', async () => {
        expect((await admin('/api/plugins/nope/catalog')).status).toBe(404);
        const health = await (await fetch(`${server.baseUrl}/api/health/plugins`)).json();
        expect(health.plugins.pathology).toMatchObject({ reachable: true, has_catalog: true });
    });
});

describe('GET /api/plugins/:pluginId/catalog — operator states are honest, never 500', () => {
    it.each([
        ['no catalog at the origin', { '/content.json': { body: { plugin: 'pathology' } } }, 404, 'plugin_catalog_missing'],
        ['not JSON', { '/catalog.json': { body: '<html>', type: 'text/html' } }, 502, 'plugin_catalog_invalid'],
        ['wrong shape', { '/catalog.json': { body: { version: 2, assets: [] } } }, 502, 'plugin_catalog_invalid'],
        ['a URL that is not remote:', { '/catalog.json': { body: { ...CATALOG, assets: [{ ...CATALOG.assets[0], preview: { url: 'http://evil/x.jpg', widthPx: 1, heightPx: 1 } }] } } }, 502, 'plugin_catalog_invalid'],
    ])('%s → %i %s', async (_label, routes, status, code) => {
        const up = await startOrigin(routes);
        const srv = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${up.origin}` } });
        try {
            const res = await authed(srv.baseUrl, await login(srv.baseUrl, 'admin', 'admin123'))('/api/plugins/pathology/catalog');
            expect(res.status).toBe(status);
            expect((await res.json()).code).toBe(code);
        } finally { await srv.close(); await up.close(); }
    }, 90_000);

    it('no origin configured → 503 plugin_remote_not_configured', async () => {
        // No origin AND no starter bundle: the case where there is genuinely
        // nothing to show. rohy now ships starter content for pathology, so
        // 'no origin' alone no longer means 'nothing' — the 503 belongs to
        // the deployment that has neither.
        const srv = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: '', ROHY_STARTER_CONTENT: 'off' } });
        try {
            const res = await authed(srv.baseUrl, await login(srv.baseUrl, 'admin', 'admin123'))('/api/plugins/pathology/catalog');
            expect(res.status).toBe(503);
        } finally { await srv.close(); }
    }, 60_000);
});
