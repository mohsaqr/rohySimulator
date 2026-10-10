// services/casePackage.js — the guarantees an integration test cannot pin down
// deterministically.
//
// Regression lock: two concurrent requests for the same upload chunk both passed the checks before either appended — eight bytes for a four-byte chunk, a corrupt archive (Codex review, 2026-10-10)
// Regression lock: reference rewriting ran on the JSON text, so resolving a local /uploads collision also rewrote a URL on another host that contained the same path (Codex review, 2026-10-10)
// Regression lock: two concurrent uploads both passed the free-space check before either recorded its reservation — the disk was promised twice (review F10, 2026-10-10)
// Regression lock: export held only the media to the package limit while import holds the whole archive, so a case exported near the limit could not be imported (review F9, 2026-10-10)
// Regression lock: a media file that vanished or changed length mid-export left the package's write stream open — the failed job unlinked a file whose descriptor still held its disk (review F11, 2026-10-10)

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-pkg-internals-'));
const dbFile = path.join(tmpDir, 'pkg.sqlite');
process.env.ROHY_DB = dbFile;
process.env.ROHY_NO_AUTO_SEED = '1';
process.env.ROHY_CASE_PACKAGE_DIR = path.join(tmpDir, 'work');
await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbFile, (err) => {
        if (err) return reject(err);
        runMigrations(handle).then(() => handle.close(resolve), reject);
    });
});
await (await import('../../server/db.js')).dbReady;
const { __test, createUpload, appendChunk, cancelUpload, buildCasePackage, UPLOADS_DIR } = await import('../../server/services/casePackage.js');
const { default: dbAdapter } = await import('../../server/dbAdapter.js');
const { rewriteRefs } = __test;

const createdUploads = [];
afterAll(() => {
    createdUploads.forEach((name) => fs.rmSync(path.join(UPLOADS_DIR, name), { force: true }));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Run `work` with environment variables set, restoring them after. */
async function withEnv(vars, work) {
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    try {
        return await work();
    } finally {
        Object.entries(saved).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    }
}

/** A case whose radiology uses one uploaded file per entry of `contents`; returns its id and file names (sorted, as export carries them). */
async function caseWithUploads(contents) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const tag = randomBytes(6).toString('hex');
    const names = contents.map((_, i) => `pkg-int-${tag}-${i}.png`);
    names.forEach((name, i) => {
        fs.writeFileSync(path.join(UPLOADS_DIR, name), contents[i]);
        createdUploads.push(name);
    });
    const config = { radiology: names.map((name, i) => ({ id: `r${i}`, studyName: `Film ${i}`, imageUrl: `./uploads/${name}` })) };
    const { lastID } = await dbAdapter.run(
        'INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES (?, ?, ?, ?, 1)',
        [`Internals ${tag}`, 'internals', 'be a patient', JSON.stringify(config)]
    );
    return { caseId: lastID, names };
}


describe('reference rewriting', () => {
    const doc = {
        relative: './uploads/a.png',
        absolute: '/uploads/a.png',
        otherHost: 'https://other.example/uploads/a.png',
        prose: 'see /uploads/a.png for the film',
        longerName: '/uploads/a.png2',
        library: 'remote:library/asset-old/slide.dzi',
        shipped: 'remote:tiles/t.dzi',
        nested: [{ deep: './uploads/a.png' }],
    };
    const out = rewriteRefs(doc, [
        ['/uploads/a.png', '/uploads/b.png'],
        ['remote:library/asset-old/', 'remote:library/asset-new/'],
        ['remote:tiles/t.dzi', 'remote:library/asset-z/slide.dzi'],
    ]);

    it('rewrites this server\'s references, keeping each one\'s own prefix', () => {
        expect(out.relative).toBe('./uploads/b.png');
        expect(out.absolute).toBe('/uploads/b.png');
        expect(out.nested[0].deep).toBe('./uploads/b.png');
        expect(out.library).toBe('remote:library/asset-new/slide.dzi');
        expect(out.shipped).toBe('remote:library/asset-z/slide.dzi');
    });

    it('leaves another host\'s URL, prose and a longer name alone', () => {
        expect(out.otherHost).toBe('https://other.example/uploads/a.png');
        expect(out.prose).toBe('see /uploads/a.png for the film');
        expect(out.longerName).toBe('/uploads/a.png2');
    });
});

describe('chunked upload', () => {
    const actor = { user: { id: 1, tenant_id: 1 } };

    it('appends a chunk sent several times at once exactly once', async () => {
        const { id } = await createUpload({ bytes: 8, actor });
        const chunk = Buffer.from('abcd');
        const results = await Promise.all([
            appendChunk({ id, index: 0, data: chunk, actor }),
            appendChunk({ id, index: 0, data: chunk, actor }),
            appendChunk({ id, index: 0, data: chunk, actor }),
        ]);
        expect(results.map((r) => r.received)).toEqual([4, 4, 4]);
        const file = path.join(process.env.ROHY_CASE_PACKAGE_DIR, `upload-${id}.rohycase`);
        expect(fs.readFileSync(file).toString()).toBe('abcd');
        await expect(appendChunk({ id, index: 0, data: Buffer.from('zzzz'), actor })).rejects.toMatchObject({ code: 'upload_chunk_conflict' });
        await cancelUpload({ id, actor });
    });
});

describe('upload admission', () => {
    const actor = { user: { id: 1, tenant_id: 1 } };

    it('refuses the second of two concurrent uploads when the disk has room for one', async () => {
        const RESERVE = 256 * 1024 * 1024; // each upload reserves 2× its size
        const work = process.env.ROHY_CASE_PACKAGE_DIR;
        fs.mkdirSync(work, { recursive: true });
        const stats = fs.statfsSync(work);
        // Room for ONE upload's reservation (2 × RESERVE) with slack, not two.
        const margin = Math.max(0, Number(stats.bavail) * Number(stats.bsize) - 3 * RESERVE);
        await withEnv({ ROHY_CASE_PACKAGE_MIN_FREE_BYTES: String(margin) }, async () => {
            const settled = await Promise.allSettled([
                createUpload({ bytes: RESERVE, actor }),
                createUpload({ bytes: RESERVE, actor }),
            ]);
            const admitted = settled.filter((r) => r.status === 'fulfilled');
            const refused = settled.filter((r) => r.status === 'rejected');
            expect(admitted).toHaveLength(1);
            expect(refused).toHaveLength(1);
            expect(refused[0].reason).toMatchObject({ code: 'case_package_no_space', status: 507 });

            // The refused request reserved nothing, and cancelling releases the admitted one.
            await cancelUpload({ id: admitted[0].value.id, actor });
            const again = await createUpload({ bytes: RESERVE, actor });
            await cancelUpload({ id: again.id, actor });
        });
    });
});

describe('export', () => {
    const outFile = (label) => path.join(tmpDir, `${label}-${randomBytes(4).toString('hex')}.rohycase`);

    it('holds the whole archive to the limit import holds an upload to', async () => {
        const actor = { user: { id: 1, tenant_id: 1 } };
        const { caseId } = await caseWithUploads([randomBytes(3000)]);
        const { bytes: archive } = await buildCasePackage({ caseId, tenant: 1, outFile: outFile('unlimited') });
        expect(archive).toBeGreaterThan(3000);

        // At exactly the archive's size: export builds it and import admits it.
        await withEnv({ ROHY_CASE_PACKAGE_MAX_BYTES: String(archive) }, async () => {
            const built = await buildCasePackage({ caseId, tenant: 1, outFile: outFile('at-limit') });
            expect(built.bytes).toBe(archive);
            const upload = await createUpload({ bytes: built.bytes, actor });
            await cancelUpload({ id: upload.id, actor });
        });

        // One byte under: the media alone still fits, but export refuses
        // rather than produce a package import would refuse.
        await withEnv({ ROHY_CASE_PACKAGE_MAX_BYTES: String(archive - 1) }, async () => {
            await expect(buildCasePackage({ caseId, tenant: 1, outFile: outFile('over') }))
                .rejects.toMatchObject({ code: 'case_package_too_large', status: 413 });
            await expect(createUpload({ bytes: archive, actor }))
                .rejects.toMatchObject({ code: 'case_package_too_large', status: 413 });
        });
    });

    it.each([
        ['vanished', (file) => fs.unlinkSync(file), 'ENOENT'],
        ['shrunk', (file) => fs.truncateSync(file, 10), 'tar_size'],
    ])('closes the output when a media file is %s mid-export', async (_label, mutate, code) => {
        const { caseId, names } = await caseWithUploads([randomBytes(4000), randomBytes(5000)]);
        const realCreateWriteStream = fs.createWriteStream;
        const opened = [];
        const spy = vi.spyOn(fs, 'createWriteStream').mockImplementation((...args) => {
            const stream = realCreateWriteStream.apply(fs, args);
            opened.push(stream);
            return stream;
        });
        try {
            await expect(buildCasePackage({
                caseId,
                tenant: 1,
                outFile: outFile('broken'),
                // After the first file is written, the second one changes under the export.
                onProgress: ({ phase, done }) => {
                    if (phase === 'writing' && done === 1) mutate(path.join(UPLOADS_DIR, names[1]));
                },
            })).rejects.toMatchObject({ code });
        } finally {
            spy.mockRestore();
        }
        expect(opened).toHaveLength(1);
        expect(opened[0].destroyed).toBe(true);
        expect(opened[0].closed).toBe(true);
    });
});
