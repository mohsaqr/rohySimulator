// services/casePackage.js — a long import, as the admin running it sees it
// (FI-0010 journey review, 2026-10-14: a 3 GB package of 71,200 files sat at
// "Checking media against this server…" for minutes with nothing moving).
//
// Regression lock: F04 an import reported one progress entry per phase with no files or bytes done/total, so a 10-minute phase looked stalled
// Regression lock: F05 Cancel after the upload only closed the dialog — the import ran on and created the case; nothing could stop it or undo it
// Regression lock: F12 a .DS_Store (or Thumbs.db, ._*, __MACOSX) in a library slide folder made an exact re-import copy the whole slide again
// Regression lock: F22 a re-import named its new course exactly like the first import's ("… (FI-0010)" for case FI-0011)
//
// In process, like case-package-internals: cancellation and progress are
// about timing an HTTP test cannot pin down.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-pkg-progress-'));
const LIB = path.join(tmpDir, 'library');
const dbFile = path.join(tmpDir, 'pkg.sqlite');
Object.assign(process.env, {
    ROHY_DB: dbFile,
    ROHY_NO_AUTO_SEED: '1',
    ROHY_CASE_PACKAGE_DIR: path.join(tmpDir, 'work'),
    ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${LIB}`,
    ROHY_STARTER_CONTENT: 'off',
});
await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbFile, (err) => {
        if (err) return reject(err);
        runMigrations(handle).then(() => handle.close(resolve), reject);
    });
});
await (await import('../../server/db.js')).dbReady;
const pkg = await import('../../server/services/casePackage.js');
const { buildCasePackage, importCasePackage, importedCourseName, isHousekeeping, PackageError } = pkg;
const { default: dbAdapter } = await import('../../server/dbAdapter.js');
const { resetLibraryDirs } = await import('../../server/lib/pluginServerSlot.js');

const JPEG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg:${tag}`)]);
const DZI = Buffer.from('<?xml version="1.0"?><Image TileSize="256" Overlap="0" Format="jpeg"><Size Width="2048" Height="1024"/></Image>');
const log = { info() {}, warn() {}, error() {}, debug() {} };
const actor = { user: { id: 1, username: 'pkg-admin', role: 'admin', tenant_id: 1 }, headers: {}, log };
const TILES = 40;

const count = async (sql, params = []) => (await dbAdapter.get(sql, params)).n;
const libraryEntries = () => fs.readdirSync(LIB).sort();

/** A case using one library slide of TILES tiles; returns the package file. */
async function slideCasePackage({ beforeExport = () => {} } = {}) {
    const assetId = `asset-${randomBytes(12).toString('hex')}`;
    const dir = path.join(LIB, assetId);
    fs.mkdirSync(path.join(dir, 'slide_files', '11'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'slide.dzi'), DZI);
    fs.writeFileSync(path.join(dir, 'preview.jpg'), JPEG(`${assetId}-preview`));
    Array.from({ length: TILES }, (_, i) => fs.writeFileSync(path.join(dir, 'slide_files', '11', `${i}_0.jpeg`), JPEG(`${assetId}-${i}`)));
    // Two tiles with the same bytes: blank tissue. One staged file, two places.
    fs.writeFileSync(path.join(dir, 'slide_files', '11', '0_1.jpeg'), JPEG('blank'));
    fs.writeFileSync(path.join(dir, 'slide_files', '11', '1_1.jpeg'), JPEG('blank'));
    const config = { case_language: 'fi', pathology: { slides: [{ id: 's', label: 'Slide', dzi: `remote:library/${assetId}/slide.dzi`, nativeObjective: 40, nativeMpp: 0.25 }] } };
    const { lastID: caseId } = await dbAdapter.run(
        'INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES (?, ?, ?, ?, 1)',
        [`Progress ${assetId}`, 'd', 'p', JSON.stringify(config)]
    );
    await dbAdapter.run(
        `INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state, native_objective, native_mpp_x, native_mpp_y, tiled_objective, width, height, created_at, updated_at)
         VALUES (?, 1, 'pathology', 'Slide', 'ready', 40, 0.25, 0.25, 10, 2048, 1024, 'x', 'x')`,
        [assetId]
    );
    beforeExport(dir);
    const outFile = path.join(tmpDir, `${assetId}.rohycase`);
    await buildCasePackage({ caseId, tenant: 1, outFile });
    return { assetId, dir, outFile };
}

/** A cancellation that fires on the `after`-th check made during `phase`. */
function cancelDuring(phase, after = 1) {
    const state = { phase: null, checks: 0, calls: [] };
    return {
        state,
        onProgress: (p) => { state.phase = p.phase; },
        cancellation: {
            check() {
                state.calls.push('check');
                if (state.phase === phase && ++state.checks >= after) {
                    throw new PackageError('Cancelled; nothing was created', 'case_package_cancelled', 409);
                }
            },
            commit() { state.calls.push('commit'); },
        },
    };
}

beforeAll(async () => {
    fs.mkdirSync(LIB, { recursive: true });
    resetLibraryDirs();
    await dbAdapter.run(
        `INSERT INTO users (id, username, name, email, password_hash, role, tenant_id, status)
         VALUES (1, 'pkg-admin', 'pkg-admin', 'pkg-admin@example.com', 'x', 'admin', 1, 'active')`,
        []
    );
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('housekeeping files', () => {
    it('knows what an operating system leaves behind, and nothing else', () => {
        ['.DS_Store', 'Thumbs.db', 'thumbs.db', 'desktop.ini', '._0_0.jpeg', '__MACOSX', '.Spotlight-V100', '.Trashes', '.fseventsd']
            .forEach((name) => expect(isHousekeeping(name), name).toBe(true));
        ['slide.dzi', 'preview.jpg', '0_0.jpeg', 'slide_files', 'gross.png', '.hidden-but-ours']
            .forEach((name) => expect(isHousekeeping(name), name).toBe(false));
    });

    it('re-importing the same package reuses the slide even after Finder and Windows wrote into its folder', async () => {
        const { assetId, dir, outFile } = await slideCasePackage();
        fs.writeFileSync(path.join(dir, '.DS_Store'), randomBytes(64));
        fs.writeFileSync(path.join(dir, 'slide_files', '.DS_Store'), randomBytes(64));
        fs.writeFileSync(path.join(dir, 'slide_files', '11', 'Thumbs.db'), randomBytes(64));
        fs.writeFileSync(path.join(dir, 'slide_files', '11', '._0_0.jpeg'), randomBytes(64));
        fs.mkdirSync(path.join(dir, '__MACOSX'));
        fs.writeFileSync(path.join(dir, '__MACOSX', 'junk'), randomBytes(64));
        const before = libraryEntries();

        const result = await importCasePackage({ packageFile: outFile, actor });

        expect(libraryEntries()).toEqual(before);
        expect(result.imported.slides).toBe(1);
        expect(result.media).toEqual({ uploads_reused: 0, uploads_copied: 0, slides_reused: 1, slides_copied: 0, files_copied: 0, bytes_copied: 0 });
        const config = JSON.parse((await dbAdapter.get('SELECT config FROM cases WHERE id = ?', [result.case.id])).config);
        expect(config.pathology.slides[0].dzi).toBe(`remote:library/${assetId}/slide.dzi`);
    });

    it('never exports a housekeeping file', async () => {
        const marker = randomBytes(48);
        const { outFile } = await slideCasePackage({ beforeExport: (dir) => fs.writeFileSync(path.join(dir, '.DS_Store'), marker) });
        expect(fs.readFileSync(outFile).includes(marker)).toBe(false);
    });
});

describe('progress within each phase', () => {
    it('reports files and bytes done of a total while reading, checking and placing, ending at the total', async () => {
        // A fresh library, so the slide is placed rather than reused.
        const { outFile } = await slideCasePackage();
        const targetLib = path.join(tmpDir, 'library-progress');
        process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${targetLib}`;
        resetLibraryDirs();
        const events = [];
        try {
            const result = await importCasePackage({ packageFile: outFile, actor, onProgress: (p) => events.push(p) });
            expect(result.media).toMatchObject({ slides_reused: 0, slides_copied: 1, files_copied: TILES + 4 });
        } finally {
            process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${LIB}`;
            resetLibraryDirs();
        }
        expect([...new Set(events.map((e) => e.phase))]).toEqual(['reading', 'checking', 'placing', 'saving']);
        // slide.dzi + preview + TILES tiles + two tiles sharing bytes: the
        // package stores the shared bytes once (TILES + 3 media entries),
        // and every one of the TILES + 4 files is checked and placed.
        const expectedFiles = { reading: TILES + 3, checking: TILES + 4, placing: TILES + 4 };
        Object.entries(expectedFiles).forEach(([phase, files]) => {
            const last = events.filter((e) => e.phase === phase).at(-1);
            expect(last, phase).toMatchObject({ done: files, total: files });
            expect(last.bytes_total, phase).toBeGreaterThan(0);
            expect(last.bytes_done, phase).toBe(last.bytes_total);
        });
        // Throttled: a handful of updates per phase, not one per file.
        expect(events.length).toBeLessThan(30);
    });
});

describe('cancelling an import', () => {
    it('stops while placing and removes every file it placed; no case, course or slide row is left', async () => {
        const { outFile } = await slideCasePackage();
        const targetLib = path.join(tmpDir, 'library-cancel');
        fs.mkdirSync(targetLib, { recursive: true });
        process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${targetLib}`;
        resetLibraryDirs();
        const cases = await count('SELECT COUNT(*) AS n FROM cases');
        const assets = await count('SELECT COUNT(*) AS n FROM plugin_assets');
        const { onProgress, cancellation, state } = cancelDuring('placing', 10);
        try {
            await expect(importCasePackage({ packageFile: outFile, actor, onProgress, cancellation }))
                .rejects.toMatchObject({ code: 'case_package_cancelled' });
        } finally {
            process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${LIB}`;
            resetLibraryDirs();
        }
        expect(state.checks).toBeGreaterThanOrEqual(10); // it was mid-way, not before the first file
        expect(fs.readdirSync(targetLib)).toEqual([]); // not the slide, not its hidden .importing folder
        expect(await count('SELECT COUNT(*) AS n FROM cases')).toBe(cases);
        expect(await count('SELECT COUNT(*) AS n FROM plugin_assets')).toBe(assets);
        expect(fs.existsSync(`${outFile}.staging`)).toBe(false);
    });

    it('a cancel that reaches the database write rolls it back and removes the placed slide', async () => {
        const { outFile } = await slideCasePackage();
        const targetLib = path.join(tmpDir, 'library-cancel-saving');
        fs.mkdirSync(targetLib, { recursive: true });
        process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${targetLib}`;
        resetLibraryDirs();
        const cases = await count('SELECT COUNT(*) AS n FROM cases');
        // The one check made in "saving" is inside the transaction, after
        // every row was written and before the commit.
        const { onProgress, cancellation, state } = cancelDuring('saving', 1);
        try {
            await expect(importCasePackage({ packageFile: outFile, actor, onProgress, cancellation }))
                .rejects.toMatchObject({ code: 'case_package_cancelled' });
        } finally {
            process.env.ROHY_PLUGIN_LIBRARY_DIRS = `pathology=${LIB}`;
            resetLibraryDirs();
        }
        expect(state.calls).not.toContain('commit');
        expect(fs.readdirSync(targetLib)).toEqual([]);
        expect(await count('SELECT COUNT(*) AS n FROM cases')).toBe(cases);
    });

    it('marks the commit point after the last check: from then on the import is kept', async () => {
        const { outFile } = await slideCasePackage();
        const { onProgress, cancellation, state } = cancelDuring('never');
        const result = await importCasePackage({ packageFile: outFile, actor, onProgress, cancellation });
        expect(result.case.id).toBeGreaterThan(0);
        expect(state.calls.filter((c) => c === 'commit')).toHaveLength(1);
        expect(state.calls.at(-1)).toBe('commit');
        expect(state.calls.at(-2)).toBe('check');
    });
});

describe('the import\'s report', () => {
    it('says the new case starts hidden from learners', async () => {
        const { outFile } = await slideCasePackage();
        const result = await importCasePackage({ packageFile: outFile, actor });
        const row = await dbAdapter.get('SELECT is_available FROM cases WHERE id = ?', [result.case.id]);
        expect(result.case.is_available).toBe(Boolean(row.is_available));
        expect(result.case.is_available).toBe(false);
    });
});

describe('the imported course\'s name', () => {
    it('names the new case code where the old one was, and otherwise only adds it when the name is taken', () => {
        expect(importedCourseName({ name: 'Patologia: Pentin tapaus (FI-0010)', sourceCaseCode: 'FI-0010', caseCode: 'FI-0011', nameTaken: true }))
            .toBe('Patologia: Pentin tapaus (FI-0011)');
        expect(importedCourseName({ name: 'Patologia', sourceCaseCode: 'FI-0010', caseCode: 'FI-0011', nameTaken: true }))
            .toBe('Patologia (FI-0011)');
        expect(importedCourseName({ name: 'Patologia', sourceCaseCode: 'FI-0010', caseCode: 'FI-0011', nameTaken: false }))
            .toBe('Patologia');
        // Same code on a fresh server: the name was right all along.
        expect(importedCourseName({ name: 'Patologia (FI-0010)', sourceCaseCode: 'FI-0010', caseCode: 'FI-0010', nameTaken: false }))
            .toBe('Patologia (FI-0010)');
        expect(importedCourseName({ name: 'Patologia', sourceCaseCode: null, caseCode: 'EN-0003', nameTaken: true }))
            .toBe('Patologia (EN-0003)');
    });
});

describe('the import job: cancel, list', () => {
    const other = { user: { id: 2, username: 'other-admin', role: 'admin', tenant_id: 1 }, headers: {}, log };

    /** Upload `file` as `who` and complete it; resolves with the queued job's view. */
    async function uploadAndComplete(file, who = actor) {
        const bytes = fs.readFileSync(file);
        const { id, chunk_bytes: chunk } = await pkg.createUpload({ bytes: bytes.length, actor: who });
        for (let offset = 0, index = 0; offset < bytes.length; offset += chunk, index++) {
            await pkg.appendChunk({ id, index, data: bytes.subarray(offset, offset + chunk), actor: who });
        }
        return pkg.completeUpload({ id, actor: who });
    }

    async function settle(jobId, who = actor) {
        for (let i = 0; i < 400; i++) {
            const { view } = pkg.getJob(jobId, who);
            if (['done', 'failed', 'cancelled'].includes(view.state)) return view;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('job did not finish');
    }

    it('a job cancelled straight after the upload creates nothing and frees the uploaded file', async () => {
        const { outFile } = await slideCasePackage();
        const cases = await count('SELECT COUNT(*) AS n FROM cases');
        const job = await uploadAndComplete(outFile);
        const asked = await pkg.cancelJob({ id: job.id, actor });
        expect(asked.cancel_requested).toBe(true);
        const final = await settle(job.id);
        expect(final).toMatchObject({ state: 'cancelled', cancellable: false, error: { code: 'case_package_cancelled' } });
        expect(await count('SELECT COUNT(*) AS n FROM cases')).toBe(cases);
        const work = process.env.ROHY_CASE_PACKAGE_DIR;
        expect(fs.readdirSync(work).filter((name) => name.startsWith('upload-'))).toEqual([]);
    });

    it('refuses to cancel a finished import — it is kept — and another admin cannot touch the job', async () => {
        const { outFile } = await slideCasePackage();
        const job = await uploadAndComplete(outFile);
        await expect(pkg.cancelJob({ id: job.id, actor: other })).rejects.toMatchObject({ code: 'job_not_found', status: 404 });
        const final = await settle(job.id);
        expect(final).toMatchObject({ state: 'done', cancellable: false });
        expect(final.elapsed_ms).toBeGreaterThanOrEqual(0);
        expect(final.progress).toBeNull(); // saving has no file count
        await expect(pkg.cancelJob({ id: job.id, actor })).rejects.toMatchObject({ code: 'job_finished', status: 409 });
        const row = await dbAdapter.get('SELECT id FROM cases WHERE id = ?', [final.result.case.id]);
        expect(row).not.toBeNull();
    });

    it('lists the caller\'s own import jobs, newest first, so a closed dialog can find a running one again', async () => {
        const mine = pkg.listJobs({ actor, kind: 'import' });
        expect(mine.length).toBeGreaterThanOrEqual(2);
        expect(mine.every((job) => job.kind === 'import')).toBe(true);
        const created = mine.map((job) => Date.parse(job.created_at));
        expect(created).toEqual([...created].sort((a, b) => b - a));
        expect(pkg.listJobs({ actor: other })).toEqual([]);
        expect(pkg.listJobs({ actor, kind: 'export' })).toEqual([]);
    });
});
