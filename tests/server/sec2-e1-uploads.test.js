// /uploads: signed-in only, normalised before any decision, live directory
// only; install-wide body-map files are platform configuration.
//
// Regression lock: /uploads/* was served without a sign-in (L9); lessonFileGuard
// let `./x`, `%2e/x`, `y/../x` and `.%2fx` through to serve-static, which
// normalised them back to a locked lesson's file (L4-02); a file missing from
// public/uploads fell through to the stale copy the build snapshots into
// frontend/ (L4-05); and a tenant admin could overwrite the silhouettes and the
// region map every tenant reads, with the upload unaudited (L4-04).
// Security audit 2026-10-26.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, login, all, run } from '../utils/authHttp.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const uploadsDir = path.join(repoRoot, 'public', 'uploads');
const frontendDir = path.join(repoRoot, 'frontend');
const bodymapDir = path.join(uploadsDir, 'bodymap');
const regionsFile = path.join(repoRoot, 'public', 'bodymap-regions.json');

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const stamp = `${Date.now()}-sec2e1`;
const LIVE = `${stamp}-live.png`;
const STALE = `${stamp}-stale.png`;
const SLOT = 'woman-front';
const SLOT_FILES = ['.png', '.svg'].map((ext) => path.join(bodymapDir, `${SLOT}${ext}`));

let server;
let tokens;
const saved = new Map();
let regionsBefore = null;
let staleCopy = null;

beforeAll(async () => {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, LIVE), PNG);
    if (fs.existsSync(frontendDir)) {
        // A file that exists ONLY in the build's snapshot of public/uploads.
        staleCopy = path.join(frontendDir, 'uploads', STALE);
        fs.mkdirSync(path.dirname(staleCopy), { recursive: true });
        fs.writeFileSync(staleCopy, PNG);
    }
    for (const file of SLOT_FILES) if (fs.existsSync(file)) saved.set(file, fs.readFileSync(file));
    regionsBefore = fs.existsSync(regionsFile) ? fs.readFileSync(regionsFile) : null;

    server = await startTestServer({ seed: false });
    const db = await openDb(server.dbPath);
    await run(db, `INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (2, 'Other', 'other-sec2e1')`);
    await seedUser(db, { username: 'e1_student', role: 'student' });
    await seedUser(db, { username: 'e1_platform', role: 'admin', tenantId: 1 });
    await seedUser(db, { username: 'e1_tenant_admin', role: 'admin', tenantId: 2 });
    await closeDb(db);
    tokens = {
        student: await login(server.baseUrl, 'e1_student'),
        platform: await login(server.baseUrl, 'e1_platform'),
        tenantAdmin: await login(server.baseUrl, 'e1_tenant_admin'),
    };
}, 90_000);

afterAll(async () => {
    await server?.close();
    fs.rmSync(path.join(uploadsDir, LIVE), { force: true });
    if (staleCopy) fs.rmSync(staleCopy, { force: true });
    for (const file of SLOT_FILES) {
        if (saved.has(file)) fs.writeFileSync(file, saved.get(file));
        else fs.rmSync(file, { force: true });
    }
    if (regionsBefore === null) fs.rmSync(regionsFile, { force: true });
    else fs.writeFileSync(regionsFile, regionsBefore);
});

const get = (urlPath, token) => fetch(`${server.baseUrl}${urlPath}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});

/** GET with the path sent EXACTLY as written: fetch() would normalise the dot segments away client-side. */
function rawGet(urlPath, token) {
    const { hostname, port } = new URL(server.baseUrl);
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname, port, path: urlPath, method: 'GET', headers: { authorization: `Bearer ${token}` } }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
    });
}

describe('GET /uploads/*', () => {
    it('needs a sign-in', async () => {
        expect((await get(`/uploads/${LIVE}`)).status).toBe(401);
        const res = await get(`/uploads/${LIVE}`, tokens.student);
        expect(res.status).toBe(200);
        expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    });

    it.each([
        ['./', `/uploads/./${LIVE}`],
        ['%2e/', `/uploads/%2e/${LIVE}`],
        ['x/../', `/uploads/x/../${LIVE}`],
        ['.%2f', `/uploads/.%2f${LIVE}`],
        ['%2e%2e%2f', `/uploads/bodymap/%2e%2e%2f${LIVE}`],
        ['a nested path', `/uploads/a/${LIVE}`],
    ])('refuses a dot-segment or nested spelling (%s) instead of normalising it', async (_label, urlPath) => {
        expect((await rawGet(urlPath, tokens.student)).status).toBe(404);
    });

    it('answers only from the live directory, never the build\'s stale snapshot', async () => {
        expect((await get(`/uploads/${STALE}`, tokens.student)).status).toBe(404);
        expect((await get(`/uploads/${stamp}-nothing.png`, tokens.student)).status).toBe(404);
    });
});

describe('install-wide body-map files are platform configuration', () => {
    const uploadBodyImage = (token) => {
        const form = new FormData();
        form.append('type', SLOT);
        form.append('image', new Blob([PNG], { type: 'image/png' }), `${SLOT}.png`);
        return fetch(`${server.baseUrl}/api/upload-body-image`, {
            method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
        });
    };
    const saveRegions = (token) => fetch(`${server.baseUrl}/api/bodymap-regions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ regions: [{ id: 'chest', label: 'Chest', x: 1, y: 2, w: 3, h: 4 }] }),
    });

    it('refuses a tenant admin of another tenant', async () => {
        for (const res of [
            await uploadBodyImage(tokens.tenantAdmin),
            await saveRegions(tokens.tenantAdmin),
            await fetch(`${server.baseUrl}/api/body-image/${SLOT}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokens.tenantAdmin}` } }),
        ]) {
            expect(res.status).toBe(403);
            expect((await res.json()).code).toBe('platform_admin_required');
        }
    });

    it('lets the platform admin upload a silhouette, and audits it', async () => {
        const res = await uploadBodyImage(tokens.platform);
        expect(res.status).toBe(200);
        expect((await res.json()).url).toBe(`/uploads/bodymap/${SLOT}.png`);
        expect((await get(`/uploads/bodymap/${SLOT}.png`, tokens.student)).status).toBe(200);
        expect((await saveRegions(tokens.platform)).status).toBe(200);
        // auditSuccess() appends after the response; poll for the row.
        const db = await openDb(server.dbPath);
        try {
            let rows = [];
            for (let i = 0; i < 50 && rows.length === 0; i += 1) {
                rows = await all(db, `SELECT action, resource_id FROM system_audit_log WHERE action = 'upload_body_image'`);
                if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
            }
            expect(rows).toEqual([{ action: 'upload_body_image', resource_id: SLOT }]);
        } finally {
            await closeDb(db);
        }
    });
});
