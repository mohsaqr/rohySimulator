import dbAdapter from './dbAdapter.js';
import { withKeyedLock } from './lib/keyedLock.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LIMITS = {
    'llm:tokens:user': 1_000_000,
    'llm:tokens:tenant': 10_000_000,
    'tts:characters:user': 500_000,
    'tts:characters:tenant': 5_000_000,
};

const SETTING_KEYS = {
    'llm:tokens:user': 'budget.llm.user.daily_tokens',
    'llm:tokens:tenant': 'budget.llm.tenant.daily_tokens',
    'tts:characters:user': 'budget.tts.user.daily_characters',
    'tts:characters:tenant': 'budget.tts.tenant.daily_characters',
};

export class BudgetExceededError extends Error {
    constructor({ resetsAt, used, limit }) {
        super('Budget exceeded');
        this.name = 'BudgetExceededError';
        this.resetsAt = resetsAt;
        this.used = used;
        this.limit = limit;
    }
}

function familyFor(provider) {
    return String(provider || '').startsWith('tts-') ? 'tts' : 'llm';
}

function limitKey(provider, metric, scope) {
    return `${familyFor(provider)}:${metric}:${scope}`;
}

function currentWindow(now = new Date()) {
    const startMs = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
    const endMs = startMs + DAY_MS;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
    };
}

async function readLimit(provider, metric, scope) {
    const key = limitKey(provider, metric, scope);
    const settingKey = SETTING_KEYS[key];
    const row = settingKey
        ? await dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [settingKey])
        : null;
    const parsed = row?.setting_value !== undefined && row?.setting_value !== null
        ? Number(row.setting_value)
        : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMITS[key] ?? 0;
}

// `tx` is the transaction's own runner (see recordUsage), never the shared handle.
async function incrementBucket(tx, { tenantId, userId, provider, metric, amount, window }) {
    const userClause = userId == null ? 'user_id IS NULL' : 'user_id = ?';
    const params = userId == null
        ? [amount, tenantId, provider, metric, window.start]
        : [amount, tenantId, userId, provider, metric, window.start];
    const updated = await tx.run(
        `UPDATE usage_budget
         SET used = MAX(0, used + ?)
         WHERE tenant_id = ? AND ${userClause} AND provider = ? AND metric = ? AND window_start = ?`,
        params
    );
    // A negative amount settles a reservation down; with no row there is
    // nothing to give back (the window rolled over), never a negative row.
    if (updated.changes > 0 || amount <= 0) return;

    await tx.run(
        `INSERT INTO usage_budget (tenant_id, user_id, provider, metric, window_start, window_end, used)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, userId ?? null, provider, metric, window.start, window.end, amount]
    );
}

async function readUsed({ tenantId, userId, provider, metric, window }) {
    const row = userId == null
        ? await dbAdapter.get(
            `SELECT COALESCE(SUM(used), 0) AS used
             FROM usage_budget
             WHERE tenant_id = ? AND user_id IS NULL AND provider = ? AND metric = ? AND window_start = ?`,
            [tenantId, provider, metric, window.start]
        )
        : await dbAdapter.get(
            `SELECT COALESCE(SUM(used), 0) AS used
             FROM usage_budget
             WHERE tenant_id = ? AND user_id = ? AND provider = ? AND metric = ? AND window_start = ?`,
            [tenantId, userId, provider, metric, window.start]
        );
    return Number(row?.used || 0);
}

export async function recordUsage({ tenantId, userId, provider, metric, amount }) {
    if (!tenantId || !provider || !metric || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    const window = currentWindow();
    // A transaction on its OWN connection. `dbAdapter.transaction()` runs on the
    // shared handle and its serialisation does not span awaits, so two usage
    // writes in flight at once (voice mode synthesises sentences concurrently
    // since rc.70) collided: the second BEGIN IMMEDIATE failed with "cannot
    // start a transaction within a transaction" and the TTS request answered
    // 500 (production, 2026-10-25). The isolated connection takes the database
    // write lock instead and the other writer waits on its busy timeout.
    // One budget writer at a time in this process, too: a burst of sentences
    // would otherwise open a connection each and queue on the file lock.
    await withKeyedLock('usage-budget', () => dbAdapter.isolatedTransaction(async (tx) => {
        if (userId != null) {
            await incrementBucket(tx, { tenantId, userId, provider, metric, amount: Number(amount), window });
        }
        await incrementBucket(tx, { tenantId, userId: null, provider, metric, amount: Number(amount), window });
    }));
}

export async function getCurrentUsage({ tenantId, userId = null, provider, metric }) {
    const window = currentWindow();
    const scope = userId == null ? 'tenant' : 'user';
    const [used, limit] = await Promise.all([
        readUsed({ tenantId, userId, provider, metric, window }),
        readLimit(provider, metric, scope),
    ]);
    return {
        used,
        limit,
        resetsAt: window.end,
        exceeded: limit > 0 && used >= limit,
    };
}

/**
 * The smallest output-token reservation the LLM pre-flight makes. A session
 * may ask for fewer output tokens, but the pre-flight never reserves less,
 * so a tiny client-supplied value cannot slip a request under a budget it
 * would otherwise exceed.
 */
export const LLM_MIN_PREFLIGHT_TOKENS = 256;

/**
 * Refuse (BudgetExceededError) when `requested` more units would take the
 * user's or the tenant's daily usage over its limit. `minRequested` is a floor
 * on the reservation; the caller passes it when `requested` is user-controlled.
 */
export async function enforceBudget({ tenantId, userId, provider, metric, requested, minRequested = 0 }) {
    const amount = Math.max(0, Number(minRequested) || 0, Number(requested) || 0);
    const checks = [
        await getCurrentUsage({ tenantId, userId, provider, metric }),
        await getCurrentUsage({ tenantId, userId: null, provider, metric }),
    ];
    for (const usage of checks) {
        if (usage.limit > 0 && usage.used + amount > usage.limit) {
            throw new BudgetExceededError(usage);
        }
    }
}

const NOOP_RESERVATION = Object.freeze({ reserved: 0, settle: async () => {}, release: async () => {} });

/**
 * Check AND reserve, atomically: refuse (BudgetExceededError) when `amount`
 * more units would take the user's or the tenant's daily usage over its
 * limit, otherwise add `amount` to both buckets before returning. Two
 * requests arriving together can no longer both pass a check that only one
 * of them fits under (security audit 2026-10-26, F-06/F-07: enforceBudget
 * read usage that was recorded only after the upstream call finished).
 *
 * The returned reservation is settled once the real amount is known:
 * `settle(actual)` moves the buckets by `actual - reserved` (down as well as
 * up), `release()` gives the whole reservation back (the call failed before
 * anything was spent). Both are idempotent; only the first call counts.
 *
 * `minRequested` floors the reservation, for a user-controlled `amount`.
 *
 * @returns {Promise<{ reserved: number, settle: (actual: number) => Promise<void>, release: () => Promise<void> }>}
 */
export async function reserveBudget({ tenantId, userId, provider, metric, amount, minRequested = 0 }) {
    if (!tenantId || !provider || !metric) return NOOP_RESERVATION;
    const reserved = Math.max(0, Math.ceil(Number(minRequested) || 0), Math.ceil(Number(amount) || 0));
    const window = currentWindow();
    const userScope = { tenantId, userId, provider, metric };
    // Same lock as recordUsage: every budget writer in this process is
    // serialised, so the read below sees every earlier reservation.
    await withKeyedLock('usage-budget', async () => {
        const checks = [
            await getCurrentUsage(userScope),
            await getCurrentUsage({ ...userScope, userId: null }),
        ];
        for (const usage of checks) {
            if (usage.limit > 0 && usage.used + reserved > usage.limit) {
                throw new BudgetExceededError(usage);
            }
        }
        if (reserved > 0) {
            await dbAdapter.isolatedTransaction(async (tx) => {
                if (userId != null) await incrementBucket(tx, { tenantId, userId, provider, metric, amount: reserved, window });
                await incrementBucket(tx, { tenantId, userId: null, provider, metric, amount: reserved, window });
            });
        }
    });
    let settled = false;
    const settle = async (actual) => {
        if (settled) return;
        settled = true;
        const delta = Math.max(0, Math.ceil(Number(actual) || 0)) - reserved;
        if (delta === 0) return;
        await withKeyedLock('usage-budget', () => dbAdapter.isolatedTransaction(async (tx) => {
            if (userId != null) await incrementBucket(tx, { tenantId, userId, provider, metric, amount: delta, window });
            await incrementBucket(tx, { tenantId, userId: null, provider, metric, amount: delta, window });
        }));
    };
    return { reserved, settle, release: () => settle(0) };
}

export function budgetExceededResponse(err) {
    return {
        error: 'Budget exceeded',
        budget_exceeded: true,
        resetsAt: err.resetsAt,
        used: err.used,
        limit: err.limit,
    };
}
