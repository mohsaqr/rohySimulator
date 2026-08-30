// GET /api/plugins/:pluginId/catalog, for a plugin whose library is NOT
// pathology-shaped.
//
// Regression lock: the relay was written for pathology and hardcoded its
// vocabulary — a `{assets: […]}` collection whose references live in `url`
// fields. Radoyon's imaging archive is `{entries: […]}` with references in
// `ref`, so the route answered 502 plugin_catalog_invalid for a catalog that
// was perfectly well formed, the PACS case editor got no archive, and every
// study in it read "No imaging yet". The shape now travels in the manifest
// (`manifest.catalog`) and these tests fail against the un-fixed route.
//
// The second half locks the learner projection. A case entry may say
// `baseline: {kind: 'archive', ref: 'normal/ct_chest'}` and only the host can
// turn that id into series a viewer can open — so a learner must be able to
// read the archive. But the same catalog names the pathology library every
// case is built from, and handing that to the person being assessed on finding
// it would give away the answer. So a learner gets ONLY the keys the manifest
// allowlists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

/** An archive in Radoyon's shape: `entries`, references in `ref`. */
const ARCHIVE = {
    version: 1,
    name: 'Teaching normals',
    entries: [
        {
            id: 'normal/ct_chest_adult_m',
            studyId: 'ct_chest',
            modality: 'CT',
            bodyRegion: 'Chest',
            label: 'Normal chest CT, adult male',
            description: 'Apices to costophrenic angles.',
            series: [{
                key: 's2', description: 'AXIAL CHEST', plane: 'axial', instances: 240,
                ref: 'remote:dicom/normal/ct_chest_adult_m/s2/',
                geometry: { rows: 512, columns: 512, plane: 'axial' },
            }],
            provenance: { dataset: 'Synthetic', licence: 'CC0', redistribution: 'permitted' },
            tags: ['chest'],
        },
        {
            id: 'abnormal/pe_saddle',
            studyId: 'ct_chest',
            modality: 'CT',
            // The exact field that must never reach a learner: the diagnosis,
            // written on the tin.
            label: 'Saddle pulmonary embolus',
            series: [{
                key: 's1', description: 'CTPA', plane: 'axial', instances: 180,
                ref: 'remote:dicom/abnormal/pe_saddle/s1/',
            }],
            provenance: { dataset: 'Synthetic', licence: 'CC0', redistribution: 'permitted' },
            tags: ['pathology'],
        },
    ],
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
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}

const authed = (baseUrl, token) => (path) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('GET /api/plugins/pacs/catalog — the manifest declares the shape', () => {
    let upstream; let server; let admin; let student;

    beforeAll(async () => {
        upstream = await startOrigin({ '/catalog.json': { body: ARCHIVE } });
        server = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pacs=${upstream.origin}` } });
        const hash = await bcrypt.hash('Student1!', 4);
        await dbRun(
            server.dbPath,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, 'student', 1, 'active')`,
            ['pacs-student', 'pacs-student', 'pacs-student@example.com', hash],
        );
        admin = authed(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        student = authed(server.baseUrl, await login(server.baseUrl, 'pacs-student', 'Student1!'));
    }, 90_000);

    afterAll(async () => { await server?.close(); await upstream?.close(); });

    it('relays an `entries` catalog to an author unchanged — it is not "an unexpected shape"', async () => {
        const res = await admin('/api/plugins/pacs/catalog');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.plugin).toBe('pacs');
        expect(body.catalog).toEqual(ARCHIVE);
        // The pathology-shaped merge must not have invented an `assets` key on
        // a catalog that has none — the editor reads `entries` and a stray
        // sibling collection would be silently ignored, or worse, rendered.
        expect(body.catalog.assets).toBeUndefined();
    });

    it('a learner reads only the allowlisted keys, so the pathology library cannot spoil a case', async () => {
        const res = await student('/api/plugins/pacs/catalog');
        expect(res.status).toBe(200);
        const { catalog } = await res.json();
        // Enough to resolve an archive baseline into openable series…
        expect(catalog.entries).toHaveLength(2);
        expect(catalog.entries[0]).toEqual({
            id: 'normal/ct_chest_adult_m',
            studyId: 'ct_chest',
            series: ARCHIVE.entries[0].series,
        });
        // …and nothing else. Not the labels, not the provenance, not the tags.
        const serialised = JSON.stringify(catalog);
        expect(serialised).not.toContain('Saddle pulmonary embolus');
        expect(serialised).not.toContain('provenance');
        expect(serialised).not.toContain('bodyRegion');
    });

    it('a reference that is not `remote:` is still refused, on the manifest\'s own field name', async () => {
        const bad = await startOrigin({
            '/catalog.json': {
                body: {
                    version: 1,
                    entries: [{ id: 'x', series: [{ key: 's1', ref: 'https://elsewhere.example/dicom/s1/' }] }],
                },
            },
        });
        const own = await startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pacs=${bad.origin}` } });
        try {
            const token = await login(own.baseUrl, 'admin', 'admin123');
            const res = await authed(own.baseUrl, token)('/api/plugins/pacs/catalog');
            expect(res.status).toBe(502);
            expect((await res.json()).code).toBe('plugin_catalog_invalid');
        } finally {
            await own.close();
            await bad.close();
        }
    }, 90_000);
});

describe('GET /api/plugins/pathology/catalog — a plugin with no learnerKeys is unchanged', () => {
    let server; let student;

    beforeAll(async () => {
        // No origin at all: the point here is the ROLE gate, which must still
        // refuse before anything is fetched.
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash('Student1!', 4);
        await dbRun(
            server.dbPath,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, 'student', 1, 'active')`,
            ['path-student', 'path-student', 'path-student@example.com', hash],
        );
        student = authed(server.baseUrl, await login(server.baseUrl, 'path-student', 'Student1!'));
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    it('still answers 403 to a learner — the projection is opt-in, per plugin', async () => {
        expect((await student('/api/plugins/pathology/catalog')).status).toBe(403);
    });
});
