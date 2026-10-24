// POST /api/upload and POST /api/bodymap-regions hardening.
//
// Regression lock: /api/upload accepted any signed-in role (students included), 100 MB per request, any bytes under an image name, and wrote no audit row; /api/bodymap-regions let an educator overwrite the file every learner downloads with arbitrary JSON (security audit 2026-10-24)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, login, all } from '../utils/authHttp.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const uploadsDir = path.join(repoRoot, 'public', 'uploads');
const regionsFile = path.join(repoRoot, 'public', 'bodymap-regions.json');

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const HTML_AS_PNG = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const MP3 = Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000');

let server;
let tokens;
let regionsBefore = null;
const createdUploads = [];

beforeAll(async () => {
    regionsBefore = fs.existsSync(regionsFile) ? fs.readFileSync(regionsFile) : null;
    server = await startTestServer({ seed: false });
    const db = await openDb(server.dbPath);
    for (const role of ['student', 'educator', 'admin']) await seedUser(db, { username: `up_${role}`, role });
    await closeDb(db);
    tokens = {};
    for (const role of ['student', 'educator', 'admin']) tokens[role] = await login(server.baseUrl, `up_${role}`);
}, 90_000);

afterAll(async () => {
    for (const file of createdUploads) fs.rmSync(path.join(uploadsDir, file), { force: true });
    if (regionsBefore === null) fs.rmSync(regionsFile, { force: true });
    else fs.writeFileSync(regionsFile, regionsBefore);
    await server?.close();
});

function uploadAs(role, { bytes, type, name, field = 'photo' }) {
    const form = new FormData();
    form.append(field, new Blob([bytes], { type }), name);
    return fetch(`${server.baseUrl}/api/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens[role]}` },
        body: form,
    });
}
const uploadsListing = () => new Set(fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);

describe('POST /api/upload', () => {
    it('refuses a student (educator-gated)', async () => {
        const res = await uploadAs('student', { bytes: PNG, type: 'image/png', name: 'a.png' });
        expect(res.status).toBe(403);
    });

    it('accepts a real PNG from an educator and audits it', async () => {
        const res = await uploadAs('educator', { bytes: PNG, type: 'image/png', name: 'scan.png' });
        expect(res.status).toBe(200);
        const { imageUrl } = await res.json();
        const filename = path.basename(imageUrl);
        createdUploads.push(filename);
        expect(fs.existsSync(path.join(uploadsDir, filename))).toBe(true);

        const db = await openDb(server.dbPath);
        const rows = await all(db, `SELECT action, resource_type, resource_id FROM system_audit_log WHERE action = 'upload_media'`);
        await closeDb(db);
        expect(rows).toContainEqual({ action: 'upload_media', resource_type: 'upload', resource_id: filename });
    });

    it('accepts non-image media without a byte sniff (audio)', async () => {
        const res = await uploadAs('educator', { bytes: MP3, type: 'audio/mpeg', name: 'heart.mp3' });
        expect(res.status).toBe(200);
        createdUploads.push(path.basename((await res.json()).imageUrl));
    });

    it('refuses HTML bytes declared as a PNG with 415 and leaves nothing on disk', async () => {
        const before = uploadsListing();
        const res = await uploadAs('educator', { bytes: HTML_AS_PNG, type: 'image/png', name: 'evil.png' });
        expect(res.status).toBe(415);
        expect((await res.json()).code).toBe('unsupported_media_type');
        const added = [...uploadsListing()].filter((f) => !before.has(f));
        expect(added).toEqual([]);
    });

    it('refuses a disallowed type with 415 (not 500)', async () => {
        const res = await uploadAs('educator', { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg' });
        expect(res.status).toBe(415);
    });

    it('caps the size at 25 MB with 413', async () => {
        const before = uploadsListing();
        const big = Buffer.alloc(25 * 1024 * 1024 + 1024, 0);
        PNG.copy(big);
        const res = await uploadAs('educator', { bytes: big, type: 'image/png', name: 'big.png' });
        expect(res.status).toBe(413);
        const added = [...uploadsListing()].filter((f) => !before.has(f));
        createdUploads.push(...added); // multer removes it; belt and braces
    }, 60_000);
});

describe('POST /api/bodymap-regions', () => {
    const save = (role, body) => fetch(`${server.baseUrl}/api/bodymap-regions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    it('is admin-only now (an educator gets 403)', async () => {
        expect((await save('educator', { regions: [] })).status).toBe(403);
        expect((await save('student', { regions: [] })).status).toBe(403);
    });

    it.each([
        ['not an array', { regions: { a: 1 } }],
        ['a non-object entry', { regions: ['x'] }],
        ['a nested value', { regions: [{ id: 'a', points: [1, 2] }] }],
        ['too many entries', { regions: Array.from({ length: 501 }, (_, i) => ({ id: `r${i}` })) }],
    ])('refuses %s with 400', async (_label, body) => {
        const res = await save('admin', body);
        expect(res.status).toBe(400);
    });

    it('refuses an oversized document (the 256 KB body limit and the route cap agree)', async () => {
        const res = await save('admin', { regions: [{ id: 'a', label: 'x'.repeat(300 * 1024) }] });
        expect([400, 413]).toContain(res.status);
    });

    it('saves flat string/number regions for an admin and audits it', async () => {
        const regions = [{ id: 'chest', label: 'Chest', x: 10, y: 20, w: 30, h: 40 }];
        const res = await save('admin', { regions });
        expect(res.status).toBe(200);
        expect(JSON.parse(fs.readFileSync(regionsFile, 'utf8'))).toEqual({ regions });
        const db = await openDb(server.dbPath);
        const rows = await all(db, `SELECT action FROM system_audit_log WHERE action = 'save_bodymap_regions'`);
        await closeDb(db);
        expect(rows.length).toBe(1);
    });
});
