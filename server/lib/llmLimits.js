// The LLM proxy's limits: one definition read by the proxy and by every page
// that shows them, plus the request-rate, concurrency and daily-quota checks
// that POST /api/proxy/llm makes before it calls a provider.
//
// Security audit 2026-10-26:
//   F-06 / L8-02 — /proxy/llm had no per-user request rate or concurrency cap,
//     and every daily check read usage that was recorded only AFTER the
//     upstream call finished, so N parallel requests all passed a check that
//     one of them would have failed. The quota is now RESERVED at check time
//     (estimated input + output tokens and cost), under one in-process lock,
//     and settled when the call ends.
//   F-24 / L3-05 — the admin page displayed defaults (100k tokens/day, $10/day,
//     100 requests/hour) that the proxy treated as "unlimited" when unset. ONE
//     truth now: LLM_LIMIT_DEFAULTS below, which both read. The defaults are 0
//     (= no limit) because that is what every existing install has enforced
//     until today; turning a cap on silently would refuse learners mid-pilot
//     (FIX-BRIEF rule 7). An administrator sets a number to enforce one.

import dbAdapter from '../dbAdapter.js';
import { withKeyedLock } from './keyedLock.js';
import { createGate, envInt, GateFullError } from './concurrencyGate.js';
import { perUserRateLimit, RATE_LIMITED_CODE } from '../middleware/perUserRateLimit.js';
import { principalKey } from './requestPrincipal.js';
import { sqlNowPlus } from '../shared/time.js';

/**
 * platform_settings key → field name, and the value used when a key is unset.
 * 0 means "no limit". `*Tenant*` limits are new (2026-10-26): the "platform"
 * limits stay install-wide, the tenant ones stop one tenant from spending the
 * whole install's allowance.
 */
export const LLM_LIMIT_SETTINGS = Object.freeze({
    tokensPerUserDaily: 'rate_limit_tokens_per_user_daily',
    costPerUserDaily: 'rate_limit_cost_per_user_daily',
    tokensTenantDaily: 'rate_limit_tokens_tenant_daily',
    costTenantDaily: 'rate_limit_cost_tenant_daily',
    tokensPlatformDaily: 'rate_limit_tokens_platform_daily',
    costPlatformDaily: 'rate_limit_cost_platform_daily',
    requestsPerUserHourly: 'rate_limit_requests_per_user_hourly',
});

export const LLM_LIMIT_DEFAULTS = Object.freeze({
    tokensPerUserDaily: 0,
    costPerUserDaily: 0,
    tokensTenantDaily: 0,
    costTenantDaily: 0,
    tokensPlatformDaily: 0,
    costPlatformDaily: 0,
    requestsPerUserHourly: 0,
});

/** Parse one stored limit: a finite number ≥ 0, else the default. */
export function parseLimit(raw, fallback = 0) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The effective limits, exactly as the proxy enforces them. `getSetting` is
 * an async (key) => value|null; it defaults to a platform_settings read.
 */
export async function readLlmLimits(getSetting = readPlatformSetting) {
    const entries = await Promise.all(Object.entries(LLM_LIMIT_SETTINGS).map(async ([field, key]) =>
        [field, parseLimit(await getSetting(key), LLM_LIMIT_DEFAULTS[field])]));
    return Object.fromEntries(entries);
}

async function readPlatformSetting(key) {
    const row = await dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]);
    return row?.setting_value ?? null;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Characters per token used for estimates (a common rule of thumb for English). */
export const CHARS_PER_TOKEN = 4;

/** Estimated tokens for a text length, never 0 for non-empty text. */
export function estimateTokens(chars) {
    const n = Number(chars) || 0;
    return n <= 0 ? 0 : Math.ceil(n / CHARS_PER_TOKEN);
}

/**
 * Usage to record for a finished call: the provider's own numbers when it sent
 * them, otherwise an estimate from the characters in and out — so a streamed
 * reply whose provider sent no usage is never recorded as 0 (L3-02).
 */
export function usageOrEstimate({ promptTokens, completionTokens, inputChars, outputChars }) {
    const prompt = Number(promptTokens) > 0 ? Number(promptTokens) : estimateTokens(inputChars);
    const completion = Number(completionTokens) > 0 ? Number(completionTokens) : estimateTokens(outputChars);
    return {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
        estimated: !(Number(promptTokens) > 0) || (!(Number(completionTokens) > 0) && Number(outputChars) > 0),
    };
}

// ---------------------------------------------------------------------------
// Daily / hourly quota with reservation
// ---------------------------------------------------------------------------

// Reserved-but-not-yet-recorded spend, per scope. Settled entries are removed
// only AFTER the caller has written the real llm_usage / llm_request_log rows,
// so a request is always counted in one place or the other.
const pending = {
    user: new Map(),        // `${tenant}:${user}` -> { tokens, cost, requests }
    tenant: new Map(),      // tenant -> { tokens, cost }
    install: { tokens: 0, cost: 0 },
};

function bump(map, key, delta) {
    const cur = map.get(key) || { tokens: 0, cost: 0, requests: 0 };
    const next = {
        tokens: cur.tokens + (delta.tokens || 0),
        cost: cur.cost + (delta.cost || 0),
        requests: cur.requests + (delta.requests || 0),
    };
    if (next.tokens <= 0 && next.cost <= 1e-12 && next.requests <= 0) map.delete(key);
    else map.set(key, next);
}

/** Classed refusal so the route can log it and answer 429 with its body. */
export class LlmQuotaRefusal extends Error {
    constructor(logMessage, body) {
        super(logMessage);
        this.name = 'LlmQuotaRefusal';
        this.code = 'LLM_QUOTA';
        this.logMessage = logMessage;
        this.body = body;
    }
}

/**
 * Check every configured LLM limit against recorded usage PLUS what other
 * in-flight requests have reserved PLUS this request's estimate, and reserve
 * the estimate — atomically, under one lock. Throws LlmQuotaRefusal when a
 * limit would be passed. Returns `{ release }`; call release() once the
 * request's real usage rows are written (or when it failed).
 *
 * @param {object} args
 * @param {number} args.tenantId
 * @param {number} args.userId
 * @param {string} args.date            YYYY-MM-DD (UTC day of llm_usage)
 * @param {object} args.limits          readLlmLimits()
 * @param {number} args.estimatedTokens input + output tokens
 * @param {number} args.estimatedCost   USD
 */
export async function reserveLlmQuota({ tenantId, userId, date, limits, estimatedTokens, estimatedCost }) {
    const userKey = `${tenantId}:${userId}`;
    const est = { tokens: Math.max(0, Number(estimatedTokens) || 0), cost: Math.max(0, Number(estimatedCost) || 0) };
    await withKeyedLock('llm-quota', async () => {
        const L = limits;
        const pu = pending.user.get(userKey) || { tokens: 0, cost: 0, requests: 0 };
        const pt = pending.tenant.get(tenantId) || { tokens: 0, cost: 0 };
        const pi = pending.install;

        if (L.tokensPerUserDaily > 0 || L.costPerUserDaily > 0) {
            const row = await dbAdapter.get(
                'SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(estimated_cost), 0) AS cost FROM llm_usage WHERE user_id = ? AND date = ?',
                [userId, date]
            );
            const tokens = Number(row?.tokens || 0) + pu.tokens;
            const cost = Number(row?.cost || 0) + pu.cost;
            if (L.tokensPerUserDaily > 0 && tokens + est.tokens > L.tokensPerUserDaily) {
                throw new LlmQuotaRefusal('User daily token limit exceeded', {
                    error: 'Daily token limit exceeded', tokensUsed: tokens, tokensLimit: L.tokensPerUserDaily, resetsAt: 'midnight UTC',
                });
            }
            if (L.costPerUserDaily > 0 && cost + est.cost > L.costPerUserDaily) {
                throw new LlmQuotaRefusal('User daily cost limit exceeded', {
                    error: 'Daily cost limit exceeded', costUsed: cost, costLimit: L.costPerUserDaily, resetsAt: 'midnight UTC',
                });
            }
        }
        if (L.tokensTenantDaily > 0 || L.costTenantDaily > 0) {
            const row = await dbAdapter.get(
                'SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(estimated_cost), 0) AS cost FROM llm_usage WHERE tenant_id = ? AND date = ?',
                [tenantId, date]
            );
            const tokens = Number(row?.tokens || 0) + pt.tokens;
            const cost = Number(row?.cost || 0) + pt.cost;
            if (L.tokensTenantDaily > 0 && tokens + est.tokens > L.tokensTenantDaily) {
                throw new LlmQuotaRefusal('Tenant daily token limit exceeded', {
                    error: 'Daily token limit for your organisation exceeded. Please try again tomorrow.', code: 'tenant_daily_limit', resetsAt: 'midnight UTC',
                });
            }
            if (L.costTenantDaily > 0 && cost + est.cost > L.costTenantDaily) {
                throw new LlmQuotaRefusal('Tenant daily cost limit exceeded', {
                    error: 'Daily cost limit for your organisation exceeded. Please try again tomorrow.', code: 'tenant_daily_limit', resetsAt: 'midnight UTC',
                });
            }
        }
        if (L.tokensPlatformDaily > 0 || L.costPlatformDaily > 0) {
            const row = await dbAdapter.get(
                'SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(estimated_cost), 0) AS cost FROM llm_usage WHERE date = ?',
                [date]
            );
            const tokens = Number(row?.tokens || 0) + pi.tokens;
            const cost = Number(row?.cost || 0) + pi.cost;
            if (L.tokensPlatformDaily > 0 && tokens + est.tokens > L.tokensPlatformDaily) {
                throw new LlmQuotaRefusal('Platform daily token limit exceeded', {
                    error: 'Platform daily token limit exceeded. Please try again tomorrow.', resetsAt: 'midnight UTC',
                });
            }
            if (L.costPlatformDaily > 0 && cost + est.cost > L.costPlatformDaily) {
                throw new LlmQuotaRefusal('Platform daily cost limit exceeded', {
                    error: 'Platform daily cost limit exceeded. Please try again tomorrow.', resetsAt: 'midnight UTC',
                });
            }
        }
        if (L.requestsPerUserHourly > 0) {
            // Counts this user's requests that reached the provider in the last
            // hour (refusals are not held against them), plus those in flight.
            const row = await dbAdapter.get(
                `SELECT COUNT(*) AS n FROM llm_request_log
                  WHERE tenant_id = ? AND user_id = ?
                    AND COALESCE(status, 'success') != 'rate_limited'
                    AND request_timestamp >= ${sqlNowPlus("'-1 hour'")}`,
                [tenantId, userId]
            );
            const requests = Number(row?.n || 0) + pu.requests;
            if (requests >= L.requestsPerUserHourly) {
                throw new LlmQuotaRefusal('User hourly request limit exceeded', {
                    error: 'Hourly request limit reached. Please try again later.',
                    code: 'hourly_limit', requestsUsed: requests, requestsLimit: L.requestsPerUserHourly,
                });
            }
        }
        bump(pending.user, userKey, { ...est, requests: 1 });
        bump(pending.tenant, tenantId, est);
        pending.install.tokens += est.tokens;
        pending.install.cost += est.cost;
    });
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            bump(pending.user, userKey, { tokens: -est.tokens, cost: -est.cost, requests: -1 });
            bump(pending.tenant, tenantId, { tokens: -est.tokens, cost: -est.cost });
            pending.install.tokens = Math.max(0, pending.install.tokens - est.tokens);
            pending.install.cost = Math.max(0, pending.install.cost - est.cost);
        },
    };
}

/** Test seam: what is reserved right now. */
export const _pendingLlmQuota = () => ({
    users: pending.user.size, tenants: pending.tenant.size, install: { ...pending.install },
});

// ---------------------------------------------------------------------------
// Request rate and concurrency (middleware for POST /proxy/llm)
// ---------------------------------------------------------------------------

const rateLimitDisabled = () => process.env.ROHY_DISABLE_GENERAL_RATE_LIMIT === '1';

/** Requests per user per minute (ROHY_LLM_RATE_PER_MIN, default 60). */
export const llmRateLimiter = perUserRateLimit({
    max: envInt('ROHY_LLM_RATE_PER_MIN', 60),
    windowMs: 60 * 1000,
    message: 'Too many messages in a short time. Please wait a moment and try again.',
    skip: rateLimitDisabled,
});

const llmGate = createGate({
    name: 'llm',
    maxActive: envInt('ROHY_LLM_MAX_INFLIGHT', 64),
    maxQueued: 0,
    perKeyActive: envInt('ROHY_LLM_MAX_INFLIGHT_PER_USER', 3),
    perKeyQueued: 0,
});

/**
 * Admit at most ROHY_LLM_MAX_INFLIGHT_PER_USER (default 3) concurrent LLM
 * requests per user and ROHY_LLM_MAX_INFLIGHT (default 64) in all; the next
 * is answered 429 at once. The slot is held until the response is finished or
 * the client goes away.
 */
export function llmInFlightGuard(req, res, next) {
    llmGate.acquire(principalKey(req)).then((release) => {
        res.once('finish', release);
        res.once('close', release);
        next();
    }, (err) => {
        if (!(err instanceof GateFullError)) return next(err);
        (req.log)?.warn?.('llm request refused: too many in flight', { scope: err.scope });
        return res.status(429).json({
            error: 'Too many replies are being generated for you at once. Please wait for one to finish.',
            code: RATE_LIMITED_CODE,
        });
    });
}

export const _llmGateStats = () => llmGate.stats();
