import dbAdapter from './dbAdapter.js';

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

async function incrementBucket({ tenantId, userId, provider, metric, amount, window }) {
    const userClause = userId == null ? 'user_id IS NULL' : 'user_id = ?';
    const params = userId == null
        ? [amount, tenantId, provider, metric, window.start]
        : [amount, tenantId, userId, provider, metric, window.start];
    const updated = await dbAdapter.run(
        `UPDATE usage_budget
         SET used = used + ?
         WHERE tenant_id = ? AND ${userClause} AND provider = ? AND metric = ? AND window_start = ?`,
        params
    );
    if (updated.changes > 0) return;

    await dbAdapter.run(
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
    await dbAdapter.transaction(async () => {
        if (userId != null) {
            await incrementBucket({ tenantId, userId, provider, metric, amount: Number(amount), window });
        }
        await incrementBucket({ tenantId, userId: null, provider, metric, amount: Number(amount), window });
    });
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

export async function enforceBudget({ tenantId, userId, provider, metric, requested }) {
    const amount = Math.max(0, Number(requested) || 0);
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

export function budgetExceededResponse(err) {
    return {
        error: 'Budget exceeded',
        budget_exceeded: true,
        resetsAt: err.resetsAt,
        used: err.used,
        limit: err.limit,
    };
}
