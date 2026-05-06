// tests/server/case-agents-merge.test.js
//
// Phase 1, task 1.7 — server-side `GET /api/cases/:id/agents` config merge contract.
//
// Locks in the behaviour of the merge logic in `server/routes.js` for the
// route `GET /api/cases/:caseId/agents`. The handler currently does:
//
//     config: {
//         ...JSON.parse(a.template_config || '{}'),
//         ...JSON.parse(a.config_override || '{}')
//     }
//
// CONTRACT (observed in routes.js around line 10374-10378):
//   - Override JSON column is parsed from TEXT.
//   - Merge is SHALLOW (top-level spread). An override on a nested key
//     (e.g. `voice`) REPLACES the entire template `voice` object — it does
//     NOT merge nested siblings.
//   - When `config_override` is NULL or falsy the spread of `{}` leaves the
//     template intact. An empty object `{}` likewise leaves the template
//     intact.
//
// Why spawned server (not in-process app):
//   `server/server.js` + `server/db.js` initialise a singleton sqlite3
//   connection at import time. The shared helper `startTestServer.js`
//   already spawns the real boot path against a throwaway DB file, which
//   is the same path the audit scripts use. We follow that pattern so what
//   we test is what we ship — and so we avoid module-cache surgery to swap
//   the singleton.
//
// Seeding strategy:
//   `startTestServer({ seed:false })` returns `dbPath`. We open our own
//   sqlite3 connection to that same file and INSERT the rows we need
//   (tenants, users with real bcrypt hashes, agent_templates, cases,
//   case_agents) before exercising the HTTP API. The spawned server reads
//   the same file, so the inserts are visible.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

// ---------------------------------------------------------------------------
// sqlite3 promise wrappers (mirrors helpers in tests/utils/seedDb.js — kept
// local so this file is self-contained and doesn't reach into another helper
// owned by parallel agents).
// ---------------------------------------------------------------------------

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}

function closeDb(db) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        db.close(() => resolve());
    });
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ADMIN_USERNAME = 'merge-admin';
const ADMIN_PASSWORD = 'merge-admin-pw-1';

const TEMPLATE_CONFIG = {
    system_prompt: 'TEMPLATE-PROMPT',
    voice: { tts_pitch: 0, tts_rate: 1.0 },
    persona: { tone: 'calm' }
};

// Three case_agent rows, each with a different override shape:
//   1. NULL override          -> equals template
//   2. {} empty override      -> equals template
//   3. real top-level override -> shallow-merged onto template
//   4. nested override        -> replaces the entire `voice` sub-object
const OVERRIDE_NULL = null;
const OVERRIDE_EMPTY = {};
const OVERRIDE_REAL = { system_prompt: 'OVERRIDE-PROMPT' };
const OVERRIDE_NESTED = { voice: { tts_pitch: 5 } };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GET /api/cases/:caseId/agents — config merge contract', () => {
    let server;
    let token;
    let caseId;
    // Captured for debugging if a test fails — not asserted on directly.
    // Prefix with underscore so the lint rule allows the unread binding.
    let _caseAgentIds = {}; // { nullOv, emptyOv, realOv, nestedOv } -> case_agent.id

    // Cross-tenant fixtures. `_otherTenantCaseId` is captured for symmetry
    // with the tenant-1 case (and to keep the seed code readable) but the
    // current test only needs the tenant-1 caseId for the cross-tenant call.
    let _otherTenantCaseId;
    let otherTenantToken;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });

        // Seed everything we need directly into the spawned server's DB file.
        const db = await openDb(server.dbPath);
        try {
            // Migrations created tenant_id=1 ('default'). Add a second
            // tenant for the cross-tenant test.
            await pRun(
                db,
                `INSERT OR IGNORE INTO tenants (id, slug, name, is_default)
                 VALUES (2, 'other', 'Other Tenant', 0)`
            );

            // Admin user in tenant 1 with a real bcrypt hash so /auth/login works.
            const hash = await bcrypt.hash(ADMIN_PASSWORD, 4);
            const adminInsert = await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
                [ADMIN_USERNAME, 'Merge Admin', 'merge-admin@example.com', hash]
            );
            expect(adminInsert.lastID).toBeGreaterThan(0);

            // A second user, tenant 2, for cross-tenant scope check.
            const otherHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
            await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES (?, ?, ?, ?, 'admin', 2, 'active')`,
                ['merge-admin-t2', 'Merge Admin T2', 'merge-admin-t2@example.com', otherHash]
            );

            // Agent template (tenant 1).
            const tpl = await pRun(
                db,
                `INSERT INTO agent_templates
                    (agent_type, name, role_title, system_prompt, communication_style,
                     config, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [
                    'patient',
                    'Test Patient Template',
                    'Patient',
                    TEMPLATE_CONFIG.system_prompt,
                    'concise',
                    JSON.stringify(TEMPLATE_CONFIG)
                ]
            );
            const templateId = tpl.lastID;

            // Case (tenant 1).
            const caseRow = await pRun(
                db,
                `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
                 VALUES (?, ?, ?, ?, 1)`,
                ['Merge Test Case', 'desc', 'case-prompt', '{}']
            );
            caseId = caseRow.lastID;

            // Four case_agents rows, each pointing at the same template but
            // carrying a different `config_override` value. To distinguish
            // them in the response we vary `name_override` since the route
            // sets `name = name_override || template_name`.
            const insertAgent = (override, label) => pRun(
                db,
                `INSERT INTO case_agents
                    (case_id, agent_template_id, enabled,
                     name_override, system_prompt_override,
                     config_override, tenant_id)
                 VALUES (?, ?, 1, ?, NULL, ?, 1)`,
                [
                    caseId,
                    templateId,
                    label,
                    override === null ? null : JSON.stringify(override)
                ]
            );

            const r1 = await insertAgent(OVERRIDE_NULL, 'agent-null');
            const r2 = await insertAgent(OVERRIDE_EMPTY, 'agent-empty');
            const r3 = await insertAgent(OVERRIDE_REAL, 'agent-real');
            const r4 = await insertAgent(OVERRIDE_NESTED, 'agent-nested');
            _caseAgentIds = {
                nullOv: r1.lastID,
                emptyOv: r2.lastID,
                realOv: r3.lastID,
                nestedOv: r4.lastID
            };

            // Cross-tenant case (tenant 2). No agents needed — we only
            // assert that a tenant-1 caller cannot list its agents.
            const otherCase = await pRun(
                db,
                `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
                 VALUES (?, ?, ?, ?, 2)`,
                ['Other Tenant Case', 'desc', 'prompt', '{}']
            );
            _otherTenantCaseId = otherCase.lastID;
        } finally {
            await closeDb(db);
        }

        // Login as the tenant-1 admin to get a JWT.
        const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
        });
        expect(loginRes.status).toBe(200);
        const loginBody = await loginRes.json();
        token = loginBody.token;
        expect(typeof token).toBe('string');

        // Login as tenant-2 admin too, for the cross-tenant test.
        const loginRes2 = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'merge-admin-t2', password: ADMIN_PASSWORD })
        });
        expect(loginRes2.status).toBe(200);
        otherTenantToken = (await loginRes2.json()).token;
    }, 30_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    // -----------------------------------------------------------------------
    // Helper: fetch agents for the seeded case and return them keyed by name.
    // -----------------------------------------------------------------------
    async function fetchAgents(forCaseId = caseId, withToken = token) {
        const res = await fetch(`${server.baseUrl}/api/cases/${forCaseId}/agents`, {
            headers: withToken ? { authorization: `Bearer ${withToken}` } : {}
        });
        return { res, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
    }

    function findByName(agents, name) {
        const found = agents.find((a) => a.name === name);
        if (!found) {
            throw new Error(
                `agent named "${name}" not in response — got: ${agents.map((a) => a.name).join(', ')}`
            );
        }
        return found;
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    it('returns template config when override is null', async () => {
        const { res, body } = await fetchAgents();
        expect(res.status).toBe(200);
        const agent = findByName(body.agents, 'agent-null');
        expect(agent.config.system_prompt).toBe('TEMPLATE-PROMPT');
        expect(agent.config.voice).toEqual({ tts_pitch: 0, tts_rate: 1.0 });
        expect(agent.config.persona).toEqual({ tone: 'calm' });
        // Sanity: the route exposes `has_config_override` for editing UIs.
        expect(agent.has_config_override).toBe(false);
    });

    it('returns template config when override is empty object', async () => {
        const { res, body } = await fetchAgents();
        expect(res.status).toBe(200);
        const agent = findByName(body.agents, 'agent-empty');
        // Empty-object override spread leaves template untouched.
        expect(agent.config.system_prompt).toBe('TEMPLATE-PROMPT');
        expect(agent.config.voice).toEqual({ tts_pitch: 0, tts_rate: 1.0 });
        expect(agent.config.persona).toEqual({ tone: 'calm' });
        // CONTRACT: `has_config_override` is set from the truthiness of
        // the raw column. The string `'{}'` is truthy, so this flag is
        // `true` even though the merge result is identical to the template.
        // (Documents what the route actually does — not asserted as desired
        // behaviour, just locked.)
        expect(agent.has_config_override).toBe(true);
    });

    it('merges override on top of template (override wins for the touched key, siblings preserved)', async () => {
        const { res, body } = await fetchAgents();
        expect(res.status).toBe(200);
        const agent = findByName(body.agents, 'agent-real');
        // Override key wins.
        expect(agent.config.system_prompt).toBe('OVERRIDE-PROMPT');
        // Sibling top-level keys from the template are preserved.
        expect(agent.config.voice).toEqual({ tts_pitch: 0, tts_rate: 1.0 });
        expect(agent.config.persona).toEqual({ tone: 'calm' });
        expect(agent.has_config_override).toBe(true);
    });

    it('CONTRACT: merge is SHALLOW — a nested override REPLACES the whole sub-object', async () => {
        // Observed in server/routes.js (~L10374): `{ ...templateCfg, ...override }`.
        // That is a top-level spread, not a deep merge. So an override at
        // `voice.tts_pitch` clobbers the entire `voice: { tts_pitch, tts_rate }`
        // sub-object — `tts_rate` is GONE in the response, not preserved
        // from the template.
        const { res, body } = await fetchAgents();
        expect(res.status).toBe(200);
        const agent = findByName(body.agents, 'agent-nested');

        // The override's voice sub-object replaces the template's voice.
        expect(agent.config.voice).toEqual({ tts_pitch: 5 });
        // tts_rate from the template is NOT present — locks shallow merge.
        expect(agent.config.voice).not.toHaveProperty('tts_rate');

        // Other top-level template keys are still there (not touched by the override).
        expect(agent.config.system_prompt).toBe('TEMPLATE-PROMPT');
        expect(agent.config.persona).toEqual({ tone: 'calm' });
    });

    it('returns 200 + empty agents for unknown case_id (route does not 404)', async () => {
        // CONTRACT: the handler issues `SELECT ... WHERE ca.case_id = ?`
        // and unconditionally returns `{ agents: rows.map(...) }`. If no
        // case_agents rows match, the response is `{ agents: [] }` with
        // status 200 — there is no separate "case not found" check.
        // Locking that observed behaviour rather than the (perhaps more
        // intuitive) 404.
        const unknownId = 999_999;
        const { res, body } = await fetchAgents(unknownId);
        expect(res.status).toBe(200);
        expect(body).toEqual({ agents: [] });
    });

    it('returns 401 without auth token', async () => {
        const res = await fetch(`${server.baseUrl}/api/cases/${caseId}/agents`);
        expect(res.status).toBe(401);
    });

    it('CONTRACT: route is tenant-scoped — a tenant-2 caller sees no tenant-1 agents', async () => {
        // The handler joins case_agents/agent_templates filtered by
        // `ca.tenant_id = ? AND at.tenant_id = ?` where the tenant comes
        // from the JWT (`tenantId(req)` -> `req.user.tenant_id`). So the
        // route does NOT 403 a cross-tenant lookup; it simply returns an
        // empty list, because the caller's tenant_id never matches the
        // tenant-1 rows.
        //
        // We lock the no-leak contract: cross-tenant request must NOT
        // return any of the tenant-1 case_agents rows.
        const { res, body } = await fetchAgents(caseId, otherTenantToken);
        expect(res.status).toBe(200);
        expect(Array.isArray(body.agents)).toBe(true);
        expect(body.agents).toHaveLength(0);
    });
});
