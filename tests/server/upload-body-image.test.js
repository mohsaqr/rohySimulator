// Regression lock: body-image upload wrote to unserved public/ root (bug report 2.9.15 #13)
//
// POST /api/upload-body-image used to rename the silhouette into the public/
// ROOT — but only /uploads/* is statically served out of public/ (server.js);
// the SPA's assets come from frontend/. The upload "succeeded" (200 + toast)
// while the file landed where no reader looked, so the image never appeared.
//
// These tests pin the fixed contract end to end against the real server:
//   1. the file is written under public/uploads/bodymap/<type><ext>,
//   2. the response carries the served `url` (/uploads/bodymap/<type><ext>),
//   3. GET <url> actually serves the uploaded bytes (the static mount works),
//   4. the public/ ROOT stays clean (the old bug can't come back silently),
//   5. re-uploading with the other extension removes the stale twin so the
//      png-before-svg reader probe can't resolve to the old image,
//   6. the type allowlist still rejects garbage.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
const bodymapDir = path.join(repoRoot, 'public', 'uploads', 'bodymap');

// The route validates mimetype + extension, not image content — a few bytes
// with the PNG magic are enough and keep the multipart body tiny.
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

// The test exercises the fixed 'woman-back' slot; snapshot anything already
// sitting there (a dev's real upload) and restore it afterwards.
const TWIN_PATHS = [
    path.join(bodymapDir, 'woman-back.png'),
    path.join(bodymapDir, 'woman-back.svg'),
];
const preExisting = new Map();

// The bundled DEFAULT silhouette lives at the public/ root (it ships with the
// repo and is copied into frontend/ by the Vite build). The old bug renamed
// uploads over it; the fixed route must leave it byte-identical.
const rootDefaultPath = path.join(repoRoot, 'public', 'woman-back.png');
let rootDefaultBytes = null;

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

async function loginAs(server, username, password) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.token;
}

function bodyImageForm(bytes, filename, mimetype, type) {
    const fd = new FormData();
    fd.append('image', new Blob([bytes], { type: mimetype }), filename);
    fd.append('type', type);
    return fd;
}

describe('POST /api/upload-body-image — writes into the served /uploads/bodymap', () => {
    let server;
    let token;

    beforeAll(async () => {
        for (const p of TWIN_PATHS) {
            if (fs.existsSync(p)) preExisting.set(p, fs.readFileSync(p));
        }
        rootDefaultBytes = fs.existsSync(rootDefaultPath) ? fs.readFileSync(rootDefaultPath) : null;
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (100, 'bodymap_admin', 'Bodymap Admin', ?, 'bm@example.com', 'admin', 'active', 1)`,
            [hash]
        );
        await dbClose(db);
        token = await loginAs(server, 'bodymap_admin', 'correctpass');
    }, 90_000);

    afterAll(async () => {
        await server?.close();
        // Leave the (gitignored) dir as the test found it.
        for (const p of TWIN_PATHS) {
            if (preExisting.has(p)) fs.writeFileSync(p, preExisting.get(p));
            else if (fs.existsSync(p)) fs.unlinkSync(p);
        }
    });

    it('stores the PNG under public/uploads/bodymap and returns its served url', async () => {
        const r = await fetch(`${server.baseUrl}/api/upload-body-image`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: bodyImageForm(PNG_BYTES, 'woman-back.png', 'image/png', 'woman-back'),
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.success).toBe(true);
        expect(j.url).toBe('/uploads/bodymap/woman-back.png');

        // The file landed in the served directory…
        expect(fs.existsSync(path.join(bodymapDir, 'woman-back.png'))).toBe(true);
        // …and the bundled default at the unserved public/ ROOT was not
        // clobbered (the original bug renamed uploads straight over it).
        if (rootDefaultBytes) {
            expect(fs.readFileSync(rootDefaultPath).equals(rootDefaultBytes)).toBe(true);
        } else {
            expect(fs.existsSync(rootDefaultPath)).toBe(false);
        }
    });

    it('serves the uploaded file back at the returned url via the /uploads static mount', async () => {
        // Signed in: /uploads needs a sign-in since sec2 (L9).
        const r = await fetch(`${server.baseUrl}/uploads/bodymap/woman-back.png`, { headers: { authorization: `Bearer ${token}` } });
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toContain('image/png');
        const body = Buffer.from(await r.arrayBuffer());
        expect(body.equals(PNG_BYTES)).toBe(true);
    });

    it('removes the stale other-extension twin so readers cannot resolve the old image', async () => {
        // Readers probe <type>.png before <type>.svg — after an .svg upload the
        // old .png must be gone or the probe would keep serving the stale image.
        const r = await fetch(`${server.baseUrl}/api/upload-body-image`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: bodyImageForm(SVG_BYTES, 'woman-back.svg', 'image/svg+xml', 'woman-back'),
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.url).toBe('/uploads/bodymap/woman-back.svg');
        expect(fs.existsSync(path.join(bodymapDir, 'woman-back.svg'))).toBe(true);
        expect(fs.existsSync(path.join(bodymapDir, 'woman-back.png'))).toBe(false);
    });

    it('rejects an unknown body-image type with 400 and writes nothing', async () => {
        const r = await fetch(`${server.baseUrl}/api/upload-body-image`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: bodyImageForm(PNG_BYTES, 'evil.png', 'image/png', 'not-a-slot'),
        });
        expect(r.status).toBe(400);
        const j = await r.json();
        expect(j.error).toMatch(/Invalid image type/i);
        expect(fs.existsSync(path.join(bodymapDir, 'not-a-slot.png'))).toBe(false);
    });
});
