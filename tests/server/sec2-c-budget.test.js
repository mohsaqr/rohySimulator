// Regression locks: security audit 2026-10-26, F-06 / F-07 / L8-02 / L3-06 —
// every LLM and TTS limit was check-then-record: the check read usage that
// was written only after the upstream call finished, so N parallel requests
// all passed a limit one of them would have hit. The budget (usage_budget)
// and the daily/hourly LLM quota (llm_usage / llm_request_log) are now
// RESERVED at check time, under one lock, and settled afterwards.
// Also: F-18 / L3-08 migration 0074 backfills llm_usage / tts_usage tenants.
//
// Real sqlite on a temp file, migrations applied; no server.

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sec2-c-budget-secret';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2c-budget-'));
const dbFile = path.join(tmpDir, 'budget.sqlite');
process.env.ROHY_DB = dbFile;
process.env.ROHY_NO_AUTO_SEED = '1';
await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbFile, (err) => {
        if (err) return reject(err);
        runMigrations(handle).then(() => handle.close(resolve), reject);
    });
});
const dbAdapter = (await import('../../server/dbAdapter.js')).default;
await (await import('../../server/db.js')).dbReady;
const budget = await import('../../server/usage-budget.js');
const limits = await import('../../server/lib/llmLimits.js');

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

let userSeq = 0;
async function seedUser(tenant = 1) {
    userSeq += 1;
    await dbAdapter.run(`INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (?, ?, ?, 0)`, [tenant, `t${tenant}`, `T${tenant}`]);
    const r = await dbAdapter.run(`INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                                   VALUES (?, ?, ?, 'x', 'student', ?, 'active')`, [`sec2c-${userSeq}`, 'u', `u${userSeq}@x`, tenant]);
    return r.lastID;
}

const setSetting = (key, value) => dbAdapter.run(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [key, String(value)]);

describe('reserveBudget: check and reserve in one step', () => {
    // Regression lock: enforceBudget + later recordUsage let parallel requests all pass one budget (F-06/F-07)
    it('admits only as many concurrent reservations as fit under the limit', async () => {
        await setSetting('budget.tts.user.daily_characters', '1000');
        const attempts = Array.from({ length: 8 }, () => budget.reserveBudget({
            tenantId: 1, userId: 41, provider: 'tts-kokoro', metric: 'characters', amount: 300,
        }).then(() => 'ok', (err) => (err instanceof budget.BudgetExceededError ? 'refused' : err)));
        const results = await Promise.all(attempts);
        expect(results.filter((r) => r === 'ok')).toHaveLength(3);      // 3 × 300 ≤ 1000 < 4 × 300
        expect(results.filter((r) => r === 'refused')).toHaveLength(5);
        const used = await budget.getCurrentUsage({ tenantId: 1, userId: 41, provider: 'tts-kokoro', metric: 'characters' });
        expect(used.used).toBe(900);
    });

    it('settles a reservation down to the real amount, and release gives it all back', async () => {
        const scope = { tenantId: 1, userId: 42, provider: 'llm-custom', metric: 'tokens' };
        const r1 = await budget.reserveBudget({ ...scope, amount: 5000 });
        expect((await budget.getCurrentUsage(scope)).used).toBe(5000);
        await r1.settle(120);
        expect((await budget.getCurrentUsage(scope)).used).toBe(120);
        await r1.settle(99999);                       // idempotent: only the first settle counts
        expect((await budget.getCurrentUsage(scope)).used).toBe(120);
        const r2 = await budget.reserveBudget({ ...scope, amount: 700 });
        await r2.release();
        expect((await budget.getCurrentUsage(scope)).used).toBe(120);
        const tenant = await budget.getCurrentUsage({ ...scope, userId: null });
        expect(tenant.used).toBeGreaterThanOrEqual(120);
    });

    it('settles UP when the call cost more than reserved', async () => {
        const scope = { tenantId: 1, userId: 43, provider: 'llm-custom', metric: 'tokens' };
        const r = await budget.reserveBudget({ ...scope, amount: 100, minRequested: 256 });
        expect(r.reserved).toBe(256);
        await r.settle(400);
        expect((await budget.getCurrentUsage(scope)).used).toBe(400);
    });
});

describe('reserveLlmQuota: the daily/hourly LLM limits, reserved', () => {
    const today = new Date().toISOString().slice(0, 10);
    const base = { ...limits.LLM_LIMIT_DEFAULTS };

    // Regression lock: the daily token check read llm_usage written only after completion (F-06)
    it('counts in-flight reservations, so parallel requests cannot all pass', async () => {
        const L = { ...base, tokensPerUserDaily: 10_000 };
        const tries = Array.from({ length: 5 }, () => limits.reserveLlmQuota({
            tenantId: 1, userId: 51, date: today, limits: L, estimatedTokens: 3000, estimatedCost: 0,
        }).then((r) => r, (err) => (err instanceof limits.LlmQuotaRefusal ? err : Promise.reject(err))));
        const out = await Promise.all(tries);
        const admitted = out.filter((r) => !(r instanceof limits.LlmQuotaRefusal));
        const refused = out.filter((r) => r instanceof limits.LlmQuotaRefusal);
        expect(admitted).toHaveLength(3);
        expect(refused).toHaveLength(2);
        expect(refused[0].body).toMatchObject({ error: 'Daily token limit exceeded', tokensLimit: 10_000 });
        admitted.forEach((r) => r.release());
        expect(limits._pendingLlmQuota().users).toBe(0);
    });

    it('counts recorded usage plus the estimate (input chars count too)', async () => {
        const uid = await seedUser(1);
        await dbAdapter.run(`INSERT INTO llm_usage (user_id, tenant_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, request_count)
                             VALUES (?, 1, ?, 900, 0, 900, 0, 1)`, [uid, today]);
        const L = { ...base, tokensPerUserDaily: 1000 };
        await expect(limits.reserveLlmQuota({ tenantId: 1, userId: uid, date: today, limits: L, estimatedTokens: limits.estimateTokens(800), estimatedCost: 0 }))
            .rejects.toBeInstanceOf(limits.LlmQuotaRefusal);
        const small = await limits.reserveLlmQuota({ tenantId: 1, userId: uid, date: today, limits: L, estimatedTokens: limits.estimateTokens(40), estimatedCost: 0 });
        small.release();
    });

    it('enforces the hourly request limit against in-flight requests', async () => {
        const L = { ...base, requestsPerUserHourly: 2 };
        const a = await limits.reserveLlmQuota({ tenantId: 1, userId: 53, date: today, limits: L, estimatedTokens: 1, estimatedCost: 0 });
        const b = await limits.reserveLlmQuota({ tenantId: 1, userId: 53, date: today, limits: L, estimatedTokens: 1, estimatedCost: 0 });
        const c = await limits.reserveLlmQuota({ tenantId: 1, userId: 53, date: today, limits: L, estimatedTokens: 1, estimatedCost: 0 }).catch((e) => e);
        expect(c).toBeInstanceOf(limits.LlmQuotaRefusal);
        expect(c.body.code).toBe('hourly_limit');
        a.release(); b.release();
    });

    it('applies the tenant limit to one tenant only', async () => {
        const spender = await seedUser(2);
        await dbAdapter.run(`INSERT INTO llm_usage (user_id, tenant_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, request_count)
                             VALUES (?, 2, ?, 5000, 0, 5000, 0, 1)`, [spender, today]);
        const L = { ...base, tokensTenantDaily: 5000 };
        await expect(limits.reserveLlmQuota({ tenantId: 2, userId: 62, date: today, limits: L, estimatedTokens: 10, estimatedCost: 0 }))
            .rejects.toMatchObject({ body: { code: 'tenant_daily_limit' } });
        const other = await limits.reserveLlmQuota({ tenantId: 3, userId: 63, date: today, limits: L, estimatedTokens: 10, estimatedCost: 0 });
        other.release();
    });

    // Regression lock: the admin page showed 100k tokens/day etc. while the proxy enforced nothing when unset (F-24)
    it('one truth for the defaults: unset reads 0 (= no limit), a stored 0 stays 0', async () => {
        expect(await limits.readLlmLimits(async () => null)).toEqual(limits.LLM_LIMIT_DEFAULTS);
        expect(Object.values(limits.LLM_LIMIT_DEFAULTS).every((v) => v === 0)).toBe(true);
        const stored = { rate_limit_tokens_per_user_daily: '0', rate_limit_requests_per_user_hourly: '40', rate_limit_cost_per_user_daily: 'junk' };
        const read = await limits.readLlmLimits(async (k) => stored[k] ?? null);
        expect(read.tokensPerUserDaily).toBe(0);
        expect(read.requestsPerUserHourly).toBe(40);
        expect(read.costPerUserDaily).toBe(0);
    });

    it('meters a reply with no provider usage from its characters, never 0', () => {
        expect(limits.usageOrEstimate({ promptTokens: 0, completionTokens: 0, inputChars: 400, outputChars: 41 }))
            .toMatchObject({ promptTokens: 100, completionTokens: 11, totalTokens: 111, estimated: true });
        expect(limits.usageOrEstimate({ promptTokens: 10, completionTokens: 5, inputChars: 400, outputChars: 41 }))
            .toMatchObject({ totalTokens: 15, estimated: false });
    });
});

describe('migration 0074 backfills usage tenants', () => {
    // Regression lock: llm_usage / tts_usage rows were all tenant 1 (F-18 / L3-08)
    it('moves rows to their user\'s tenant and leaves tenant-1 users alone (idempotent)', async () => {
        const u2 = await dbAdapter.run(`INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('mig74-b', 'b', 'b@x', 'x', 'student', 2, 'active')`);
        const u1 = await dbAdapter.run(`INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('mig74-a', 'a', 'a@x', 'x', 'student', 1, 'active')`);
        await dbAdapter.run(`INSERT INTO llm_usage (user_id, date, total_tokens) VALUES (?, '2026-10-01', 10), (?, '2026-10-01', 20)`, [u2.lastID, u1.lastID]);
        await dbAdapter.run(`INSERT INTO tts_usage (user_id, date, provider, char_count) VALUES (?, '2026-10-01', 'kokoro', 5)`, [u2.lastID]);
        const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../../migrations/0074_usage_tenant_backfill.sql'), 'utf8');
        const apply = () => new Promise((resolve, reject) => {
            const handle = new sqlite3.Database(dbFile, (err) => {
                if (err) return reject(err);
                handle.exec(sql, (e) => handle.close(() => (e ? reject(e) : resolve())));
            });
        });
        await apply();
        await apply();
        const rows = await dbAdapter.all('SELECT user_id, tenant_id FROM llm_usage WHERE date = ? ORDER BY user_id', ['2026-10-01']);
        expect(rows).toEqual([{ user_id: u2.lastID, tenant_id: 2 }, { user_id: u1.lastID, tenant_id: 1 }].sort((a, b) => a.user_id - b.user_id));
        expect((await dbAdapter.get('SELECT tenant_id FROM tts_usage WHERE user_id = ?', [u2.lastID])).tenant_id).toBe(2);
    });
});
