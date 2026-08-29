// RPS-1 1.4 — the plugin job runner and the allow-listed downloader.
//
// These run the real migrations on a throwaway sqlite file and point the
// dbAdapter singleton at it (db.js binds ROHY_DB at import time, so the env var
// is set before the dynamic imports below).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../utils/seedDb.js';

let testDb;
let jobs;
let dbAdapter;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'plugin-jobs' });
    process.env.ROHY_DB = testDb.dbPath;
    dbAdapter = (await import('../../server/dbAdapter.js')).default;
    jobs = await import('../../server/lib/pluginJobs.js');
}, 60_000);

afterAll(async () => { await testDb?.cleanup?.(); });

beforeEach(async () => {
    jobs.resetJobHandlers();
    jobs.resume();
    await dbAdapter.run('DELETE FROM plugin_jobs', []);
});

/** Wait until a job reaches a terminal state, or fail loudly. */
async function settled(id, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const row = await dbAdapter.get('SELECT * FROM plugin_jobs WHERE id = ?', [id]);
        if (row && ['done', 'failed', 'cancelled'].includes(row.state)) return row;
        if (Date.now() > deadline) throw new Error(`job ${id} still ${row?.state} after ${timeoutMs}ms`);
        await new Promise((r) => setTimeout(r, 10));
    }
}
const enqueue = (kind, payload = {}) => jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind, payload });

describe('the job runner', () => {
    it('runs a handler and stores its result', async () => {
        jobs.registerJobHandler('t:ok', async (job) => ({ doubled: job.payload.n * 2 }));
        const row = await settled(await enqueue('t:ok', { n: 21 }));
        expect(row.state).toBe('done');
        expect(JSON.parse(row.result)).toEqual({ doubled: 42 });
        expect(row.phase).toBeNull();
        expect(row.finished_at).toBeTruthy();
    });

    // A worker that lets an exception escape takes down a process that is
    // otherwise serving requests.
    it('records a thrown error as a failed job rather than crashing the worker', async () => {
        jobs.registerJobHandler('t:boom', async () => { throw new Error('vips exploded'); });
        jobs.registerJobHandler('t:after', async () => 'still alive');
        const bad = await settled(await enqueue('t:boom'));
        expect(bad.state).toBe('failed');
        expect(bad.error).toMatch(/vips exploded/);
        expect((await settled(await enqueue('t:after'))).state).toBe('done');
    });

    // Refused, not queued: a job nothing can run sits at 'queued' forever and
    // reads to an admin as a stuck worker.
    it('refuses to enqueue a kind with no registered handler', async () => {
        await expect(enqueue('t:nobody')).rejects.toThrow(/No handler is registered/);
    });

    it('reports phase and progress while running, and clears phase when done', async () => {
        let seen = null;
        jobs.registerJobHandler('t:phases', async (job, api) => {
            await api.setPhase('downloading');
            await api.setProgress(50);
            seen = await dbAdapter.get('SELECT phase, progress, state FROM plugin_jobs WHERE id = ?', [job.id]);
            await api.setPhase('tiling');
        });
        const row = await settled(await enqueue('t:phases'));
        expect(seen).toMatchObject({ phase: 'downloading', progress: 50, state: 'running' });
        expect(row).toMatchObject({ state: 'done', phase: null });
    });

    it('runs jobs one at a time — concurrency is a deployment property, not a plugin one', async () => {
        let live = 0; let peak = 0;
        jobs.registerJobHandler('t:slow', async () => {
            live += 1; peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, 30));
            live -= 1;
        });
        const ids = await Promise.all([enqueue('t:slow'), enqueue('t:slow'), enqueue('t:slow')]);
        for (const id of ids) expect((await settled(id)).state).toBe('done');
        expect(peak).toBe(1);
    });

    it('cancels a queued job outright, and a running one at its next phase boundary', async () => {
        const queued = await dbAdapter.run(
            `INSERT INTO plugin_jobs (id, tenant_id, plugin_id, kind, state) VALUES ('q1', 1, 'pathology', 't:none', 'queued')`, []
        ) && 'q1';
        expect(await jobs.cancelJob(queued, 1)).toBe(true);
        expect((await dbAdapter.get('SELECT state FROM plugin_jobs WHERE id = ?', [queued])).state).toBe('cancelled');

        let reachedSecondPhase = false;
        jobs.registerJobHandler('t:cancelme', async (job, api) => {
            await api.setPhase('downloading');
            await jobs.cancelJob(job.id, 1);
            await api.setPhase('tiling');       // the checkpoint — should throw
            reachedSecondPhase = true;
        });
        const row = await settled(await enqueue('t:cancelme'));
        expect(row.state).toBe('cancelled');
        expect(reachedSecondPhase).toBe(false);
    });

    // Regression lock: a job found 'running' at boot belongs to a dead process,
    // so its recorded phase is the last one ANNOUNCED, not the one reached.
    // Resuming from that phase is how a half-downloaded file gets tiled.
    it('requeues an interrupted job FROM THE START, and abandons it past the attempt limit', async () => {
        await dbAdapter.run(
            `INSERT INTO plugin_jobs (id, tenant_id, plugin_id, kind, state, phase, progress, attempts)
             VALUES ('r1', 1, 'pathology', 't:x', 'running', 'tiling', 80, 1),
                    ('r2', 1, 'pathology', 't:x', 'running', 'tiling', 80, 3)`, []
        );
        expect(await jobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failed: 1 });
        expect(await dbAdapter.get('SELECT state, phase, progress FROM plugin_jobs WHERE id = ?', ['r1']))
            .toMatchObject({ state: 'queued', phase: null, progress: 0 });
        const abandoned = await dbAdapter.get('SELECT state, error FROM plugin_jobs WHERE id = ?', ['r2']);
        expect(abandoned.state).toBe('failed');
        expect(abandoned.error).toMatch(/abandoned after 3 interrupted attempts/);
    });

    it('sweeps finished job rows by age and leaves live ones alone', async () => {
        await dbAdapter.run(
            `INSERT INTO plugin_jobs (id, tenant_id, plugin_id, kind, state, finished_at) VALUES
               ('old', 1, 'pathology', 't:x', 'done',   datetime('now', '-40 days')),
               ('new', 1, 'pathology', 't:x', 'done',   datetime('now', '-1 days')),
               ('run', 1, 'pathology', 't:x', 'queued', NULL)`, []
        );
        expect(await jobs.sweepFinishedJobs(30)).toBe(1);
        const left = await dbAdapter.all('SELECT id FROM plugin_jobs ORDER BY id', []);
        expect(left.map((r) => r.id)).toEqual(['new', 'run']);
    });
});

// ---------------------------------------------------------------------------

describe('the allow-listed downloader', () => {
    let fetchLib; let origin; let server; let dir; let redirectTo = null;

    beforeAll(async () => {
        fetchLib = await import('../../server/lib/pluginFetch.js');
        dir = await mkdtemp(join(tmpdir(), 'rohy-lib-'));
        server = http.createServer((req, res) => {
            if (req.url === '/slide.tif') {
                res.writeHead(200, { 'content-type': 'image/tiff', 'content-length': '10' });
                return res.end('SLIDEBYTES');
            }
            if (req.url === '/big.tif') {
                res.writeHead(200, { 'content-type': 'image/tiff' });   // no content-length
                return res.end('x'.repeat(5000));
            }
            if (req.url === '/hop') {
                res.writeHead(302, { location: redirectTo });
                return res.end();
            }
            res.writeHead(404); return res.end();
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        origin = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(async () => {
        await new Promise((r) => server.close(r));
        await rm(dir, { recursive: true, force: true });
    });

    const get = (path, over = {}) => fetchLib.downloadToFile({
        url: `${origin}${path}`, destPath: join(dir, 'out.bin'), rootDir: dir,
        allowedOrigins: [origin], maxBytes: 1024, ...over,
    });

    it('downloads, digests and reports the bytes it actually wrote', async () => {
        const out = await get('/slide.tif');
        expect(out.bytes).toBe(10);
        expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(out.contentType).toBe('image/tiff');
        expect(await readFile(join(dir, 'out.bin'), 'utf8')).toBe('SLIDEBYTES');
    });

    it.each([
        ['an off-allowlist origin', 'https://evil.example/x.tif', 'plugin_import_forbidden_origin'],
        ['a non-http scheme', 'file:///etc/passwd', 'plugin_import_bad_scheme'],
        ['credentials in the URL', 'http://u:p@127.0.0.1/x.tif', 'plugin_import_credentials'],
        ['not a URL at all', 'nonsense', 'plugin_import_bad_url'],
    ])('refuses %s', async (_label, url, code) => {
        await expect(get('', { url })).rejects.toMatchObject({ code });
    });

    // The guarantee is not "no redirects" — it is "never a byte from a host the
    // operator did not name". An on-list host must not become a redirector.
    it('follows an on-allowlist redirect and refuses an off-allowlist one', async () => {
        redirectTo = `${origin}/slide.tif`;
        expect((await get('/hop')).bytes).toBe(10);
        redirectTo = 'http://169.254.169.254/latest/meta-data/';
        await expect(get('/hop')).rejects.toMatchObject({ code: 'plugin_import_forbidden_origin' });
    });

    // A Content-Length is a claim, not a limit.
    it('enforces the byte cap while streaming, even with no Content-Length, and leaves no partial file', async () => {
        await expect(get('/big.tif', { destPath: join(dir, 'partial.bin') }))
            .rejects.toMatchObject({ code: 'plugin_import_too_large' });
        expect(existsSync(join(dir, 'partial.bin'))).toBe(false);
    });

    it('refuses a destination outside the plugin library directory', async () => {
        await expect(get('/slide.tif', { destPath: join(dir, '..', 'escape.bin') }))
            .rejects.toMatchObject({ code: 'plugin_import_path_escape' });
    });

    // A prefix match is not a containment check: '/library/a2' is not in '/library/a'.
    it('containedPath is a containment check, not a prefix match', () => {
        expect(fetchLib.containedPath('/library/a', '/library/a/x')).toBe(true);
        expect(fetchLib.containedPath('/library/a', '/library/a')).toBe(true);
        expect(fetchLib.containedPath('/library/a', '/library/a2/x')).toBe(false);
        expect(fetchLib.containedPath('/library/a', '/library/a/../b')).toBe(false);
    });
});
