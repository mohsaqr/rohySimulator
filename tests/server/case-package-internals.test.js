// services/casePackage.js — the guarantees an integration test cannot pin down
// deterministically.
//
// Regression lock: two concurrent requests for the same upload chunk both passed the checks before either appended — eight bytes for a four-byte chunk, a corrupt archive (Codex review, 2026-10-10)
// Regression lock: reference rewriting ran on the JSON text, so resolving a local /uploads collision also rewrote a URL on another host that contained the same path (Codex review, 2026-10-10)

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const { __test, createUpload, appendChunk, cancelUpload } = await import('../../server/services/casePackage.js');
const { rewriteRefs } = __test;

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

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
