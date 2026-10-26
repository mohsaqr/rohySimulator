// The single plugin worker is shared fairly and is not filled by repeats.
//
// Regression lock: re-importing the same link enqueued a duplicate multi-GB
// download/tiling job, there was no per-tenant bound, and the one global
// worker took jobs strictly oldest-first, so one tenant's batch held it while
// another tenant's single import waited behind all of it (security audit
// 2026-10-26, L8-15).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

let testDb;
let jobs;
let dbAdapter;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'sec2-e1-plugin-jobs' });
    process.env.ROHY_DB = testDb.dbPath;
    await (await import('../../server/db.js')).dbReady;
    dbAdapter = (await import('../../server/dbAdapter.js')).default;
    jobs = await import('../../server/lib/pluginJobs.js');
    await dbAdapter.run(`INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (2, 'Other', 'other-jobs')`, []);
}, 60_000);

afterAll(async () => {
    await jobs?.drain({ timeoutMs: 2000 });
    await testDb?.cleanup?.();
});

beforeEach(async () => {
    await jobs.drain({ timeoutMs: 2000 });
    jobs.resetJobHandlers();
    jobs.resetJobFairness();
    await dbAdapter.run('DELETE FROM plugin_jobs', []);
});

async function settled(id, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const row = await dbAdapter.get('SELECT * FROM plugin_jobs WHERE id = ?', [id]);
        if (row && ['done', 'failed', 'cancelled'].includes(row.state)) return row;
        if (Date.now() > deadline) throw new Error(`job ${id} still ${row?.state}`);
        await new Promise((r) => setTimeout(r, 10));
    }
}

describe('enqueueJob', () => {
    it('returns the pending job for the same asset instead of queueing it twice', async () => {
        jobs.registerJobHandler('t:import', async () => null);
        // Held: enqueue while the worker is drained, so both calls see a queued job.
        await jobs.drain({ timeoutMs: 100 });
        const first = await jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:import', payload: { url: 'https://x/a.svs', label: 'A' }, assetId: 'asset-a' });
        const again = await jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:import', payload: { url: 'https://x/a.svs', label: 'A again' }, assetId: 'asset-a' });
        expect(again).toBe(first);
        const otherTenant = await jobs.enqueueJob({ tenantId: 2, pluginId: 'pathology', kind: 't:import', payload: { url: 'https://x/a.svs' }, assetId: 'asset-a' });
        expect(otherTenant).not.toBe(first);
        const rows = await dbAdapter.all("SELECT id FROM plugin_jobs WHERE kind = 't:import'", []);
        expect(rows).toHaveLength(2);

        jobs.resume();
        jobs.pump();
        expect((await settled(first)).state).toBe('done');
        // Finished work is not "pending": the same asset can be imported again.
        const later = await jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:import', payload: {}, assetId: 'asset-a' });
        expect(later).not.toBe(first);
        await settled(later);
    });

    it('refuses a tenant past its pending-job bound with a 429-classed error', async () => {
        jobs.registerJobHandler('t:bulk', async () => null);
        await jobs.drain({ timeoutMs: 100 });
        for (let i = 0; i < jobs.MAX_PENDING_JOBS_PER_TENANT; i += 1) {
            await jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:bulk', payload: { i } });
        }
        const refusal = jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:bulk', payload: { i: 'one more' } });
        await expect(refusal).rejects.toBeInstanceOf(jobs.JobQuotaExceeded);
        await expect(refusal).rejects.toMatchObject({ status: 429, code: 'plugin_job_quota' });
        // Another tenant is unaffected.
        await expect(jobs.enqueueJob({ tenantId: 2, pluginId: 'pathology', kind: 't:bulk', payload: {} })).resolves.toEqual(expect.any(String));
    });
});

describe('claim order', () => {
    it('alternates between tenants instead of draining the oldest tenant\'s batch first', async () => {
        const order = [];
        jobs.registerJobHandler('t:fair', async (job) => { order.push(job.tenant_id); });
        await jobs.drain({ timeoutMs: 100 });
        const ids = [];
        // Tenant 1 queues a batch of four first; tenant 2 queues two afterwards.
        for (let i = 0; i < 4; i += 1) ids.push(await jobs.enqueueJob({ tenantId: 1, pluginId: 'pathology', kind: 't:fair', payload: { i } }));
        for (let i = 0; i < 2; i += 1) ids.push(await jobs.enqueueJob({ tenantId: 2, pluginId: 'pathology', kind: 't:fair', payload: { i } }));
        jobs.resume();
        jobs.pump();
        for (const id of ids) await settled(id);
        expect(order).toEqual([1, 2, 1, 2, 1, 1]);
    });
});
