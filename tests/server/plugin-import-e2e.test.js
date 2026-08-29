// End to end: an educator pastes a link and gets a tiled slide in the library.
//
// This drives the WHOLE stack — the plugin's routes, the host's job queue, the
// allow-listed downloader, real libvips, and the catalog merge — against a real
// slide file served over HTTP. It is the only test that proves the pieces fit;
// everything else exercises them in isolation.
//
// Skipped when libvips is absent, which is the state of a machine that has not
// run `apt install libvips-tools`. Skipping is honest here: the feature genuinely
// does not work without it, and the server says so at import time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function vipsAvailable() {
    try { execFileSync('vips', ['--version'], { stdio: 'ignore' }); return true; }
    catch { return false; }
}
const HAVE_VIPS = vipsAvailable();

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
const api = (baseUrl, token) => (path, init = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
});

describe.skipIf(!HAVE_VIPS)('importing a slide from a link, end to end', () => {
    let server; let educator; let admin; let slideOrigin; let libraryDir; let workDir; let slidePath;

    beforeAll(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'rohy-slide-'));
        libraryDir = await mkdtemp(join(tmpdir(), 'rohy-library-'));

        // A real, small, tiled pyramidal TIFF — the "Generic-TIFF" case, which
        // libvips reports as `tiffload` and which carries no optics, so this
        // also exercises the needs_calibration path.
        // One thread throughout. This suite proves CORRECTNESS, not throughput,
        // and vitest runs test files in parallel — an unbounded libvips takes
        // most of the machine and starves whatever else is running, which showed
        // up as unrelated files timing out on unrelated assertions.
        slidePath = join(workDir, 'specimen.tif');
        const oneThread = { env: { ...process.env, VIPS_CONCURRENCY: '1' } };
        execFileSync('vips', ['gaussnoise', join(workDir, 'src.v'), '2400', '1800', '--mean', '128', '--sigma', '40'], oneThread);
        execFileSync('vips', ['copy', join(workDir, 'src.v'),
            `${slidePath}[compression=jpeg,Q=85,tile,tile-width=256,tile-height=256,pyramid]`], oneThread);

        const size = statSync(slidePath).size;
        const origin = http.createServer((req, res) => {
            if (!req.url.endsWith('.tif')) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { 'content-type': 'image/tiff', 'content-length': String(size) });
            createReadStream(slidePath).pipe(res);
        });
        await new Promise((r) => origin.listen(0, '127.0.0.1', r));
        slideOrigin = { url: `http://127.0.0.1:${origin.address().port}`, close: () => new Promise((r) => origin.close(r)) };

        server = await startTestServer({
            seed: false,
            env: {
                ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${libraryDir}`,
                ROHY_PLUGIN_IMPORT_ORIGINS: `pathology=${slideOrigin.url}`,
                // See the fixture comment above: one thread, so this suite does
                // not starve the test files running beside it.
                ROHY_PLUGIN_VIPS_CONCURRENCY: '1',
            },
        });
        const hash = await bcrypt.hash('Educator1!', 4);
        await dbRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, 'educator', 1, 'active')`,
            ['imp-educator', 'imp-educator', 'imp-educator@example.com', hash]);
        admin = api(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        educator = api(server.baseUrl, await login(server.baseUrl, 'imp-educator', 'Educator1!'));
    }, 120_000);

    afterAll(async () => {
        await server?.close();
        await slideOrigin?.close();
        await rm(workDir, { recursive: true, force: true });
        await rm(libraryDir, { recursive: true, force: true });
    });

    /** Poll a job the way the editor does. */
    async function settle(jobId, timeoutMs = 180_000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const job = await (await educator(`/api/plugins/pathology/jobs/${jobId}`)).json();
            if (['done', 'failed', 'cancelled'].includes(job.state)) return job;
            if (Date.now() > deadline) throw new Error(`job stuck in ${job.state}/${job.phase}`);
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    /**
     * Import one slide and wait for it.
     *
     * Each test asks for its OWN url, so each gets its own asset id and no test
     * depends on what another left behind. They shared one asset at first, and
     * it was order-dependent in a way that only showed up under full-suite
     * load: the re-import test reset the calibration the test before it had
     * just set.
     */
    async function importOne(name, label) {
        const res = await educator('/api/plugins/pathology/imports', {
            method: 'POST',
            body: JSON.stringify({ url: `${slideOrigin.url}/${name}.tif`, label }),
        });
        expect(res.status).toBe(202);
        const { jobId, assetId } = await res.json();
        const job = await settle(jobId);
        expect(job.state).toBe('done');
        return assetId;
    }

    // A fresh install imports from nowhere: imports off, allowlist empty. Both
    // must be turned on deliberately.
    it('refuses an import until an admin enables it and names an origin', async () => {
        const off = await educator('/api/plugins/pathology/imports', {
            method: 'POST', body: JSON.stringify({ url: `${slideOrigin.url}/specimen.tif` }),
        });
        expect(off.status).toBe(403);
        expect((await off.json()).code).toBe('plugin_imports_disabled');

        expect((await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'imports.enabled': true }),
        })).status).toBe(200);

        // Enabled, but still no origin named.
        const noOrigin = await educator('/api/plugins/pathology/imports', {
            method: 'POST', body: JSON.stringify({ url: `${slideOrigin.url}/specimen.tif` }),
        });
        expect(noOrigin.status).toBe(403);
        expect((await noOrigin.json()).code).toBe('plugin_import_forbidden_origin');

        expect((await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'imports.allowedOrigins': [slideOrigin.url] }),
        })).status).toBe(200);
    });

    // A tenant admin narrows the operator's list and can never widen it.
    it('an admin cannot allow an origin the operator did not', async () => {
        const res = await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'imports.allowedOrigins': ['https://evil.example'] }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/not among the origins this deployment allows/);
    });

    it('imports, tiles and lands in needs_calibration — never a guessed 40x', async () => {
        const assetId = await importOne('specimen', 'Specimen A');

        // The tiles are really on disk, under the declared /library prefix.
        const dirs = await readdir(join(libraryDir, assetId));
        expect(dirs).toEqual(expect.arrayContaining(['slide.dzi', 'slide_files', 'preview.jpg', 'source']));

        const { assets } = await (await educator('/api/plugins/pathology/assets')).json();
        const asset = assets.find((a) => a.id === assetId);
        // The file carries no optics, so it is NOT usable yet. This is the
        // whole point: a slide with unknown optics is not a slide with default
        // optics — every measurement would be wrong by an unknown factor.
        expect(asset.status).toBe('needs_calibration');
        expect(asset.revisions[0].optics.nativeObjective).toBeNull();
        expect(asset.revisions[0].derivatives.dzi.url).toBe(`remote:library/${assetId}/slide.dzi`);
    }, 240_000);

    it('an uncalibrated slide is not offered to an author, and a calibrated one is', async () => {
        const assetId = await importOne('calibrate-me');

        const before = await (await educator('/api/plugins/pathology/catalog')).json();
        expect((before.catalog?.assets ?? []).some((a) => a.id === assetId)).toBe(false);

        // Both numbers are required; neither is defaulted.
        const bad = await educator(`/api/plugins/pathology/assets/${assetId}/calibration`, {
            method: 'PUT', body: JSON.stringify({ nativeObjective: 20 }),
        });
        expect(bad.status).toBe(400);

        const ok = await educator(`/api/plugins/pathology/assets/${assetId}/calibration`, {
            method: 'PUT', body: JSON.stringify({ nativeObjective: 20, nativeMpp: 0.5 }),
        });
        expect(ok.status).toBe(200);
        expect((await ok.json()).state).toBe('ready');

        const after = await (await educator('/api/plugins/pathology/catalog')).json();
        const offered = (after.catalog?.assets ?? []).find((a) => a.id === assetId);
        expect(offered).toBeTruthy();
        expect(offered.revisions[0].optics).toMatchObject({ nativeObjective: 20, nativeMpp: 0.5 });
    }, 240_000);

    // Deterministic asset ids: the same link must not accumulate copies of a
    // multi-gigabyte slide.
    it('re-importing the same link reuses one asset and one directory', async () => {
        const first = await importOne('twice');
        const before = await readdir(libraryDir);
        const second = await importOne('twice');
        expect(second).toBe(first);
        expect((await readdir(libraryDir)).sort()).toEqual(before.sort());
    }, 240_000);

    it('removes the row and the bytes together', async () => {
        const assetId = await importOne('disposable');
        expect(await readdir(libraryDir)).toContain(assetId);

        expect((await educator(`/api/plugins/pathology/assets/${assetId}`, { method: 'DELETE' })).status).toBe(200);
        expect(await readdir(libraryDir)).not.toContain(assetId);
        const after = await (await educator('/api/plugins/pathology/assets')).json();
        expect(after.assets.some((a) => a.id === assetId)).toBe(false);
    }, 240_000);

    it('refuses a link on a host nobody allowed, without fetching it', async () => {
        const res = await educator('/api/plugins/pathology/imports', {
            method: 'POST', body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
        });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('plugin_import_forbidden_origin');
    });

    it('is closed to a student', async () => {
        const hash = await bcrypt.hash('Student1!', 4);
        await dbRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, 'student', 1, 'active')`,
            ['imp-student', 'imp-student', 'imp-student@example.com', hash]);
        const student = api(server.baseUrl, await login(server.baseUrl, 'imp-student', 'Student1!'));
        expect((await student('/api/plugins/pathology/imports', {
            method: 'POST', body: JSON.stringify({ url: `${slideOrigin.url}/specimen.tif` }),
        })).status).toBe(403);
        expect((await student('/api/plugins/pathology/assets')).status).toBe(403);
    });
});
