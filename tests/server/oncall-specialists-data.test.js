// On-call specialists, Phase 1: the data layer.
//
// - migration 0061 adds the call channel to agent_conversations and agent
//   attribution to llm_request_log;
// - server/db.js seeds exactly one default template per specialty, carrying
//   the registry's default disclosure;
// - add-defaults does not attach specialists, a case holds at most one per
//   specialty, and a per-case disclosure override is validated;
// - the LLM proxy records which agent a request spoke as.
//
// Regression lock: add-defaults attached EVERY is_default=1 template, so
// shipping specialist templates without the exclusion would have put all
// three on every case that clicked "add defaults".

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { createTestDb } from '../utils/seedDb.js';
import { startTestServer } from '../utils/startTestServer.js';
import { SPECIALTIES, SPECIALIST_TYPES } from '../../server/shared/specialties.js';

// ---------------------------------------------------------------------------
// In-process: migrations + seeding through the real server/db.js boot path
// ---------------------------------------------------------------------------

let testDb;
let dbModule;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'oncall-data' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'oncall-data-tests';
    dbModule = await import('../../server/db.js');
    await dbModule.dbReady;
}, 60_000);

afterAll(async () => {
    await testDb?.cleanup();
});

const columnsOf = async (table) =>
    Object.fromEntries((await testDb.all(`PRAGMA table_info(${table})`)).map((c) => [c.name, c]));

describe('migration 0061', () => {
    it('adds channel, call_id and case_agent_id to agent_conversations', async () => {
        const cols = await columnsOf('agent_conversations');
        expect(cols.channel.type).toBe('TEXT');
        expect(cols.channel.notnull).toBe(1);
        expect(cols.channel.dflt_value).toBe("'chat'");
        expect(cols.call_id.type).toBe('TEXT');
        expect(cols.call_id.notnull).toBe(0);
        expect(cols.case_agent_id.type).toBe('INTEGER');
        expect(cols.case_agent_id.notnull).toBe(0);
    });

    it('defaults channel to chat for a row inserted without it', async () => {
        const session = await testDb.run(
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (NULL, NULL, 'x', 'active', 1)`,
        );
        const row = await testDb.run(
            `INSERT INTO agent_conversations (session_id, agent_type, role, content) VALUES (?, 'nurse', 'user', 'hi')`,
            [session.lastID],
        );
        const stored = await testDb.get(
            'SELECT channel, call_id, case_agent_id FROM agent_conversations WHERE id = ?', [row.lastID],
        );
        expect(stored).toEqual({ channel: 'chat', call_id: null, case_agent_id: null });
    });

    it('indexes calls by tenant, session and call id, only where a call id exists', async () => {
        const index = await testDb.get(
            `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_conv_tenant_session_call'`,
        );
        expect(index?.sql).toMatch(/\(tenant_id, session_id, call_id\)/);
        expect(index.sql).toMatch(/WHERE call_id IS NOT NULL/);
    });

    it('adds agent_type and case_agent_id to llm_request_log, keeping the one tenant_id from 0004', async () => {
        const info = await testDb.all('PRAGMA table_info(llm_request_log)');
        const cols = Object.fromEntries(info.map((c) => [c.name, c]));
        expect(cols.agent_type.type).toBe('TEXT');
        expect(cols.agent_type.notnull).toBe(0);
        expect(cols.case_agent_id.type).toBe('INTEGER');
        expect(cols.case_agent_id.notnull).toBe(0);
        expect(info.filter((c) => c.name === 'tenant_id')).toHaveLength(1);
    });
});

describe('default specialist templates', () => {
    const specialistRows = () => testDb.all(
        `SELECT agent_type, name, role_title, avatar_url, config, system_prompt, context_filter FROM agent_templates
          WHERE is_default = 1 AND deleted_at IS NULL
            AND agent_type IN (${SPECIALIST_TYPES.map(() => '?').join(', ')})
          ORDER BY agent_type`,
        [...SPECIALIST_TYPES],
    );

    it('seeds exactly one per specialty with the registry default disclosure', async () => {
        const rows = await specialistRows();
        expect(rows.map((r) => r.agent_type)).toEqual([...SPECIALIST_TYPES].sort());
        for (const row of rows) {
            const config = JSON.parse(row.config);
            expect(config.specialty).toBe(row.agent_type);
            expect(config.disclosure).toEqual(SPECIALTIES[row.agent_type].defaultDisclosure);
            expect(config.typical_availability).toBe('on-call');
            expect(config.can_be_paged).toBe(true);
            expect(row.context_filter).toBe('full');
        }
    });

    it('ships a conduct-only prompt that confines the specialist to its brief', async () => {
        for (const row of await specialistRows()) {
            expect(row.system_prompt, row.agent_type).toMatch(/only discuss findings given to you in the case brief/i);
            expect(row.system_prompt, row.agent_type).toMatch(/never state the diagnosis/i);
        }
    });

    // The specialist is a room expert, not a consultant on the case: it read
    // one room's material and never met the patient. The prompt has to say so
    // itself — the server brief repeats it, but an educator duplicating a
    // template to author their own keeps only the prompt.
    it('tells every specialist it has not seen the patient and knows no symptoms', async () => {
        for (const row of await specialistRows()) {
            expect(row.system_prompt, row.agent_type).toMatch(/you have not seen the patient/i);
            expect(row.system_prompt, row.agent_type).toMatch(/do not know their symptoms/i);
            // 'consultant' is the word for the wrong mental model, and it
            // shipped in all three original prompts ("on-call consultant
            // pathologist"). A specialist must not describe itself as one.
            expect(row.system_prompt, row.agent_type).not.toMatch(/consultant/i);
            expect(row.role_title, row.agent_type).not.toMatch(/consultant/i);
        }
    });

    // Every seeded avatar must be a file that actually ships, or the contact
    // row and the 3D head both 404 silently. (A first draft of the laboratory
    // template named rb_business_female_04.glb, which does not exist.)
    it('points every specialist at an avatar that exists in public/avatars', async () => {
        const heads = path.join(process.cwd(), 'public', 'avatars', 'heads');
        for (const row of await specialistRows()) {
            expect(row.avatar_url, row.agent_type).toMatch(/\.glb$/);
            expect(fs.existsSync(path.join(heads, row.avatar_url)), `${row.agent_type} -> ${row.avatar_url}`).toBe(true);
        }
    });

    it('does not duplicate them when the seeders run again', async () => {
        await dbModule.seedDbDefaults();
        const rows = await specialistRows();
        expect(rows).toHaveLength(SPECIALIST_TYPES.length);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// Live server: routes and proxy attribution
// ---------------------------------------------------------------------------

const PASSWORD = 'OncallData1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
}

function startRecordingLlm() {
    const bodies = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            bodies.push(JSON.parse(raw || '{}'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                baseUrl: `http://127.0.0.1:${port}/v1`,
                bodies,
                close: () => new Promise((r) => server.close(r)),
            });
        });
    });
}

let server;
let llm;
let educatorToken;
let studentToken;
let studentId;
let templateIdByType;

async function login(username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

const sendAs = (token, method, path, body) =>
    fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

async function withDb(work) {
    const db = await openDb(server.dbPath);
    try { return await work(db); } finally { await closeDb(db); }
}

const newCase = (name) => withDb(async (db) => (await pRun(db,
    `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
     VALUES (?, 'desc', 'case-prompt', '{}', 1)`, [name])).lastID);

const caseAgentTypes = (caseId) => withDb(async (db) => (await pAll(db,
    `SELECT t.agent_type FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
      WHERE ca.case_id = ? ORDER BY t.agent_type`, [caseId])).map((r) => r.agent_type));

beforeAll(async () => {
    llm = await startRecordingLlm();
    server = await startTestServer();
    await withDb(async (db) => {
        const hash = await bcrypt.hash(PASSWORD, 4);
        await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('oncall-educator', 'E', 'oncall-educator@example.com', ?, 'educator', 1, 'active')`, [hash]);
        studentId = (await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('oncall-student', 'S', 'oncall-student@example.com', ?, 'student', 1, 'active')`, [hash])).lastID;
        await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`,
        [llm.baseUrl]);
        const defaults = await pAll(db,
            `SELECT id, agent_type, name FROM agent_templates WHERE is_default = 1 AND tenant_id = 1 AND deleted_at IS NULL`);
        templateIdByType = Object.fromEntries(defaults.map((t) => [t.agent_type, t.id]));
    });
    educatorToken = await login('oncall-educator');
    studentToken = await login('oncall-student');
}, 90_000);

afterAll(async () => {
    if (server) await server.close();
    if (llm) await llm.close();
});

describe('POST /cases/:caseId/agents/add-defaults', () => {
    // Regression lock: specialists must not ride along with the default team.
    it('attaches the default team but none of the specialists', async () => {
        // Not vacuous: the specialists must exist as tenant-1 defaults in THIS
        // server's database, or add-defaults could not have attached them.
        for (const type of SPECIALIST_TYPES) {
            expect(Number.isInteger(templateIdByType[type]), type).toBe(true);
        }
        const caseId = await newCase('Add defaults case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents/add-defaults`);
        expect(res.status).toBe(200);
        const types = await caseAgentTypes(caseId);
        expect(types).toContain('nurse');
        expect(types).toContain('consultant');
        for (const type of SPECIALIST_TYPES) {
            expect(types, type).not.toContain(type);
        }
    });
});

describe('POST /cases/:caseId/agents with a specialist', () => {
    it('attaches one specialist per specialty and refuses a second with 409', async () => {
        const caseId = await newCase('One pathologist case');
        const first = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.pathologist, availability_type: 'on-call',
        });
        expect(first.status).toBe(201);

        const second = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.pathologist, availability_type: 'on-call',
        });
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('specialty_already_attached');
        expect(await caseAgentTypes(caseId)).toEqual(['pathologist']);
    });

    it('counts a disabled specialist as attached', async () => {
        const caseId = await newCase('Disabled radiologist case');
        const first = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.radiologist, enabled: false,
        });
        expect(first.status).toBe(201);
        const second = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.radiologist,
        });
        expect(second.status).toBe(409);
    });

    it('allows different specialties, and repeated non-specialist agents, on one case', async () => {
        const caseId = await newCase('Mixed team case');
        for (const templateId of [templateIdByType.pathologist, templateIdByType.cardiologist,
            templateIdByType.nurse, templateIdByType.nurse]) {
            const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, { agent_template_id: templateId });
            expect(res.status).toBe(201);
        }
        expect(await caseAgentTypes(caseId)).toEqual(['cardiologist', 'nurse', 'nurse', 'pathologist']);
    });

    it('refuses an invalid disclosure with 400 invalid_disclosure and stores nothing', async () => {
        const caseId = await newCase('Bad disclosure case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.cardiologist,
            config_override: { disclosure: { minStudentTurns: -1 } },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('invalid_disclosure');
        expect(await caseAgentTypes(caseId)).toEqual([]);
    });

    it('accepts a valid partial disclosure and stores it as sent', async () => {
        const caseId = await newCase('Good disclosure case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.cardiologist,
            config_override: { disclosure: { findings: 'on_request' } },
        });
        expect(res.status).toBe(201);
        const { id } = await res.json();
        const stored = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [id]));
        expect(JSON.parse(stored[0].config_override)).toEqual({ disclosure: { findings: 'on_request' } });
    });
});

describe('PUT /cases/:caseId/agents/:agentId disclosure', () => {
    let caseId;
    let agentId;

    beforeAll(async () => {
        caseId = await newCase('PUT disclosure case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.radiologist,
        });
        expect(res.status).toBe(201);
        agentId = (await res.json()).id;
        expect(Number.isInteger(agentId)).toBe(true);
    });

    it('refuses a bad mode with 400 invalid_disclosure', async () => {
        const res = await sendAs(educatorToken, 'PUT', `/api/cases/${caseId}/agents/${agentId}`, {
            config_override: { disclosure: { findings: 'always' } },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('invalid_disclosure');
    });

    it('accepts a valid partial disclosure', async () => {
        const res = await sendAs(educatorToken, 'PUT', `/api/cases/${caseId}/agents/${agentId}`, {
            config_override: { disclosure: { findings: 'never', requireRoomActivity: false } },
        });
        expect(res.status).toBe(200);
        const stored = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [agentId]));
        expect(JSON.parse(stored[0].config_override).disclosure).toEqual({ findings: 'never', requireRoomActivity: false });
    });

    // Regression lock: PUT validated the body before checking the agent
    // existed, so a caller probing another case's agent id got a 400 that
    // described the body instead of a 404.
    it('404s an unknown case agent before looking at the body', async () => {
        const res = await sendAs(educatorToken, 'PUT', `/api/cases/${caseId}/agents/99999999`, {
            config_override: 'not an object',
        });
        expect(res.status).toBe(404);
    });

    // Regression lock: a non-object config_override skipped disclosureErrors
    // (it only inspects objects) and was stored as-is.
    it('refuses a config_override that is not a plain object and leaves the stored value alone', async () => {
        const before = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [agentId]));
        for (const bad of ['{"disclosure":{"findings":"always"}}', [{ disclosure: { findings: 'always' } }], 7, true]) {
            const res = await sendAs(educatorToken, 'PUT', `/api/cases/${caseId}/agents/${agentId}`, {
                config_override: bad,
            });
            expect(res.status, JSON.stringify(bad)).toBe(400);
            expect((await res.json()).code).toBe('invalid_config_override');
        }
        const after = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [agentId]));
        expect(after).toEqual(before);
    });

    it('still accepts null to clear the override', async () => {
        const nurseCase = await newCase('Null override case');
        const created = await sendAs(educatorToken, 'POST', `/api/cases/${nurseCase}/agents`, {
            agent_template_id: templateIdByType.nurse, config_override: { tone: 'calm' },
        });
        expect(created.status).toBe(201);
        const { id } = await created.json();
        const res = await sendAs(educatorToken, 'PUT', `/api/cases/${nurseCase}/agents/${id}`, { config_override: null });
        expect(res.status).toBe(200);
        const stored = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [id]));
        expect(stored[0].config_override).toBeNull();
    });

    // Regression lock: a disclosure block was accepted on any agent type.
    it('refuses a disclosure block on a non-specialist with 400 disclosure_not_applicable', async () => {
        const nurseCase = await newCase('Nurse disclosure PUT case');
        const created = await sendAs(educatorToken, 'POST', `/api/cases/${nurseCase}/agents`, {
            agent_template_id: templateIdByType.nurse,
        });
        expect(created.status).toBe(201);
        const { id } = await created.json();
        const res = await sendAs(educatorToken, 'PUT', `/api/cases/${nurseCase}/agents/${id}`, {
            config_override: { disclosure: { findings: 'on_request' } },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('disclosure_not_applicable');
        const stored = await withDb((db) => pAll(db, 'SELECT config_override FROM case_agents WHERE id = ?', [id]));
        expect(stored[0].config_override).toBeNull();
    });
});

describe('POST /cases/:caseId/agents config_override validation', () => {
    // Regression lock: same two bypasses as PUT, on attach.
    it('refuses a non-object config_override with 400 invalid_config_override and stores nothing', async () => {
        const caseId = await newCase('Bad override shape case');
        for (const bad of ['{"disclosure":{}}', [1], 3]) {
            const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
                agent_template_id: templateIdByType.cardiologist, config_override: bad,
            });
            expect(res.status, JSON.stringify(bad)).toBe(400);
            expect((await res.json()).code).toBe('invalid_config_override');
        }
        expect(await caseAgentTypes(caseId)).toEqual([]);
    });

    it('refuses a disclosure block on a non-specialist with 400 disclosure_not_applicable and stores nothing', async () => {
        const caseId = await newCase('Nurse disclosure POST case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.nurse,
            config_override: { disclosure: { findings: 'on_request' } },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('disclosure_not_applicable');
        expect(await caseAgentTypes(caseId)).toEqual([]);
    });
});

describe('PUT /agents/templates/:id retype while attached', () => {
    const createTemplate = async (agentType, name) => {
        const res = await sendAs(educatorToken, 'POST', '/api/agents/templates', {
            agent_type: agentType, name, system_prompt: `${name} prompt`,
        });
        expect(res.status).toBe(201);
        const { id } = await res.json();
        expect(Number.isInteger(id)).toBe(true);
        return id;
    };
    const storedType = (id) => withDb(async (db) => (await pAll(db,
        'SELECT agent_type FROM agent_templates WHERE id = ?', [id]))[0].agent_type);
    const attachTo = async (templateId, name) => {
        const caseId = await newCase(name);
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, { agent_template_id: templateId });
        expect(res.status).toBe(201);
        return caseId;
    };

    // Regression lock: attach a nurse template twice to one case, retype it to
    // pathologist, and the case had two pathologists — the one-per-specialty
    // guard only runs on attach.
    it('refuses retyping an attached template INTO a specialty with 409', async () => {
        const id = await createTemplate('nurse', 'Retype nurse attached');
        const caseId = await attachTo(id, 'Retype into specialty case');
        const second = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, { agent_template_id: id });
        expect(second.status).toBe(201);

        const res = await sendAs(educatorToken, 'PUT', `/api/agents/templates/${id}`, { agent_type: 'pathologist' });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('specialty_retype_attached');
        expect(await storedType(id)).toBe('nurse');
    });

    it('refuses retyping an attached specialist OUT of its specialty with 409', async () => {
        const id = await createTemplate('radiologist', 'Retype radiologist attached');
        await attachTo(id, 'Retype out of specialty case');
        const res = await sendAs(educatorToken, 'PUT', `/api/agents/templates/${id}`, { agent_type: 'nurse' });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('specialty_retype_attached');
        expect(await storedType(id)).toBe('radiologist');
    });

    it('still retypes an unattached template, and a non-specialist retype of an attached one', async () => {
        const loose = await createTemplate('nurse', 'Retype nurse loose');
        const looseRes = await sendAs(educatorToken, 'PUT', `/api/agents/templates/${loose}`, { agent_type: 'cardiologist' });
        expect(looseRes.status).toBe(200);
        expect(await storedType(loose)).toBe('cardiologist');

        const attached = await createTemplate('nurse', 'Retype nurse to relative');
        await attachTo(attached, 'Non-specialist retype case');
        const plainRes = await sendAs(educatorToken, 'PUT', `/api/agents/templates/${attached}`, { agent_type: 'relative' });
        expect(plainRes.status).toBe(200);
        expect(await storedType(attached)).toBe('relative');
    });
});

describe('POST /proxy/llm attribution in llm_request_log', () => {
    let sessionId;
    let pathologistAgentId;

    beforeAll(async () => {
        const caseId = await newCase('Proxy attribution case');
        const res = await sendAs(educatorToken, 'POST', `/api/cases/${caseId}/agents`, {
            agent_template_id: templateIdByType.pathologist, availability_type: 'on-call',
        });
        pathologistAgentId = (await res.json()).id;
        sessionId = await withDb(async (db) => (await pRun(db,
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id)
             VALUES (?, ?, 'Oncall Student', 'active', 1)`, [caseId, studentId])).lastID);
    });

    // The insert is fire-and-forget after the response; poll for the row.
    async function waitForLogRows(count) {
        const deadline = Date.now() + 5_000;
        let rows = [];
        while (Date.now() < deadline) {
            rows = await withDb((db) => pAll(db,
                `SELECT tenant_id, agent_type, case_agent_id, status FROM llm_request_log
                  WHERE session_id = ? ORDER BY id`, [sessionId]));
            if (rows.length >= count) return rows;
            await new Promise((r) => setTimeout(r, 50));
        }
        return rows;
    }

    it('records the agent type and case agent a specialist request spoke as', async () => {
        const res = await sendAs(studentToken, 'POST', '/api/proxy/llm', {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'What should I look for on this slide?' }],
            system_prompt: 'situation',
            agent_llm_config: { case_agent_id: pathologistAgentId },
        });
        expect(res.status).toBe(200);
        const rows = await waitForLogRows(1);
        expect(rows[0]).toEqual({
            tenant_id: 1, agent_type: 'pathologist', case_agent_id: pathologistAgentId, status: 'success',
        });
    });

    it('leaves the agent columns NULL for a request that names no agent', async () => {
        const res = await sendAs(studentToken, 'POST', '/api/proxy/llm', {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hello' }],
            system_prompt: 'You are the patient.',
        });
        expect(res.status).toBe(200);
        const rows = await waitForLogRows(2);
        expect(rows[1]).toEqual({ tenant_id: 1, agent_type: null, case_agent_id: null, status: 'success' });
    });

    it('records the agent type, and no case agent, for a request named by agent_template_id', async () => {
        expect(Number.isInteger(templateIdByType.patient)).toBe(true);
        const res = await sendAs(studentToken, 'POST', '/api/proxy/llm', {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hello again' }],
            system_prompt: 'You are the patient.',
            agent_llm_config: { agent_template_id: templateIdByType.patient },
        });
        expect(res.status).toBe(200);
        const rows = await waitForLogRows(3);
        expect(rows).toHaveLength(3);
        expect(rows[2]).toEqual({ tenant_id: 1, agent_type: 'patient', case_agent_id: null, status: 'success' });
    });
});
