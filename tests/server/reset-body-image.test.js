// DELETE /api/body-image/:type — restore the bundled default silhouette.
//
// Bug 4 of the 2.9.37 report: an admin could replace a Body Map silhouette but
// had no way back to the shipped default. There is nothing to "reset" in a
// database — useBodyImage() probes /uploads/bodymap/<type>.png → .svg → the
// bundled /<type>.png, so DELETING the uploaded override IS the reset.
//
// These tests pin that contract against the real server:
//   1. after an upload, the reset removes the served override,
//   2. the URL stops resolving, so the reader falls through to the default,
//   3. BOTH extensions go — either one left behind would keep shadowing,
//   4. the bundled default at the public/ ROOT is never touched,
//   5. resetting an already-default slot is idempotent, not a 404,
//   6. the type allowlist rejects garbage (shared with the upload route),
//   7. it is admin-only.

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

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

// This suite owns the 'man-back' slot (the upload suite owns 'woman-back', so
// the two can run in the same worker without fighting over the same files).
const SLOT = 'man-back';
const TWIN_PATHS = [
    path.join(bodymapDir, `${SLOT}.png`),
    path.join(bodymapDir, `${SLOT}.svg`),
];
const preExisting = new Map();

const rootDefaultPath = path.join(repoRoot, 'public', `${SLOT}.png`);
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
    return (await r.json()).token;
}

function bodyImageForm(bytes, filename, mimetype, type) {
    const fd = new FormData();
    fd.append('image', new Blob([bytes], { type: mimetype }), filename);
    fd.append('type', type);
    return fd;
}

describe('DELETE /api/body-image/:type — restores the bundled default', () => {
    let server;
    let adminToken;
    let educatorToken;

    const upload = (bytes, filename, mimetype) => fetch(`${server.baseUrl}/api/upload-body-image`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
        body: bodyImageForm(bytes, filename, mimetype, SLOT),
    });
    const reset = (type = SLOT, token = adminToken) => fetch(`${server.baseUrl}/api/body-image/${type}`, {
        method: 'DELETE',
        headers: token ? { authorization: `Bearer ${token}` } : {},
    });

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
             VALUES (110, 'reset_admin', 'Reset Admin', ?, 'reset@example.com', 'admin', 'active', 1)`,
            [hash]
        );
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (111, 'reset_teacher', 'Reset Teacher', ?, 'rt@example.com', 'educator', 'active', 1)`,
            [hash]
        );
        await dbClose(db);
        adminToken = await loginAs(server, 'reset_admin', 'correctpass');
        educatorToken = await loginAs(server, 'reset_teacher', 'correctpass');
    }, 90_000);

    afterAll(async () => {
        await server?.close();
        for (const p of TWIN_PATHS) {
            if (preExisting.has(p)) fs.writeFileSync(p, preExisting.get(p));
            else if (fs.existsSync(p)) fs.unlinkSync(p);
        }
    });

    it('removes an uploaded override and reports what it removed', async () => {
        expect((await upload(PNG_BYTES, `${SLOT}.png`, 'image/png')).status).toBe(200);
        expect(fs.existsSync(TWIN_PATHS[0])).toBe(true);

        const r = await reset();
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.success).toBe(true);
        expect(j.wasCustom).toBe(true);
        expect(j.removed).toEqual([`${SLOT}.png`]);
        expect(fs.existsSync(TWIN_PATHS[0])).toBe(false);
    });

    it('stops serving the override, so the reader falls through to the default', async () => {
        expect((await upload(PNG_BYTES, `${SLOT}.png`, 'image/png')).status).toBe(200);
        expect((await fetch(`${server.baseUrl}/uploads/bodymap/${SLOT}.png`)).status).toBe(200);

        await reset();

        // 404 is what drives useBodyImage()'s onError to the next candidate.
        expect((await fetch(`${server.baseUrl}/uploads/bodymap/${SLOT}.png`)).status).toBe(404);
    });

    it('removes BOTH extensions — a leftover twin would keep shadowing', async () => {
        // The upload route drops the stale twin, so write both directly to
        // build the state a reset has to survive.
        fs.mkdirSync(bodymapDir, { recursive: true });
        fs.writeFileSync(TWIN_PATHS[0], PNG_BYTES);
        fs.writeFileSync(TWIN_PATHS[1], SVG_BYTES);

        const j = await (await reset()).json();
        expect(j.removed).toEqual([`${SLOT}.png`, `${SLOT}.svg`]);
        expect(fs.existsSync(TWIN_PATHS[0])).toBe(false);
        expect(fs.existsSync(TWIN_PATHS[1])).toBe(false);
    });

    it('never touches the bundled default at the public/ root', async () => {
        await upload(PNG_BYTES, `${SLOT}.png`, 'image/png');
        await reset();

        if (rootDefaultBytes) {
            expect(fs.readFileSync(rootDefaultPath).equals(rootDefaultBytes)).toBe(true);
        } else {
            expect(fs.existsSync(rootDefaultPath)).toBe(false);
        }
    });

    it('is idempotent — resetting an already-default slot is a success, not a 404', async () => {
        await reset(); // ensure clean
        const r = await reset();
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.wasCustom).toBe(false);
        expect(j.removed).toEqual([]);
    });

    it('rejects a slot name outside the allowlist', async () => {
        const r = await reset('../../etc/passwd');
        // Express normalises the traversal to a non-matching path (404); a
        // plain bad name reaches the handler and is refused by the allowlist.
        expect([400, 404]).toContain(r.status);

        const r2 = await reset('man-sideways');
        expect(r2.status).toBe(400);
        expect((await r2.json()).code).toBe('INVALID_BODY_IMAGE_TYPE');
    });

    it('is admin-only', async () => {
        expect((await reset(SLOT, educatorToken)).status).toBe(403);
        expect((await reset(SLOT, null)).status).toBe(401);
    });
});
