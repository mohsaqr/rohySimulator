// Regression lock: a case moved between servers lost its agents, labs/imaging, rubric AND every image, slide and study
//
// Two real servers, two databases, two slide libraries, two sets of shipped
// content. A case on the SOURCE uses an uploaded radiology image, a pathology
// slide from its managed library (with a scanner original that must NOT
// travel), a slide from the shipped content, and a PACS study through the
// archive catalogue. It is exported as a .rohycase package, uploaded to the
// TARGET in chunks, and imported.
//
// Locks:
//   - the feature is OFF by default and admin-only;
//   - the upload and the library slide arrive (bytes equal), with the slide's
//     calibration row; the scanner original does not;
//   - shipped content is referenced, not carried, and the target reports what
//     it lacks;
//   - every guard: a hostile archive, an undeclared or altered file, an HTML
//     file posing as an image, a full disk, an occupied slide id (never
//     overwritten), a newer format;
//   - nothing is left behind by a refused import.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, all, seedUser, asUser } from '../utils/authHttp.js';
import { createTarWriter, readTar } from '../../server/lib/tarStream.js';

const UPLOADS = join(process.cwd(), 'public', 'uploads');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const JPEG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg:${tag}`)]);
const PNG = (tag) => Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from(`png:${tag}`)]);
const DZI = (w, h) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpeg" Overlap="0" TileSize="512"><Size Width="${w}" Height="${h}"/></Image>`);

/** Write files under root and a content.json listing them, as setup:content does. */
function writeContent(root, plugin, files, catalog) {
    const dir = join(root, plugin);
    mkdirSync(dir, { recursive: true });
    const listing = [];
    for (const [rel, bytes] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), bytes);
        listing.push({ path: rel, bytes: bytes.length, sha256: sha(bytes) });
    }
    if (catalog) {
        writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog));
    }
    writeFileSync(join(dir, 'content.json'), JSON.stringify({ schemaVersion: '1.0.0', plugin, starter: true, files: listing }));
}

const PACS_CATALOG = {
    version: 1, name: 'test', entries: [{
        id: 'normal/ct_test', studyId: 'ct_test', label: 'CT test',
        series: [{ key: 's1', ref: 'remote:dicom/normal/ct_test/s1/' }],
    }],
};
const PACS_FILES = {
    'dicom/normal/ct_test/s1/index.json': Buffer.from('{"instances":["000.dcm"]}'),
    'dicom/normal/ct_test/s1/000.dcm': randomBytes(300),
};

async function poll(call, jobId) {
    for (let i = 0; i < 200; i++) {
        const job = await (await call(`/api/case-packages/jobs/${jobId}`)).json();
        if (job.state === 'done' || job.state === 'failed') return job;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('job did not finish');
}

/** Upload a package in chunks and wait for its import job. */
async function importPackage(call, bytes, chunk = 64 * 1024) {
    const created = await call('/api/case-packages/uploads', { method: 'POST', json: { bytes: bytes.length } });
    if (created.status !== 201) return { status: created.status, body: await created.json() };
    const { id } = await created.json();
    for (let i = 0, index = 0; i < bytes.length; i += chunk, index++) {
        const res = await call(`/api/case-packages/uploads/${id}/chunks/${index}`, {
            method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes.subarray(i, i + chunk),
        });
        if (res.status !== 200) return { status: res.status, body: await res.json() };
    }
    const done = await call(`/api/case-packages/uploads/${id}/complete`, { method: 'POST' });
    if (done.status !== 202) return { status: done.status, body: await done.json() };
    return { status: 202, job: await poll(call, (await done.json()).id) };
}

/** Build a package by hand: [name, Buffer] entries in order. */
async function handmade(dir, entries) {
    const file = join(dir, `hand-${randomBytes(4).toString('hex')}.rohycase`);
    const writer = createTarWriter(createWriteStream(file));
    for (const [name, data] of entries) await writer.addBuffer(name, data);
    await writer.finish();
    return readFileSync(file);
}

describe('case packages: export from one server, import into another', () => {
    let fx; let source; let target; let srcAdmin; let tgtAdmin; let srcStudent;
    let caseId; let pkg; let uploadName; let uploadBytes;
    const assetId = `asset-${'a1'.repeat(12)}`;
    const createdUploads = [];

    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-'));
        // SOURCE ships the starter slide + the PACS study; TARGET ships the PACS study only.
        const starterSlide = { 'tiles/starter.dzi': DZI(512, 512), 'tiles/starter_files/0/0_0.jpeg': JPEG('starter-tile') };
        writeContent(join(fx, 'src-content'), 'pathology', starterSlide);
        writeContent(join(fx, 'src-content'), 'pacs', PACS_FILES, PACS_CATALOG);
        writeContent(join(fx, 'tgt-content'), 'pathology', {});
        writeContent(join(fx, 'tgt-content'), 'pacs', PACS_FILES, PACS_CATALOG);

        // A managed slide in the SOURCE library, scanner original included.
        const lib = join(fx, 'src-content', 'pathology', 'library', assetId);
        mkdirSync(join(lib, 'slide_files', '0'), { recursive: true });
        mkdirSync(join(lib, 'source'), { recursive: true });
        writeFileSync(join(lib, 'slide.dzi'), DZI(1024, 768));
        writeFileSync(join(lib, 'slide_files', '0', '0_0.jpeg'), JPEG('lib-tile'));
        writeFileSync(join(lib, 'preview.jpg'), JPEG('lib-preview'));
        writeFileSync(join(lib, 'source', 'original.ndpi'), randomBytes(2048));

        const env = (side) => ({
            ROHY_STARTER_CONTENT_DIR: join(fx, `${side}-content`),
            ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${join(fx, `${side}-content`, 'pathology', 'library')}`,
            ROHY_CASE_PACKAGE_DIR: join(fx, `${side}-work`),
        });
        mkdirSync(join(fx, 'tgt-content', 'pathology', 'library'), { recursive: true });
        [source, target] = await Promise.all([
            startTestServer({ seed: false, env: env('src') }),
            startTestServer({ seed: false, env: env('tgt') }),
        ]);
        for (const server of [source, target]) {
            const db = await openDb(server.dbPath);
            await seedUser(db, { username: 'pkg-admin', role: 'admin' });
            await seedUser(db, { username: 'pkg-student', role: 'student' });
            await closeDb(db);
        }
        srcAdmin = await asUser(source.baseUrl, 'pkg-admin');
        tgtAdmin = await asUser(target.baseUrl, 'pkg-admin');
        srcStudent = await asUser(source.baseUrl, 'pkg-student');

        uploadBytes = PNG(randomBytes(8).toString('hex'));
        uploadName = `ct-pkg-${randomBytes(6).toString('hex')}.png`;
        // Regression lock: public/uploads is gitignored, so a fresh checkout (CI) has none — writing into it failed every CI run since rc.26
        mkdirSync(UPLOADS, { recursive: true });
        writeFileSync(join(UPLOADS, uploadName), uploadBytes);
        createdUploads.push(uploadName);

        const created = await srcAdmin('/api/cases', {
            method: 'POST',
            json: {
                name: 'PKG Case',
                description: 'Moves between servers',
                config: {
                    patient_name: 'Ada Example',
                    radiology: [{ id: 'r1', studyName: 'CXR', imageUrl: `./uploads/${uploadName}` }],
                    pathology: {
                        slides: [
                            { id: 'lib', label: 'Library slide', dzi: `remote:library/${assetId}/slide.dzi`, nativeObjective: 40, nativeMpp: 0.25 },
                            { id: 'shipped', label: 'Shipped slide', dzi: 'remote:tiles/starter.dzi' },
                        ],
                    },
                    pacs: { version: 1, worklist: [{ id: 'w1', baseline: { kind: 'archive', ref: 'normal/ct_test' } }] },
                },
            },
        });
        expect(created.status).toBe(200);
        caseId = (await created.json()).id;
        const db = await openDb(source.dbPath);
        await run(db,
            `INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state, native_objective, native_mpp_x, native_mpp_y,
                                        tiled_objective, width, height, created_at, updated_at)
             VALUES (?, 1, 'pathology', 'Library slide', 'ready', 40, 0.25, 0.25, 10, 1024, 768, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z')`,
            [assetId]);
        await run(db, `INSERT INTO case_investigations (case_id, investigation_type, test_name, tenant_id) VALUES (?, 'lab', 'PKG Troponin', 1)`, [caseId]);
        await closeDb(db);
    }, 120000);

    afterAll(async () => {
        await Promise.all([source?.close(), target?.close()]);
        for (const name of existsSync(UPLOADS) ? readdirSync(UPLOADS) : []) {
            if (createdUploads.includes(name) || /^pkg-[0-9a-f]{16}-ct-pkg-/.test(name)) rmSync(join(UPLOADS, name), { force: true });
        }
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('is off by default', async () => {
        const res = await srcAdmin(`/api/cases/${caseId}/package`, { method: 'POST' });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('case_packages_disabled');
        expect(await (await srcAdmin('/api/platform-settings/case-packages')).json()).toMatchObject({ enabled: false });
    });

    it('is admin-only, the switch included', async () => {
        expect((await srcStudent('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } })).status).toBe(403);
        expect((await srcStudent(`/api/cases/${caseId}/package`, { method: 'POST' })).status).toBe(403);
    });

    it('exports the case with its upload and library slide, not the scanner original or shipped content', async () => {
        for (const call of [srcAdmin, tgtAdmin]) {
            expect((await call('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } })).status).toBe(200);
        }
        const started = await srcAdmin(`/api/cases/${caseId}/package`, { method: 'POST' });
        expect(started.status).toBe(202);
        const job = await poll(srcAdmin, (await started.json()).id);
        expect(job.state).toBe('done');
        expect(job.result.counts).toEqual({ uploads: 1, slides: 1, referenced: 2 });

        const download = await srcAdmin(`/api/case-packages/jobs/${job.id}/download`);
        expect(download.status).toBe(200);
        expect(download.headers.get('content-disposition')).toMatch(/\.rohycase"$/);
        pkg = Buffer.from(await download.arrayBuffer());

        const names = [];
        let manifest;
        await readTar([pkg], ({ name }) => {
            names.push(name);
            const chunks = [];
            return { write: (c) => chunks.push(Buffer.from(c)), end: () => { if (name === 'manifest.json') manifest = JSON.parse(Buffer.concat(chunks)); } };
        });
        expect(names.slice(0, 2)).toEqual(['case.json', 'manifest.json']);
        const media = names.filter((n) => n.startsWith('media/'));
        // upload + dzi + tile + preview — no original, no shipped tiles, no DICOM.
        expect(media).toHaveLength(4);
        expect(manifest.library[0].files.map((f) => f.path).sort()).toEqual(['preview.jpg', 'slide.dzi', 'slide_files/0/0_0.jpeg']);
        expect(manifest.remote.map((r) => [r.plugin, r.path, r.carried]).sort()).toEqual([
            ['pacs', 'dicom/normal/ct_test/s1/', false],
            ['pathology', 'tiles/starter.dzi', false],
        ]);
    });

    it('imports into the other server: upload and slide land byte-equal, calibration kept, missing content reported', async () => {
        // The target has never seen the upload.
        rmSync(join(UPLOADS, uploadName));
        const { status, job } = await importPackage(tgtAdmin, pkg);
        expect(status).toBe(202);
        expect(job.state).toBe('done');
        const report = job.result;
        expect(report.imported).toMatchObject({ uploads: 1, slides: 1, investigations: 1 });
        expect(readFileSync(join(UPLOADS, uploadName)).equals(uploadBytes)).toBe(true);

        const lib = join(fx, 'tgt-content', 'pathology', 'library', assetId);
        expect(readFileSync(join(lib, 'slide.dzi')).equals(DZI(1024, 768))).toBe(true);
        expect(readFileSync(join(lib, 'slide_files', '0', '0_0.jpeg')).equals(JPEG('lib-tile'))).toBe(true);
        expect(existsSync(join(lib, 'source'))).toBe(false);

        const db = await openDb(target.dbPath);
        const asset = await get(db, 'SELECT tenant_id, state, native_objective, native_mpp_x, width, height FROM plugin_assets WHERE id = ?', [assetId]);
        const row = await get(db, 'SELECT config FROM cases WHERE id = ?', [report.case.id]);
        await closeDb(db);
        expect(asset).toEqual({ tenant_id: 1, state: 'ready', native_objective: 40, native_mpp_x: 0.25, width: 1024, height: 768 });
        expect(JSON.parse(row.config).pathology.slides[0].dzi).toBe(`remote:library/${assetId}/slide.dzi`);

        // Shipped slide the target lacks → named; PACS study the target has → silent.
        const fields = report.warnings.map((w) => w.received);
        expect(fields).toContain('remote:tiles/starter.dzi');
        expect(fields.some((f) => String(f).includes('dicom'))).toBe(false);

        // The target serves the imported slide.
        const served = await tgtAdmin(`/api/plugins/pathology/library/${assetId}/slide.dzi`);
        expect(served.status).toBe(200);
    });

    it('re-importing the same package reuses the slide and the upload rather than duplicating them', async () => {
        const { job } = await importPackage(tgtAdmin, pkg);
        expect(job.state).toBe('done');
        // Counted as available to the case, not as copied: a reused slide is still the case's slide.
        expect(job.result.imported).toMatchObject({ uploads: 1, slides: 1 });
        const libDir = join(fx, 'tgt-content', 'pathology', 'library');
        expect(readdirSync(libDir).filter((n) => !n.startsWith('.'))).toEqual([assetId]);
    });

    it('does not hand one tenant\'s slide to another: a second tenant gets its own copy and row', async () => {
        // Regression lock: reuse checked only the global asset id and the files, so tenant 2's import attached tenant 1's slide with no row of its own — missing from its slide picker and from its own exports (Codex review, 2026-10-10)
        const db = await openDb(target.dbPath);
        await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (2, 'pkg-t2', 'pkg-t2', 0)`);
        await seedUser(db, { username: 'pkg-admin-t2', role: 'admin', tenantId: 2 });
        await closeDb(db);
        const t2 = await asUser(target.baseUrl, 'pkg-admin-t2');
        const { job } = await importPackage(t2, pkg);
        expect(job.state).toBe('done');
        const db2 = await openDb(target.dbPath);
        const rows = await all(db2, `SELECT id, tenant_id FROM plugin_assets WHERE plugin_id = 'pathology' ORDER BY tenant_id`, []);
        const row = await get(db2, 'SELECT config FROM cases WHERE id = ?', [job.result.case.id]);
        await closeDb(db2);
        const t2Asset = rows.find((r) => r.tenant_id === 2);
        expect(rows.find((r) => r.tenant_id === 1).id).toBe(assetId);
        expect(t2Asset).toBeTruthy();
        expect(t2Asset.id).not.toBe(assetId);
        expect(JSON.parse(row.config).pathology.slides[0].dzi).toBe(`remote:library/${t2Asset.id}/slide.dzi`);
    });

    it('never overwrites a different slide that holds the same id; the import gets a new id', async () => {
        const db = await openDb(target.dbPath);
        const before = await all(db, 'SELECT id FROM plugin_assets', []);
        await closeDb(db);
        // Change the target's copy so it is no longer identical.
        const tile = join(fx, 'tgt-content', 'pathology', 'library', assetId, 'slide_files', '0', '0_0.jpeg');
        writeFileSync(tile, JPEG('locally-edited'));
        const { job } = await importPackage(tgtAdmin, pkg);
        expect(job.state).toBe('done');
        expect(readFileSync(tile).equals(JPEG('locally-edited'))).toBe(true);
        const db2 = await openDb(target.dbPath);
        const after = await all(db2, 'SELECT id FROM plugin_assets', []);
        const row = await get(db2, 'SELECT config FROM cases WHERE id = ?', [job.result.case.id]);
        await closeDb(db2);
        expect(after.length).toBe(before.length + 1);
        const newId = after.map((r) => r.id).find((id) => !before.some((b) => b.id === id));
        expect(JSON.parse(row.config).pathology.slides[0].dzi).toBe(`remote:library/${newId}/slide.dzi`);
    });

    describe('refused packages write nothing', () => {
        const count = async () => {
            const db = await openDb(target.dbPath);
            const { n } = await get(db, 'SELECT COUNT(*) AS n FROM cases', []);
            await closeDb(db);
            return n;
        };
        const caseJson = () => Buffer.from(JSON.stringify({
            rohy_export: { format: 'rohy.case', format_version: 2 },
            case: { name: 'Hand case', config: {} },
            related: {},
        }));
        const manifestFor = (uploads = []) => Buffer.from(JSON.stringify({ format: 'rohy.case-package', format_version: 1, uploads, library: [], remote: [] }));

        it('refuses a file the manifest does not declare', async () => {
            const before = await count();
            const bytes = await handmade(fx, [['case.json', caseJson()], ['manifest.json', manifestFor()], [`media/${sha(Buffer.from('x'))}`, Buffer.from('x')]]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.state).toBe('failed');
            expect(job.error.code).toBe('invalid_case_package');
            expect(await count()).toBe(before);
        });

        it('refuses a file whose bytes do not match its name', async () => {
            const real = PNG('real');
            const fake = PNG('fake');
            const bytes = await handmade(fx, [
                ['case.json', caseJson()],
                ['manifest.json', manifestFor([{ name: 'x.png', sha256: sha(real), bytes: real.length }])],
                [`media/${sha(real)}`, fake],
            ]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.error.code).toBe('case_package_checksum');
        });

        it('refuses an entry outside the allowlisted names', async () => {
            const bytes = await handmade(fx, [['case.json', caseJson()], ['manifest.json', manifestFor()], ['../../etc/evil', Buffer.from('x')]]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.error.code).toBe('invalid_case_package');
        });

        it('leaves out an HTML page posing as an image, and says so', async () => {
            const html = Buffer.from('<html><script>alert(1)</script></html>');
            const name = `ct-pkg-${randomBytes(6).toString('hex')}.png`;
            createdUploads.push(name);
            const bytes = await handmade(fx, [
                ['case.json', Buffer.from(JSON.stringify({
                    rohy_export: { format: 'rohy.case', format_version: 2 },
                    case: { name: 'XSS case', config: { radiology: [{ id: 'r', imageUrl: `./uploads/${name}` }] } },
                    related: {},
                }))],
                ['manifest.json', manifestFor([{ name, sha256: sha(html), bytes: html.length }])],
                [`media/${sha(html)}`, html],
            ]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.state).toBe('done');
            expect(existsSync(join(UPLOADS, name))).toBe(false);
            expect(job.result.warnings.some((w) => w.received === `/uploads/${name}`)).toBe(true);
        });

        it('keeps a real image whose extension is wrong, as the upload route does', async () => {
            // Regression lock: the import demanded the bytes match the extension, so a JPEG named .png — which POST /api/upload accepts, and rohy itself ships one — was silently dropped (found in the two-server browser round trip, 2026-10-10)
            const jpegAsPng = JPEG('mislabelled');
            const name = `ct-pkg-${randomBytes(6).toString('hex')}.png`;
            createdUploads.push(name);
            const bytes = await handmade(fx, [
                ['case.json', Buffer.from(JSON.stringify({
                    rohy_export: { format: 'rohy.case', format_version: 2 },
                    case: { name: 'Mislabelled image case', config: { radiology: [{ id: 'r', imageUrl: `./uploads/${name}` }] } },
                    related: {},
                }))],
                ['manifest.json', manifestFor([{ name, sha256: sha(jpegAsPng), bytes: jpegAsPng.length }])],
                [`media/${sha(jpegAsPng)}`, jpegAsPng],
            ]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.state).toBe('done');
            expect(readFileSync(join(UPLOADS, name)).equals(jpegAsPng)).toBe(true);
            expect(job.result.warnings).toEqual([]);
        });

        it('removes every placed file when the database write fails after placement', async () => {
            // Regression lock: the refusal tests only failed BEFORE placement; nothing proved a failure after files were placed leaves none behind (Codex review, 2026-10-10)
            const db = await openDb(target.dbPath);
            await run(db, `CREATE TRIGGER pkg_force_fail BEFORE INSERT ON cases WHEN NEW.name = 'PKG Rollback' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
            await closeDb(db);
            const image = PNG(`rollback-${randomBytes(4).toString('hex')}`);
            const name = `ct-pkg-${randomBytes(6).toString('hex')}.png`;
            createdUploads.push(name);
            const before = await count();
            try {
                const bytes = await handmade(fx, [
                    ['case.json', Buffer.from(JSON.stringify({
                        rohy_export: { format: 'rohy.case', format_version: 2 },
                        case: { name: 'PKG Rollback', config: { radiology: [{ id: 'r', imageUrl: `./uploads/${name}` }] } },
                        related: {},
                    }))],
                    ['manifest.json', manifestFor([{ name, sha256: sha(image), bytes: image.length }])],
                    [`media/${sha(image)}`, image],
                ]);
                const { job } = await importPackage(tgtAdmin, bytes);
                expect(job.state).toBe('failed');
                expect(existsSync(join(UPLOADS, name))).toBe(false);
                expect(await count()).toBe(before);
            } finally {
                const db2 = await openDb(target.dbPath);
                await run(db2, 'DROP TRIGGER pkg_force_fail');
                await closeDb(db2);
            }
        });

        it('places identical bytes under every name that uses them', async () => {
            // Regression lock: the package stores identical bytes once, and the import MOVED the one staged file — the second name failed with ENOENT and the whole import with it (Codex review, 2026-10-10)
            const image = PNG(`twin-${randomBytes(4).toString('hex')}`);
            const [a, b] = [`ct-pkg-${randomBytes(6).toString('hex')}.png`, `ct-pkg-${randomBytes(6).toString('hex')}.png`];
            createdUploads.push(a, b);
            const bytes = await handmade(fx, [
                ['case.json', Buffer.from(JSON.stringify({
                    rohy_export: { format: 'rohy.case', format_version: 2 },
                    case: { name: 'Twin images', config: { radiology: [{ id: 'a', imageUrl: `./uploads/${a}` }, { id: 'b', imageUrl: `./uploads/${b}` }] } },
                    related: {},
                }))],
                ['manifest.json', manifestFor([
                    { name: a, sha256: sha(image), bytes: image.length },
                    { name: b, sha256: sha(image), bytes: image.length },
                ])],
                [`media/${sha(image)}`, image],
            ]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.state).toBe('done');
            expect(readFileSync(join(UPLOADS, a)).equals(image)).toBe(true);
            expect(readFileSync(join(UPLOADS, b)).equals(image)).toBe(true);
        });

        it('accepts a resent chunk over HTTP and refuses other bytes under its index', async () => {
            // The concurrency guarantee itself is locked in case-package-internals.test.js, where the race is deterministic.
            const created = await tgtAdmin('/api/case-packages/uploads', { method: 'POST', json: { bytes: 8 } });
            const { id } = await created.json();
            const put = (index, body) => tgtAdmin(`/api/case-packages/uploads/${id}/chunks/${index}`, {
                method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body,
            });
            const results = await Promise.all([put(0, Buffer.from('abcd')), put(0, Buffer.from('abcd')), put(0, Buffer.from('abcd'))]);
            const received = await Promise.all(results.map((r) => r.json()));
            expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
            expect(received.map((r) => r.received)).toEqual([4, 4, 4]);
            expect((await put(0, Buffer.from('zzzz'))).status).toBe(409);
            expect((await tgtAdmin(`/api/case-packages/uploads/${id}`, { method: 'DELETE' })).status).toBe(204);
        });

        it('refuses a slide descriptor too large to be one', async () => {
            // Regression lock: a carried .dzi is read whole into memory; a "descriptor" near the package limit was a process-wide memory exhaustion (Codex review, 2026-10-10)
            const manifest = Buffer.from(JSON.stringify({
                format: 'rohy.case-package', format_version: 1, uploads: [], remote: [],
                library: [{
                    plugin: 'pathology', asset_id: `asset-${'b2'.repeat(12)}`, row: { label: 'big' },
                    files: [{ path: 'slide.dzi', sha256: 'c'.repeat(64), bytes: 512 * 1024 * 1024 }],
                }],
            }));
            const bytes = await handmade(fx, [['case.json', caseJson()], ['manifest.json', manifest]]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.error).toMatchObject({ code: 'invalid_case_package' });
            expect(job.error.error).toMatch(/descriptor/);
        });

        it('refuses a package from a newer format by name', async () => {
            const bytes = await handmade(fx, [['case.json', caseJson()], ['manifest.json', Buffer.from(JSON.stringify({ format: 'rohy.case-package', format_version: 9 }))]]);
            const { job } = await importPackage(tgtAdmin, bytes);
            expect(job.error.code).toBe('unsupported_case_package');
        });

        it('refuses chunks out of order and more bytes than declared', async () => {
            const created = await tgtAdmin('/api/case-packages/uploads', { method: 'POST', json: { bytes: 10 } });
            const { id } = await created.json();
            const put = (index, body) => tgtAdmin(`/api/case-packages/uploads/${id}/chunks/${index}`, {
                method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body,
            });
            expect((await put(1, Buffer.alloc(5))).status).toBe(409);
            expect((await put(0, Buffer.alloc(11))).status).toBe(400);
            expect((await tgtAdmin(`/api/case-packages/uploads/${id}/complete`, { method: 'POST' })).status).toBe(409);
            expect((await tgtAdmin(`/api/case-packages/uploads/${id}`, { method: 'DELETE' })).status).toBe(204);
        });

        it('another admin cannot read or download someone else\'s job', async () => {
            const db = await openDb(source.dbPath);
            await seedUser(db, { username: 'pkg-admin-2', role: 'admin' });
            await closeDb(db);
            const other = await asUser(source.baseUrl, 'pkg-admin-2');
            const started = await srcAdmin(`/api/cases/${caseId}/package`, { method: 'POST' });
            const { id } = await started.json();
            await poll(srcAdmin, id);
            expect((await other(`/api/case-packages/jobs/${id}`)).status).toBe(404);
            expect((await other(`/api/case-packages/jobs/${id}/download`)).status).toBe(404);
        });
    });
});

describe('case packages: a full disk refuses before writing', () => {
    let fx; let server; let admin;
    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-disk-'));
        server = await startTestServer({
            seed: false,
            // Demand more free space than any disk has.
            env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'work'), ROHY_CASE_PACKAGE_MIN_FREE_BYTES: String(2 ** 60) },
        });
        const db = await openDb(server.dbPath);
        await seedUser(db, { username: 'disk-admin', role: 'admin' });
        await closeDb(db);
        admin = await asUser(server.baseUrl, 'disk-admin');
        await admin('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } });
    }, 60000);
    afterAll(async () => {
        await server?.close();
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('answers 507 for an upload the disk cannot take', async () => {
        const res = await admin('/api/case-packages/uploads', { method: 'POST', json: { bytes: 1024 } });
        expect(res.status).toBe(507);
        expect((await res.json()).code).toBe('case_package_no_space');
    });
});

describe('case packages: content from a deployment\'s own origin is fetched, carried and placed', () => {
    let fx; let origin; let source; let target; let srcAdmin; let tgtAdmin; let originHits = 0;
    const originFiles = {
        'tiles/origin.dzi': DZI(640, 480),
        'tiles/origin_files/0/0_0.jpeg': JPEG('origin-tile'),
        'gross/specimen.jpg': JPEG('gross-photo'),
    };

    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-origin-'));
        const { createServer } = await import('node:http');
        const listing = Object.entries(originFiles).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) }));
        origin = createServer((req, res) => {
            originHits += 1;
            const rel = decodeURIComponent(req.url.replace(/^\//, ''));
            if (rel === 'content.json') {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ plugin: 'pathology', files: listing }));
            }
            if (originFiles[rel]) {
                res.writeHead(200);
                return res.end(originFiles[rel]);
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((r) => origin.listen(0, '127.0.0.1', r));
        const originUrl = `http://127.0.0.1:${origin.address().port}`;

        writeContent(join(fx, 'tgt-content'), 'pathology', {});
        mkdirSync(join(fx, 'tgt-content', 'pathology', 'library'), { recursive: true });
        [source, target] = await Promise.all([
            startTestServer({ seed: false, env: { ROHY_PLUGIN_ORIGINS: `pathology=${originUrl}`, ROHY_CASE_PACKAGE_DIR: join(fx, 'src-work') } }),
            startTestServer({
                seed: false,
                env: {
                    ROHY_STARTER_CONTENT_DIR: join(fx, 'tgt-content'),
                    ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${join(fx, 'tgt-content', 'pathology', 'library')}`,
                    ROHY_CASE_PACKAGE_DIR: join(fx, 'tgt-work'),
                },
            }),
        ]);
        for (const server of [source, target]) {
            const db = await openDb(server.dbPath);
            await seedUser(db, { username: 'org-admin', role: 'admin' });
            await closeDb(db);
        }
        srcAdmin = await asUser(source.baseUrl, 'org-admin');
        tgtAdmin = await asUser(target.baseUrl, 'org-admin');
        for (const call of [srcAdmin, tgtAdmin]) {
            await call('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } });
        }
    }, 120000);

    afterAll(async () => {
        await Promise.all([source?.close(), target?.close()]);
        await new Promise((r) => (origin ? origin.close(r) : r()));
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('moves an origin-only slide and photo into the target library, calibrated, and the target serves them', async () => {
        const created = await srcAdmin('/api/cases', {
            method: 'POST',
            json: {
                name: 'Origin case',
                config: {
                    pathology: {
                        slides: [{ id: 's', label: 'Origin slide', dzi: 'remote:tiles/origin.dzi', nativeObjective: 20, nativeMpp: 0.5 }],
                        gross: [{ id: 'g', source: { kind: 'catalog', uri: 'remote:gross/specimen.jpg' } }],
                    },
                },
            },
        });
        const { id } = await created.json();
        const started = await srcAdmin(`/api/cases/${id}/package`, { method: 'POST' });
        const job = await poll(srcAdmin, (await started.json()).id);
        expect(job.state).toBe('done');
        expect(job.result.counts).toMatchObject({ slides: 2, referenced: 0 });
        expect(originHits).toBeGreaterThan(0);
        const pkg = Buffer.from(await (await srcAdmin(`/api/case-packages/jobs/${job.id}/download`)).arrayBuffer());

        const imported = await importPackage(tgtAdmin, pkg);
        expect(imported.job.state).toBe('done');
        const db = await openDb(target.dbPath);
        const row = await get(db, 'SELECT config FROM cases WHERE id = ?', [imported.job.result.case.id]);
        const assets = await all(db, `SELECT id, label, state, native_objective, native_mpp_x, width, height FROM plugin_assets WHERE plugin_id = 'pathology'`, []);
        await closeDb(db);
        const config = JSON.parse(row.config);
        const slideRef = config.pathology.slides[0].dzi;
        const grossRef = config.pathology.gross[0].source.uri;
        expect(slideRef).toMatch(/^remote:library\/asset-[0-9a-f]{24}\/slide\.dzi$/);
        expect(grossRef).toMatch(/^remote:library\/asset-[0-9a-f]{24}\/gross\.jpg$/);
        // The slide is a calibrated library asset; the photo is not a slide and has no row.
        expect(assets).toEqual([{ id: slideRef.split('/')[1], label: 'Origin slide', state: 'ready', native_objective: 20, native_mpp_x: 0.5, width: 640, height: 480 }]);

        const servedSlide = await tgtAdmin(`/api/plugins/pathology/${slideRef.slice('remote:'.length)}`);
        const servedTile = await tgtAdmin(`/api/plugins/pathology/library/${slideRef.split('/')[1]}/slide_files/0/0_0.jpeg`);
        const servedGross = await tgtAdmin(`/api/plugins/pathology/${grossRef.slice('remote:'.length)}`);
        expect(servedSlide.status).toBe(200);
        expect(Buffer.from(await servedTile.arrayBuffer()).equals(JPEG('origin-tile'))).toBe(true);
        expect(Buffer.from(await servedGross.arrayBuffer()).equals(JPEG('gross-photo'))).toBe(true);
        expect(imported.job.result.warnings.filter((w) => /library/.test(w.hint))).toEqual([]);
    });
});

describe('case packages: the case document — agents, labs, rubric, personas', () => {
    let fx; let source; let target; let srcAdmin; let tgtAdmin; let caseId; let pkg;

    const exportPackage = async (call, id) => {
        const started = await call(`/api/cases/${id}/package`, { method: 'POST' });
        const job = await poll(call, (await started.json()).id);
        expect(job.state).toBe('done');
        return Buffer.from(await (await call(`/api/case-packages/jobs/${job.id}/download`)).arrayBuffer());
    };

    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-doc-'));
        [source, target] = await Promise.all([
            startTestServer({ seed: false, env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'src-work') } }),
            startTestServer({ seed: false, env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'tgt-work') } }),
        ]);
        for (const server of [source, target]) {
            const db = await openDb(server.dbPath);
            await seedUser(db, { username: 'doc-admin', role: 'admin' });
            await run(db, `INSERT INTO medications (medication_code, generic_name, route) VALUES ('PKG-MED-1', 'pkgaspirin', 'oral')`);
            await closeDb(db);
        }
        srcAdmin = await asUser(source.baseUrl, 'doc-admin');
        tgtAdmin = await asUser(target.baseUrl, 'doc-admin');
        for (const call of [srcAdmin, tgtAdmin]) {
            await call('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } });
        }
        const created = await srcAdmin('/api/cases', { method: 'POST', json: { name: 'Doc case', description: 'd', config: { patient_name: 'P' } } });
        caseId = (await created.json()).id;
        const db = await openDb(source.dbPath);
        const tpl = await run(db,
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, llm_provider, llm_api_key, llm_endpoint, tenant_id)
             VALUES ('relative', 'PKG Spouse', 'You are the worried spouse.', 0, 'openai', 'sk-pkg-secret', 'http://169.254.169.254/', 1)`);
        await run(db,
            `INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled, name_override, availability_type, config_override)
             VALUES (?, 1, ?, 1, 'Mrs P', 'on-call', ?)`,
            [caseId, tpl.lastID, JSON.stringify({ knowledge: { scope: 'history', answerKey: false, record: false } })]);
        const med = await get(db, `SELECT id FROM medications WHERE medication_code = 'PKG-MED-1'`, []);
        await run(db,
            `INSERT INTO case_treatments (case_id, treatment_type, medication_id, treatment_name, is_expected, points_if_ordered, tenant_id)
             VALUES (?, 'medication', ?, 'PKG Aspirin', 1, 10, 1)`, [caseId, med.id]);
        await run(db,
            `INSERT INTO case_investigations (case_id, investigation_type, test_name, normal_samples, current_value, turnaround_minutes, tenant_id)
             VALUES (?, 'lab', 'PKG Troponin', '[3,5]', 412, NULL, 1)`, [caseId]);
        await closeDb(db);
        pkg = await exportPackage(srcAdmin, caseId);
    }, 120000);

    afterAll(async () => {
        await Promise.all([source?.close(), target?.close()]);
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('never puts a template\'s LLM routing or API key in the package', () => {
        const text = pkg.toString('latin1');
        expect(text).not.toContain('sk-pkg-secret');
        expect(text).not.toContain('169.254.169.254');
    });

    it('carries agents, labs and the rubric; recreates the persona; links the medication', async () => {
        const { job } = await importPackage(tgtAdmin, pkg);
        expect(job.state).toBe('done');
        expect(job.result.created_templates).toEqual([expect.objectContaining({ agent_type: 'relative', name: 'PKG Spouse' })]);
        const db = await openDb(target.dbPath);
        const id = job.result.case.id;
        const agent = await get(db,
            `SELECT ca.name_override, ca.availability_type, ca.config_override, t.system_prompt, t.llm_api_key
               FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
              WHERE ca.case_id = ? AND t.agent_type = 'relative'`, [id]);
        const lab = await get(db, 'SELECT normal_samples, current_value, turnaround_minutes FROM case_investigations WHERE case_id = ?', [id]);
        const rubric = await get(db,
            `SELECT ct.treatment_name, ct.is_expected, ct.points_if_ordered, m.medication_code
               FROM case_treatments ct LEFT JOIN medications m ON m.id = ct.medication_id WHERE ct.case_id = ?`, [id]);
        const lab_specialists = await get(db,
            `SELECT COUNT(*) AS n FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
              WHERE ca.case_id = ? AND t.agent_type = 'laboratorian'`, [id]);
        await closeDb(db);
        expect(agent).toEqual({
            name_override: 'Mrs P', availability_type: 'on-call',
            config_override: JSON.stringify({ knowledge: { scope: 'history', answerKey: false, record: false } }),
            system_prompt: 'You are the worried spouse.', llm_api_key: null,
        });
        expect(lab).toEqual({ normal_samples: '[3,5]', current_value: 412, turnaround_minutes: null });
        expect(rubric).toEqual({ treatment_name: 'PKG Aspirin', is_expected: 1, points_if_ordered: 10, medication_code: 'PKG-MED-1' });
        // Standing specialists: the source's travel, the attach sweep adds none twice.
        expect(lab_specialists.n).toBeLessThanOrEqual(1);
    });

    it('does not attach a same-named persona that says something different — it makes an "(imported)" copy', async () => {
        const db = await openDb(target.dbPath);
        await run(db, `UPDATE agent_templates SET system_prompt = 'A DIFFERENT spouse.' WHERE name = 'PKG Spouse'`);
        await closeDb(db);
        const { job } = await importPackage(tgtAdmin, pkg);
        expect(job.result.created_templates).toEqual([expect.objectContaining({ name: 'PKG Spouse (imported)' })]);
        expect(job.result.warnings.some((w) => /says something different/.test(w.hint))).toBe(true);
        const db2 = await openDb(target.dbPath);
        const prompt = await get(db2,
            `SELECT t.system_prompt FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
              WHERE ca.case_id = ? AND t.agent_type = 'relative'`, [job.result.case.id]);
        await closeDb(db2);
        expect(prompt.system_prompt).toBe('You are the worried spouse.');

        // A third import finds the "(imported)" copy with the same prompt and reuses it.
        const again = await importPackage(tgtAdmin, pkg);
        expect(again.job.result.created_templates).toEqual([]);
    });

    it('round-trips: exporting the imported case gives the same document', async () => {
        const { job } = await importPackage(tgtAdmin, pkg);
        const back = await exportPackage(tgtAdmin, job.result.case.id);
        const caseJson = async (bytes) => {
            let doc;
            await readTar([bytes], ({ name }) => {
                const chunks = [];
                return { write: (c) => chunks.push(Buffer.from(c)), end: () => { if (name === 'case.json') doc = JSON.parse(Buffer.concat(chunks)); } };
            });
            return doc;
        };
        const [a, b] = [await caseJson(pkg), await caseJson(back)];
        expect(b.case).toEqual(a.case);
        expect(b.related.investigations).toEqual(a.related.investigations);
        expect(b.related.treatments).toEqual(a.related.treatments);
        const persona = (doc) => doc.related.agents.find((x) => x.template.agent_type === 'relative');
        expect({ ...persona(b), template: { ...persona(b).template, name: null } })
            .toEqual({ ...persona(a), template: { ...persona(a).template, name: null } });
    });
});

describe('case packages: disk promised to one upload is not promised again', () => {
    // Regression lock: each upload was checked against the disk as it stood, so two that each fit could together fill it — nothing was reserved (Codex review, 2026-10-10)
    const RESERVE = 256 * 1024 * 1024; // each upload reserves 2× its size
    let fx; let server; let admin;
    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-reserve-'));
        const { statfsSync } = await import('node:fs');
        const stats = statfsSync(fx);
        const free = Number(stats.bavail) * Number(stats.bsize);
        // Room for ONE upload's reservation (2 × RESERVE) with slack, not two.
        const margin = Math.max(0, free - 3 * RESERVE);
        server = await startTestServer({
            seed: false,
            env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'work'), ROHY_CASE_PACKAGE_MIN_FREE_BYTES: String(margin) },
        });
        const db = await openDb(server.dbPath);
        await seedUser(db, { username: 'res-admin', role: 'admin' });
        await closeDb(db);
        admin = await asUser(server.baseUrl, 'res-admin');
        await admin('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } });
    }, 60000);
    afterAll(async () => {
        await server?.close();
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('admits one upload, refuses a second while the first holds its reservation, admits it once released', async () => {
        const first = await admin('/api/case-packages/uploads', { method: 'POST', json: { bytes: RESERVE } });
        expect(first.status).toBe(201);
        const second = await admin('/api/case-packages/uploads', { method: 'POST', json: { bytes: RESERVE } });
        expect(second.status).toBe(507);
        await admin(`/api/case-packages/uploads/${(await first.json()).id}`, { method: 'DELETE' });
        const third = await admin('/api/case-packages/uploads', { method: 'POST', json: { bytes: RESERVE } });
        expect(third.status).toBe(201);
    });
});
