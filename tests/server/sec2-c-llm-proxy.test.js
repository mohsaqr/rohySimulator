// Route-level regression locks for the LLM proxy, security audit 2026-10-26:
//   F-06 / L8-02 — no per-user rate or concurrency cap; budgets checked
//     against usage recorded only after earlier calls finished;
//   L3-02 — streamed replies metered as 0 tokens (no include_usage);
//   F-22 / L3-03 — the non-streamed reply passed the provider's whole JSON
//     (reasoning_content, <think>) through;
//   L3-07 — upstream bodies read unbounded;
//   L3 info — upstream error text shown to learners;
//   F-18 / L3-08 — llm_usage rows never carried the tenant; usage views and
//     the pricing table were reachable install-wide by any tenant admin
//     (F-02 / L3-09 for PUT /llm/pricing).
//
// One real server; the "provider" is a local stub on 127.0.0.1 whose
// behaviour each test sets (`stub.mode`).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { startTestServer } from '../utils/startTestServer.js';
import { all, asUser, closeDb, get, openDb, run, seedUser } from '../utils/authHttp.js';

const SK = 'sk-provider-secret-123';

function startStub() {
    const state = { mode: 'json', delayMs: 0, bodies: [] };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            let body = null;
            try { body = JSON.parse(raw); } catch { /* not JSON */ }
            state.bodies.push(body);
            const answer = () => {
                switch (state.mode) {
                    case 'reasoning':
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            id: 'cmpl-x', system_fingerprint: 'fp_secret',
                            choices: [{ index: 0, message: { role: 'assistant', content: '<think>The diagnosis is STEMI.</think>\nMy chest hurts.', reasoning_content: 'The diagnosis is STEMI.' }, finish_reason: 'stop' }],
                            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13, completion_tokens_details: { reasoning_tokens: 50 } },
                            model: 'stub-model',
                        }));
                        return;
                    case 'sse':
                        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                        ['<think>secret plan</think>', 'Hello ', 'there.'].forEach((t) => {
                            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
                        });
                        res.end('data: [DONE]\n\n');
                        return;
                    case 'big':
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(3 * 1024 * 1024) } }] }));
                        return;
                    case '401':
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${SK}` } }));
                        return;
                    default:
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
                        }));
                }
            };
            if (state.delayMs > 0) setTimeout(answer, state.delayMs); else answer();
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ state, baseUrl: `http://127.0.0.1:${port}/v1`, close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); } });
        });
    });
}

let server; let stub;
const users = {};

async function dbDo(fn) {
    const db = await openDb(server.dbPath);
    try { return await fn(db); } finally { await closeDb(db); }
}
async function setSettings(pairs) {
    await dbDo(async (db) => {
        for (const [k, v] of Object.entries(pairs)) {
            await run(db, `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
                           ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [k, String(v)]);
        }
    });
}
async function newSession(call) {
    const res = await call('/api/sessions', { method: 'POST', json: { case_id: 1, student_name: 'S' } });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    return (await res.json()).id;
}
const ask = (call, sessionId, extra = {}) => call('/api/proxy/llm', {
    method: 'POST',
    json: { session_id: sessionId, messages: [{ role: 'user', content: 'hello' }], agent_llm_config: { persona: 'patient' }, ...extra },
});

beforeAll(async () => {
    stub = await startStub();
    server = await startTestServer({ env: { ROHY_LLM_RATE_PER_MIN: '8' } });
    await dbDo(async (db) => {
        for (const name of ['c-json', 'c-sse', 'c-err', 'c-big', 'c-flight', 'c-rate', 'c-budget', 'c-quota']) {
            await seedUser(db, { username: name, role: 'student' });
        }
        await seedUser(db, { username: 'c-admin', role: 'admin' });
        await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (2, 'c-two', 'Two', 0)`);
        await seedUser(db, { username: 'c-admin2', role: 'admin', tenantId: 2 });
    });
    await setSettings({
        llm_enabled: 'true', llm_provider: 'lmstudio', llm_base_url: stub.baseUrl,
        llm_model: 'stub-model', llm_max_output_tokens: '500',
    });
    for (const name of ['c-json', 'c-sse', 'c-err', 'c-big', 'c-flight', 'c-rate', 'c-budget', 'c-quota', 'c-admin', 'c-admin2']) {
        users[name] = await asUser(server.baseUrl, name);
    }
}, 120_000);

afterAll(async () => {
    if (server) await server.close();
    if (stub) await stub.close();
});

describe('reply shape (F-22)', () => {
    // Regression lock: the non-streamed reply carried reasoning_content, <think> and provider extras (F-22)
    it('returns only { choices:[{ message:{role,content}, finish_reason }], usage, model }', async () => {
        stub.state.mode = 'reasoning';
        const sid = await newSession(users['c-json']);
        const res = await ask(users['c-json'], sid);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
            choices: [{ message: { role: 'assistant', content: 'My chest hurts.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
            model: 'stub-model',
        });
        expect(JSON.stringify(body)).not.toMatch(/STEMI|reasoning|fp_secret/);
    });
});

describe('streamed replies (L3-02, F-22)', () => {
    // Regression lock: streams never asked for usage and were recorded as 0 tokens (L3-02)
    it('asks for include_usage, strips think blocks, and never records 0 tokens', async () => {
        stub.state.mode = 'sse';
        const sid = await newSession(users['c-sse']);
        const res = await ask(users['c-sse'], sid, { stream: true });
        expect(res.status).toBe(200);
        const text = await res.text();
        const deltas = text.split('\n\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)));
        expect(deltas.filter((d) => d.delta).map((d) => d.delta).join('')).toBe('Hello there.');
        expect(text).not.toContain('secret plan');
        const done = deltas.find((d) => d.done);
        expect(done.usage.total_tokens).toBeGreaterThan(0);
        expect(stub.state.bodies.at(-1).stream_options).toEqual({ include_usage: true });

        const row = await dbDo((db) => get(db, `SELECT u.total_tokens, u.tenant_id FROM llm_usage u JOIN users x ON x.id = u.user_id WHERE x.username = 'c-sse'`));
        expect(row.total_tokens).toBeGreaterThan(0);
    });
});

describe('upstream bodies and errors (L3-07, L3 info)', () => {
    // Regression lock: a 3 MB upstream JSON body was read whole (L3-07)
    it('refuses an upstream body over the cap with 502', async () => {
        stub.state.mode = 'big';
        const sid = await newSession(users['c-big']);
        const res = await ask(users['c-big'], sid);
        expect(res.status).toBe(502);
        expect((await res.json()).code).toBe('upstream_too_large');
    });

    // Regression lock: the provider's error text (which can echo a key) reached learners (L3 info)
    it('shows a learner a generic upstream error and an admin the provider message', async () => {
        stub.state.mode = '401';
        const sid = await newSession(users['c-err']);
        const learner = await ask(users['c-err'], sid);
        expect(learner.status).toBe(401);
        const lbody = await learner.json();
        expect(JSON.stringify(lbody)).not.toContain('sk-');
        expect(lbody.code).toBe('upstream_error');
        const asid = await newSession(users['c-admin']);
        const admin = await ask(users['c-admin'], asid);
        expect((await admin.json()).error).toContain('Incorrect API key');
    });
});

describe('rate and concurrency (F-06)', () => {
    // Regression lock: one account could hold any number of concurrent LLM requests (F-06)
    it('answers 429 to a fourth concurrent request from one user', async () => {
        stub.state.mode = 'json';
        stub.state.delayMs = 1500;
        const sid = await newSession(users['c-flight']);
        try {
            const statuses = await Promise.all([0, 1, 2, 3].map(() => ask(users['c-flight'], sid).then(async (r) => ({ status: r.status, body: await r.json() }))));
            expect(statuses.filter((s) => s.status === 200)).toHaveLength(3);
            const refused = statuses.filter((s) => s.status === 429);
            expect(refused).toHaveLength(1);
            expect(refused[0].body.code).toBe('RATE_LIMITED');
        } finally {
            stub.state.delayMs = 0;
        }
    });

    // Regression lock: /proxy/llm skipped every rate limiter (F-06)
    it('limits requests per user per minute (ROHY_LLM_RATE_PER_MIN=8 here)', async () => {
        stub.state.mode = 'json';
        const sid = await newSession(users['c-rate']);
        const statuses = [];
        for (let i = 0; i < 9; i += 1) statuses.push((await ask(users['c-rate'], sid)).status);
        expect(statuses.slice(0, 8).every((s) => s === 200)).toBe(true);
        expect(statuses[8]).toBe(429);
        // Another user is not affected.
        const other = await newSession(users['c-quota']);
        expect((await ask(users['c-quota'], other)).status).toBe(200);
    });
});

describe('budgets reserved at check time (F-06)', () => {
    // Regression lock: two parallel requests both passed a budget only one fitted under (F-06)
    it('lets only one of two concurrent requests through a budget that fits one', async () => {
        const sid = await newSession(users['c-budget']);
        // The reservation is the input (assembled prompt + messages, ~4 chars
        // a token) plus the output cap (500 here). Read the prompt the proxy
        // will send and set the budget to 1.5 reservations.
        const inspect = await users['c-admin'](`/api/sessions/${sid}/patient-prompt`);
        expect(inspect.status).toBe(200);
        const { chars } = await inspect.json();
        const estimate = Math.ceil((chars + 'hello'.length) / 4) + 500;
        await setSettings({ 'budget.llm.user.daily_tokens': Math.floor(estimate * 1.5) });
        stub.state.mode = 'json';
        stub.state.delayMs = 800;
        try {
            const results = await Promise.all([ask(users['c-budget'], sid), ask(users['c-budget'], sid)]
                .map((p) => p.then(async (r) => ({ status: r.status, body: await r.json() }))));
            expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
            expect(results.find((r) => r.status === 429).body.budget_exceeded).toBe(true);
        } finally {
            stub.state.delayMs = 0;
            await setSettings({ 'budget.llm.user.daily_tokens': '1000000' });
        }
        // The winner's reservation was settled to the real usage (4 tokens), so
        // the budget is free again for a request that fits.
        expect((await ask(users['c-budget'], sid)).status).toBe(200);
    });

    // Regression lock: the daily token limit compared recorded usage only, after the fact (F-06)
    it('reserves against the daily per-user token limit too', async () => {
        const sid = await newSession(users['c-quota']);
        await setSettings({ rate_limit_tokens_per_user_daily: '10' });
        try {
            const res = await ask(users['c-quota'], sid);
            expect(res.status).toBe(429);
            expect((await res.json()).error).toBe('Daily token limit exceeded');
            const logged = await dbDo((db) => get(db, `SELECT status, error_message FROM llm_request_log WHERE session_id = ? ORDER BY id DESC LIMIT 1`, [sid]));
            expect(logged).toEqual({ status: 'rate_limited', error_message: 'User daily token limit exceeded' });
        } finally {
            await setSettings({ rate_limit_tokens_per_user_daily: '0' });
        }
    });
});

describe('tenant stamping and tenant-scoped views (F-18, L3-08, L3-09)', () => {
    // Regression lock: llm_usage rows were all tenant 1 (F-18)
    it('stamps llm_usage with the requester\'s tenant', async () => {
        // A tenant-2 copy of case 1, so a tenant-2 user has a session to talk in.
        const caseId = await dbDo(async (db) => {
            const cols = (await all(db, 'PRAGMA table_info(cases)')).map((c) => c.name).filter((n) => n !== 'id');
            const list = cols.map((c) => `"${c}"`).join(', ');
            const select = cols.map((c) => {
                if (c === 'tenant_id') return '2';
                if (c === 'case_code') return 'NULL';
                return `"${c}"`;
            }).join(', ');
            return (await run(db, `INSERT INTO cases (${list}) SELECT ${select} FROM cases WHERE id = 1`)).lastID;
        });
        stub.state.mode = 'json';
        const created = await users['c-admin2']('/api/sessions', { method: 'POST', json: { case_id: caseId, student_name: 'T2' } });
        expect(created.status, await created.clone().text()).toBeLessThan(300);
        const sid = (await created.json()).id;
        expect((await ask(users['c-admin2'], sid)).status).toBe(200);
        const row = await dbDo((db) => get(db, `SELECT u.tenant_id FROM llm_usage u JOIN users x ON x.id = u.user_id WHERE x.username = 'c-admin2'`));
        expect(row.tenant_id).toBe(2);
        await dbDo(async (db) => {
            const u = await get(db, `SELECT id FROM users WHERE username = 'c-admin2'`);
            const today = new Date().toISOString().slice(0, 10);
            await run(db, `UPDATE llm_usage SET total_tokens = 777 WHERE user_id = ? AND date = ?`, [u.id, today]);
            await run(db, `INSERT INTO tts_usage (user_id, tenant_id, date, provider, char_count, request_count) VALUES (?, 2, ?, 'kokoro', 55, 1)`, [u.id, today]);
        });
    });

    // Regression lock: every tenant admin read the install's usage totals (L3-08)
    it('gives a tenant admin their own tenant\'s totals and a platform admin the install\'s', async () => {
        const t2 = await (await users['c-admin2']('/api/llm/usage/platform')).json();
        expect(t2.scope).toBe('tenant');
        expect(t2.tokensUsed).toBe(777);
        const all = await (await users['c-admin']('/api/llm/usage/platform')).json();
        expect(all.scope).toBe('install');
        expect(all.tokensUsed).toBeGreaterThan(777);

        const tts2 = await (await users['c-admin2']('/api/tts/usage?scope=all')).json();
        expect(tts2.tenant_only).toBe(true);
        expect(tts2.today).toEqual([expect.objectContaining({ provider: 'kokoro', chars: 55 })]);
    });

    // Regression lock: a tenant admin could rewrite the install-wide pricing table (F-02 / L3-09)
    it('lets only a platform admin change model pricing', async () => {
        const body = { provider: 'lmstudio', model: 'stub-model', inputCostPer1k: 0, outputCostPer1k: 0 };
        const tenantAdmin = await users['c-admin2']('/api/llm/pricing', { method: 'PUT', json: body });
        expect(tenantAdmin.status).toBe(403);
        expect((await tenantAdmin.json()).code).toBe('platform_admin_required');
        expect((await users['c-admin']('/api/llm/pricing', { method: 'PUT', json: body })).status).toBe(200);
    });

    it('shows the limits the proxy enforces: unset is 0 (no limit), not a made-up default (F-24)', async () => {
        const mine = await (await users['c-json']('/api/llm/usage')).json();
        expect(mine.tokensLimit).toBe(0);
        expect(mine.costLimit).toBe(0);
    });
});
