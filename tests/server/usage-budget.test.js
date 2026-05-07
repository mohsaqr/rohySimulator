import { beforeEach, describe, expect, it, vi } from 'vitest';

let rows;
let settings;

function windowForNow() {
    const day = 24 * 60 * 60 * 1000;
    const start = new Date(Math.floor(Date.now() / day) * day).toISOString();
    const end = new Date(new Date(start).getTime() + day).toISOString();
    return { start, end };
}

function match(row, { tenantId, userId, provider, metric, windowStart }) {
    return row.tenant_id === tenantId
        && (userId == null ? row.user_id == null : row.user_id === userId)
        && row.provider === provider
        && row.metric === metric
        && row.window_start === windowStart;
}

vi.mock('../../server/dbAdapter.js', () => ({
    default: {
        async get(sql, params = []) {
            if (sql.includes('FROM platform_settings')) {
                return settings.has(params[0]) ? { setting_value: settings.get(params[0]) } : null;
            }
            if (sql.includes('FROM usage_budget')) {
                const userNull = sql.includes('user_id IS NULL');
                const [tenantId, a, b, c, d] = params;
                const userId = userNull ? null : a;
                const provider = userNull ? a : b;
                const metric = userNull ? b : c;
                const windowStart = userNull ? c : d;
                const used = rows
                    .filter((row) => match(row, { tenantId, userId, provider, metric, windowStart }))
                    .reduce((sum, row) => sum + row.used, 0);
                return { used };
            }
            return null;
        },
        async run(sql, params = []) {
            if (sql.trim().startsWith('UPDATE usage_budget')) {
                const userNull = sql.includes('user_id IS NULL');
                const [amount, tenantId, a, b, c, d] = params;
                const userId = userNull ? null : a;
                const provider = userNull ? a : b;
                const metric = userNull ? b : c;
                const windowStart = userNull ? c : d;
                const row = rows.find((item) => match(item, { tenantId, userId, provider, metric, windowStart }));
                if (!row) return { changes: 0 };
                row.used += amount;
                return { changes: 1 };
            }
            if (sql.trim().startsWith('INSERT INTO usage_budget')) {
                const [tenantId, userId, provider, metric, windowStart, windowEnd, used] = params;
                rows.push({ tenant_id: tenantId, user_id: userId, provider, metric, window_start: windowStart, window_end: windowEnd, used });
                return { changes: 1, lastID: rows.length };
            }
            return { changes: 0 };
        },
        async transaction(work) {
            return work();
        },
    },
}));

describe('usage budget tracker', () => {
    let budget;

    beforeEach(async () => {
        vi.useRealTimers();
        rows = [];
        settings = new Map();
        budget = await import('../../server/usage-budget.js');
    });

    it('recordUsage increments per-user and tenant aggregate buckets', async () => {
        await budget.recordUsage({ tenantId: 1, userId: 7, provider: 'llm-openai', metric: 'tokens', amount: 100 });
        await budget.recordUsage({ tenantId: 1, userId: 7, provider: 'llm-openai', metric: 'tokens', amount: 25 });

        expect(await budget.getCurrentUsage({ tenantId: 1, userId: 7, provider: 'llm-openai', metric: 'tokens' }))
            .toMatchObject({ used: 125, limit: 1_000_000, exceeded: false });
        expect(await budget.getCurrentUsage({ tenantId: 1, userId: null, provider: 'llm-openai', metric: 'tokens' }))
            .toMatchObject({ used: 125, limit: 10_000_000, exceeded: false });
    });

    it('enforceBudget throws when the user limit would be exceeded', async () => {
        settings.set('budget.llm.user.daily_tokens', '10');
        await budget.recordUsage({ tenantId: 1, userId: 7, provider: 'llm-openai', metric: 'tokens', amount: 8 });

        await expect(budget.enforceBudget({ tenantId: 1, userId: 7, provider: 'llm-openai', metric: 'tokens', requested: 3 }))
            .rejects.toMatchObject({ name: 'BudgetExceededError', used: 8, limit: 10 });
    });

    it('window rollover after 24h resets current usage', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
        await budget.recordUsage({ tenantId: 1, userId: 7, provider: 'tts-google', metric: 'characters', amount: 100 });
        expect((await budget.getCurrentUsage({ tenantId: 1, userId: 7, provider: 'tts-google', metric: 'characters' })).used).toBe(100);

        vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
        expect((await budget.getCurrentUsage({ tenantId: 1, userId: 7, provider: 'tts-google', metric: 'characters' })).used).toBe(0);
    });

    it('parallel recordUsage calls do not lose increments', async () => {
        await Promise.all(Array.from({ length: 10 }, () =>
            budget.recordUsage({ tenantId: 1, userId: 7, provider: 'tts-google', metric: 'characters', amount: 3 })
        ));

        const window = windowForNow();
        const total = rows
            .filter((row) => match(row, {
                tenantId: 1,
                userId: 7,
                provider: 'tts-google',
                metric: 'characters',
                windowStart: window.start,
            }))
            .reduce((sum, row) => sum + row.used, 0);
        expect(total).toBe(30);
    });
});
