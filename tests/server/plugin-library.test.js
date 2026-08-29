// The managed half of a plugin's library (RPS-1 1.4): imported slides live
// beside bundled ones on the same origin, the editor asks ONE catalog, and
// /health/plugins reports the library in aggregate.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const BUNDLE = {
    schemaVersion: '1.0.0', version: 1, title: 'bundled library',
    assets: [{
        id: 'bundled-lmh-p', label: 'TMA392 — H&E', status: 'ready',
        preview: { url: 'remote:tiles/previews/lmh_p.jpg' },
        currentRevisionId: 'r1',
        revisions: [{ id: 'r1', status: 'ready', derivatives: { dzi: { url: 'remote:tiles/lmh_p.dzi' } } }],
    }],
};

function startOrigin() {
    const server = http.createServer((req, res) => {
        const body = req.url === '/catalog.json' ? BUNDLE
            : req.url === '/content.json' ? { plugin: 'pathology', version: 't' } : null;
        if (!body) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
    })));
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
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
const authed = (baseUrl, token) => (path) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('the managed library', () => {
    let upstream; let server; let admin; let libraryDir;

    beforeAll(async () => {
        upstream = await startOrigin();
        libraryDir = await mkdtemp(join(tmpdir(), 'rohy-lib-'));
        server = await startTestServer({
            seed: false,
            env: {
                ROHY_PLUGIN_ORIGINS: `pathology=${upstream.origin}`,
                ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${libraryDir}`,
                ROHY_PLUGIN_IMPORT_ORIGINS: 'pathology=https://openslide.cs.cmu.edu',
            },
        });
        await dbRun(server.dbPath,
            `INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state, source_url,
                                        native_objective, native_mpp_x, tiled_objective, width, height, disk_bytes)
             VALUES ('asset-imported01', 1, 'pathology', 'Imported liver', 'ready', 'https://openslide.cs.cmu.edu/x.svs',
                     40, 0.25, 10, 27840, 20736, 137000000),
                    ('asset-pending02', 1, 'pathology', 'Half done', 'importing', 'https://openslide.cs.cmu.edu/y.svs',
                     NULL, NULL, NULL, NULL, NULL, 0),
                    ('asset-uncal03', 1, 'pathology', 'No optics', 'needs_calibration', 'https://openslide.cs.cmu.edu/z.tif',
                     NULL, NULL, NULL, 8000, 6000, 63000000)`);
        admin = authed(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
    }, 90_000);
    afterAll(async () => {
        await server?.close();
        await upstream?.close();
        await rm(libraryDir, { recursive: true, force: true });
    });

    it('serves one catalog holding both halves, managed first', async () => {
        const body = await (await admin('/api/plugins/pathology/catalog')).json();
        const ids = body.catalog.assets.map((a) => a.id);
        expect(ids).toContain('bundled-lmh-p');
        expect(ids).toContain('asset-imported01');
        // Newest-first: an author's own import is what they came back for.
        expect(ids[0]).toBe('asset-imported01');
    });

    // A slide that is importing, failed, or awaiting calibration is real but
    // not yet usable; offering it would let an author build a case around a
    // slide whose scale is unknown.
    it('offers only ready assets to an author', async () => {
        const body = await (await admin('/api/plugins/pathology/catalog')).json();
        const ids = body.catalog.assets.map((a) => a.id);
        expect(ids).not.toContain('asset-pending02');
        expect(ids).not.toContain('asset-uncal03');
    });

    // A case must never store a host address — the same rule as a bundled slide.
    it('addresses managed slides as remote: references under the declared /library prefix', async () => {
        const body = await (await admin('/api/plugins/pathology/catalog')).json();
        const managed = body.catalog.assets.find((a) => a.id === 'asset-imported01');
        expect(managed.revisions[0].derivatives.dzi.url).toBe('remote:library/asset-imported01/slide.dzi');
        expect(managed.preview.url).toBe('remote:library/asset-imported01/preview.jpg');
        expect(managed.revisions[0].optics).toMatchObject({ nativeObjective: 40, tiledObjective: 10 });
        expect(JSON.stringify(body).includes('127.0.0.1')).toBe(false);
    });

    it('declares /library so the proxy will serve it', async () => {
        const health = await (await fetch(`${server.baseUrl}/api/health/plugins`)).json();
        expect(health.plugins.pathology.declared_paths).toEqual(['/tiles', '/gross', '/library']);
    });

    // Aggregate only: /health/plugins is public so a deploy verify needs no
    // token, and what a tenant has imported is not public information.
    it('reports the library in aggregate, naming nothing', async () => {
        const health = await (await fetch(`${server.baseUrl}/api/health/plugins`)).json();
        expect(health.plugins.pathology.library).toMatchObject({
            assets: 3, ready: 1, needs_calibration: 1, failed: 0, queued: 0, running: 0,
        });
        expect(health.plugins.pathology.library.bytes).toBe(200000000);
        const text = JSON.stringify(health);
        expect(text.includes('Imported liver')).toBe(false);
        expect(text.includes('openslide.cs.cmu.edu')).toBe(false);
    });
});

describe('a deployment with no library directory', () => {
    let upstream; let server;
    beforeAll(async () => {
        upstream = await startOrigin();
        server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${upstream.origin}` } });
    }, 90_000);
    afterAll(async () => { await server?.close(); await upstream?.close(); });

    // "Not configured" and "configured and empty" must stay distinguishable: a
    // deployment that has not provisioned disk for slides is not a deployment
    // with zero slides.
    it('reports no library block at all, rather than zeroes', async () => {
        const health = await (await fetch(`${server.baseUrl}/api/health/plugins`)).json();
        expect(health.plugins.pathology.library).toBeUndefined();
        expect(health.plugins.pathology.reachable).toBe(true);
    });
});
