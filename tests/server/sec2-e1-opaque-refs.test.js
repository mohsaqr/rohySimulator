// Learners address plugin content through SEALED references.
//
// Regression lock: the learner projection of the PACS catalog kept the bundle
// path as the entry id (`abnormal/rul_nodule`) and passed `series[]` through
// whole — its `description` repeated the finding and its `ref` the path — and
// every content URL a learner's browser loaded named the finding
// (`/api/plugins/pacs/dicom/abnormal/<finding>/…`,
// `/api/plugins/pathology/tiles/cardiac-mi-…dzi`). Security audit 2026-10-26,
// F-25 / L4-01. Also L4-06 (the managed library is per tenant, and only the
// slide's own files are content) and the I-2/I-4 serving fixes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer } from '../utils/startTestServer.js';
import {
    opaqueRemoteRef, opaqueRemoteRefs, opaqueArchiveId, opaqueLearnerDocument, openOpaqueSegments,
} from '../../server/lib/pluginOpaqueRefs.js';

const SECRET = 'sec2-e1-opaque-secret';
process.env.JWT_SECRET = SECRET;

const sealedSegments = (ref) => ref.slice('remote:'.length).split('/');

describe('pluginOpaqueRefs — the seal', () => {
    it('round-trips a series directory, a descriptor and its tiles', () => {
        const dir = opaqueRemoteRef('pacs', 'remote:dicom/abnormal/rul_nodule/s1/');
        expect(dir).toMatch(/^remote:_o\/[0-9a-f]+$/);
        expect(dir).not.toMatch(/abnormal|rul|nodule|dicom/);
        expect(openOpaqueSegments('pacs', [...sealedSegments(dir), 'index.json']))
            .toEqual({ opaque: true, segments: ['dicom', 'abnormal', 'rul_nodule', 's1', 'index.json'] });

        const dzi = opaqueRemoteRef('pathology', 'remote:tiles/cardiac-mi-05-neutrophils.dzi');
        expect(dzi).toMatch(/^remote:_o\/[0-9a-f]+\.dzi$/);
        const [, token] = sealedSegments(dzi);
        expect(openOpaqueSegments('pathology', ['_o', token]).segments).toEqual(['tiles', 'cardiac-mi-05-neutrophils.dzi']);
        const stem = token.slice(0, -'.dzi'.length);
        expect(openOpaqueSegments('pathology', ['_o', `${stem}_files`, '12', '3_4.jpeg']).segments)
            .toEqual(['tiles', 'cardiac-mi-05-neutrophils_files', '12', '3_4.jpeg']);
    });

    it('is deterministic, and its length does not separate normal from abnormal', () => {
        const a = opaqueRemoteRef('pacs', 'remote:dicom/normal/ct_chest/s1/');
        expect(opaqueRemoteRef('pacs', 'remote:dicom/normal/ct_chest/s1')).toBe(a);
        expect(opaqueRemoteRef('pacs', 'remote:dicom/abnormal/ct_chest/s1/')).toHaveLength(a.length);
        expect(opaqueArchiveId('pacs', 'abnormal/rul_nodule')).toBe(opaqueArchiveId('pacs', 'abnormal/rul_nodule'));
        expect(opaqueArchiveId('pacs', 'abnormal/rul_nodule')).not.toBe(opaqueArchiveId('pacs', 'normal/ct_chest'));
    });

    it('opens nothing for a forged, altered, foreign or wrongly-suffixed token', () => {
        const [, token] = sealedSegments(opaqueRemoteRef('pacs', 'remote:dicom/normal/ct_chest/s1/'));
        const flipped = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
        expect(openOpaqueSegments('pacs', ['_o', flipped]).segments).toBeNull();
        expect(openOpaqueSegments('pathology', ['_o', token]).segments).toBeNull();
        expect(openOpaqueSegments('pacs', ['_o', `${token}.html`]).segments).toBeNull();
        expect(openOpaqueSegments('pacs', ['_o', 'zz']).segments).toBeNull();
        expect(openOpaqueSegments('pacs', ['_o', '00'.repeat(80)]).segments).toBeNull();
        // An archive id never opens as a path.
        expect(openOpaqueSegments('pacs', ['_o', opaqueArchiveId('pacs', 'dicom/normal/ct_chest/s1')]).segments).toBeNull();
        expect(openOpaqueSegments('pacs', ['dicom', 'x'])).toEqual({ opaque: false });
    });

    it('seals a learner document: remote references and archive baselines, nothing else', () => {
        const doc = {
            worklist: [{
                id: 'study_ct_chest', studyId: 'ct_chest', description: 'CT chest',
                baseline: { kind: 'archive', ref: 'abnormal/rul_nodule' },
                substitutions: [{ ref: 'remote:dicom/abnormal/rul_nodule/s1/', at: 3 }],
            }],
            other: 'https://example.org/x.png',
        };
        const out = opaqueLearnerDocument('pacs', doc);
        expect(JSON.stringify(out)).not.toMatch(/abnormal|rul_nodule/);
        expect(out.worklist[0].baseline).toEqual({ kind: 'archive', ref: opaqueArchiveId('pacs', 'abnormal/rul_nodule') });
        expect(out.worklist[0].studyId).toBe('ct_chest');
        expect(out.other).toBe('https://example.org/x.png');
        expect(opaqueRemoteRefs('pacs', out)).toEqual(out); // idempotent
    });
});

// --- through the server ----------------------------------------------------

const DESCRIPTION = 'Right upper lobe nodule, spiculated';
const SERIES_DESCRIPTION = 'AXIAL CHEST — RUL NODULE (SIMULATED)';
const ARCHIVE = {
    version: 1,
    name: 'Fixture archive',
    entries: [
        {
            id: 'normal/ct_chest_adult',
            studyId: 'ct_chest',
            modality: 'CT',
            label: 'Normal chest CT',
            description: 'Apices to bases.',
            series: [{ key: 's1', description: 'AXIAL CHEST', plane: 'axial', instances: 1, frames: 1, ref: 'remote:dicom/normal/ct_chest_adult/s1/' }],
        },
        {
            id: 'abnormal/rul_nodule',
            studyId: 'ct_chest',
            modality: 'CT',
            label: 'RUL nodule',
            description: DESCRIPTION,
            series: [{
                key: 's1', description: SERIES_DESCRIPTION, plane: 'axial', instances: 1, frames: 1,
                ref: 'remote:dicom/abnormal/rul_nodule/s1/', geometry: { rows: 4, columns: 4 },
            }],
            review: { state: 'confirmed', finding: 'nodule' },
        },
    ],
};

const DZI = '<?xml version="1.0"?><Image TileSize="256" Overlap="0" Format="jpg" xmlns="http://schemas.microsoft.com/deepzoom/2008"><Size Width="10" Height="10"/></Image>';
const JPEG = Buffer.from('ffd8ffdb00', 'hex');

function fixtureContent() {
    const root = mkdtempSync(join(tmpdir(), 'rohy-sec2-e1-'));
    const pacs = join(root, 'starter', 'pacs');
    for (const id of ['normal/ct_chest_adult', 'abnormal/rul_nodule']) {
        mkdirSync(join(pacs, 'dicom', id, 's1'), { recursive: true });
        writeFileSync(join(pacs, 'dicom', id, 's1', 'index.json'), JSON.stringify({ version: 1, instances: ['001.dcm'] }));
        writeFileSync(join(pacs, 'dicom', id, 's1', '001.dcm'), Buffer.from(`DICM ${id}`));
    }
    writeFileSync(join(pacs, 'catalog.json'), JSON.stringify(ARCHIVE));
    writeFileSync(join(pacs, 'content.json'), JSON.stringify({ plugin: 'pacs', version: 'fixture', paths: ['/dicom'] }));
    // A symlink inside the bundle that points outside it.
    const outside = join(root, 'outside.json');
    writeFileSync(outside, '{"secret":true}');
    symlinkSync(outside, join(pacs, 'dicom', 'normal', 'ct_chest_adult', 's1', 'leak.json'));

    const pathology = join(root, 'starter', 'pathology');
    mkdirSync(join(pathology, 'tiles', 'cardiac-mi-neutrophils_files', '0'), { recursive: true });
    writeFileSync(join(pathology, 'tiles', 'cardiac-mi-neutrophils.dzi'), DZI);
    writeFileSync(join(pathology, 'tiles', 'cardiac-mi-neutrophils_files', '0', '0_0.jpg'), JPEG);
    writeFileSync(join(pathology, 'catalog.json'), JSON.stringify({ schemaVersion: '1.0.0', version: 1, assets: [] }));
    writeFileSync(join(pathology, 'content.json'), JSON.stringify({ plugin: 'pathology', version: 'fixture', paths: ['/tiles'] }));

    const library = join(root, 'library');
    const own = 'asset-000000000000000000000001';
    const foreign = 'asset-000000000000000000000002';
    for (const id of [own, foreign]) {
        mkdirSync(join(library, id, 'slide_files', '0'), { recursive: true });
        mkdirSync(join(library, id, 'source'), { recursive: true });
        writeFileSync(join(library, id, 'slide.dzi'), DZI);
        writeFileSync(join(library, id, 'slide_files', '0', '0_0.jpeg'), JPEG);
        writeFileSync(join(library, id, 'gross.webp'), Buffer.from('RIFF0000WEBPVP8 '));
        writeFileSync(join(library, id, 'source', 'original.jpg'), JPEG);
    }
    mkdirSync(join(library, `.${own}.importing-abcd`), { recursive: true });
    writeFileSync(join(library, `.${own}.importing-abcd`, 'slide.dzi'), DZI);
    return { root, starter: join(root, 'starter'), library, own, foreign };
}

function withDb(dbPath, work) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, async (e) => {
            if (e) return reject(e);
            const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, (err) => (err ? rej(err) : res())));
            const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows))));
            try { resolve(await work({ run, all })); } catch (err) { reject(err); } finally { db.close(); }
        });
    });
}

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
const authed = (baseUrl, token) => (path) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
const contentUrl = (pluginId, ref, ...rest) => `/api/plugins/${pluginId}/${[...sealedSegments(ref), ...rest].join('/')}`;

describe('sealed references through the content proxy', () => {
    let server; let fixture; let admin; let student; let studentId;

    beforeAll(async () => {
        fixture = fixtureContent();
        server = await startTestServer({
            seed: false,
            env: {
                JWT_SECRET: SECRET,
                ROHY_PLUGIN_ORIGINS: '',
                ROHY_STARTER_CONTENT_DIR: fixture.starter,
                ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${fixture.library}`,
            },
        });
        const hash = await bcrypt.hash('Student1!', 4);
        studentId = await withDb(server.dbPath, async ({ run, all }) => {
            await run(`INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (2, 'Other', 'other')`);
            await run(
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('sec2-student', 'sec2-student', 'sec2-student@example.com', ?, 'student', 1, 'active')`, [hash]);
            await run(`INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state) VALUES (?, 1, 'pathology', 'Own slide', 'ready')`, [fixture.own]);
            await run(`INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state) VALUES (?, 2, 'pathology', 'Other tenant slide', 'ready')`, [fixture.foreign]);
            return (await all(`SELECT id FROM users WHERE username = 'sec2-student'`))[0].id;
        });
        admin = authed(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        student = authed(server.baseUrl, await login(server.baseUrl, 'sec2-student', 'Student1!'));
    }, 90_000);

    afterAll(async () => {
        await server?.close();
        if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    });

    it('a learner\'s catalog carries no description, label, finding or bundle path', async () => {
        const res = await student('/api/plugins/pacs/catalog');
        expect(res.status).toBe(200);
        const { catalog } = await res.json();
        const text = JSON.stringify(catalog);
        for (const leak of ['abnormal', 'rul_nodule', 'RUL', 'nodule', DESCRIPTION, SERIES_DESCRIPTION, 'AXIAL CHEST', 'dicom/', 'Normal chest CT', 'confirmed']) {
            expect(text).not.toContain(leak);
        }
        expect(catalog.entries).toHaveLength(2);
        const byId = new Map(catalog.entries.map((e) => [e.id, e]));
        const normal = byId.get(opaqueArchiveId('pacs', 'normal/ct_chest_adult'));
        const abnormal = byId.get(opaqueArchiveId('pacs', 'abnormal/rul_nodule'));
        // A plain order still resolves to the normal example only (Radoyon's
        // studyForOrder matches studyId), so the abnormal entry has none.
        expect(normal.studyId).toBe('ct_chest');
        expect(abnormal.studyId).toBeUndefined();
        expect(abnormal.series[0]).toEqual({
            key: 's1', plane: 'axial', instances: 1, frames: 1, geometry: { rows: 4, columns: 4 },
            ref: opaqueRemoteRef('pacs', 'remote:dicom/abnormal/rul_nodule/s1/'),
        });
    });

    it('an author still gets the catalog as it stands', async () => {
        const { catalog } = await (await admin('/api/plugins/pacs/catalog')).json();
        expect(catalog).toEqual(ARCHIVE);
    });

    it('serves a sealed series to a learner; a tampered token is a 404', async () => {
        const ref = opaqueRemoteRef('pacs', 'remote:dicom/abnormal/rul_nodule/s1/');
        const index = await student(contentUrl('pacs', ref, 'index.json'));
        expect(index.status).toBe(200);
        expect(await index.json()).toEqual({ version: 1, instances: ['001.dcm'] });
        const instance = await student(contentUrl('pacs', ref, '001.dcm'));
        expect(instance.status).toBe(200);
        expect(instance.headers.get('content-type')).toBe('application/dicom');
        expect(Buffer.from(await instance.arrayBuffer()).toString()).toBe('DICM abnormal/rul_nodule');

        const [, token] = sealedSegments(ref);
        const forged = `${token.slice(0, -2)}${token.endsWith('00') ? '11' : '00'}`;
        expect((await student(`/api/plugins/pacs/_o/${forged}/index.json`)).status).toBe(404);
        // A sealed path still passes the manifest's declared prefixes.
        const undeclared = opaqueRemoteRef('pacs', 'remote:secret/keys');
        expect((await student(contentUrl('pacs', undeclared))).status).toBe(403);
    });

    it('a sealed slide descriptor and its tiles load, and the read is recorded under the REAL path', async () => {
        const dzi = opaqueRemoteRef('pathology', 'remote:tiles/cardiac-mi-neutrophils.dzi');
        const res = await student(contentUrl('pathology', dzi));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(DZI);
        const [, token] = sealedSegments(dzi);
        const tile = await student(`/api/plugins/pathology/_o/${token.slice(0, -4)}_files/0/0_0.jpg`);
        expect(tile.status).toBe(200);
        expect(tile.headers.get('content-type')).toBe('image/jpeg');
        // The course gate compares reads against the case document's real
        // references, so the read must be recorded under the real path.
        await new Promise((r) => setTimeout(r, 200));
        const rows = await withDb(server.dbPath, ({ all }) => all(
            'SELECT path FROM plugin_content_reads WHERE user_id = ? AND plugin_id = ?', [studentId, 'pathology']));
        expect(rows.map((r) => r.path)).toContain('tiles/cardiac-mi-neutrophils.dzi');
    });

    it('does not follow a symlink out of the content directory', async () => {
        const res = await admin('/api/plugins/pacs/dicom/normal/ct_chest_adult/s1/leak.json');
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain('secret');
    });

    it('the managed library is the owning tenant\'s, and only the slide\'s own files', async () => {
        // Regression lock: /library/<id>/… was served to any tenant, with source/ originals and import staging
        expect((await student(`/api/plugins/pathology/library/${fixture.own}/slide.dzi`)).status).toBe(200);
        expect((await student(`/api/plugins/pathology/library/${fixture.own}/slide_files/0/0_0.jpeg`)).status).toBe(200);
        expect((await student(`/api/plugins/pathology/library/${fixture.foreign}/slide.dzi`)).status).toBe(404);
        expect((await admin(`/api/plugins/pathology/library/${fixture.foreign}/slide.dzi`)).status).toBe(404);
        expect((await student(`/api/plugins/pathology/library/${fixture.own}/source/original.jpg`)).status).toBe(404);
        expect((await student(`/api/plugins/pathology/library/.${fixture.own}.importing-abcd/slide.dzi`)).status).toBe(404);
        // A sealed library reference goes through the same checks.
        const sealedForeign = opaqueRemoteRef('pathology', `remote:library/${fixture.foreign}/slide.dzi`);
        expect((await student(contentUrl('pathology', sealedForeign))).status).toBe(404);
    });

    it('serves a library .webp as image/webp, not image/jpeg', async () => {
        const res = await student(`/api/plugins/pathology/library/${fixture.own}/gross.webp`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/webp');
    });
});
