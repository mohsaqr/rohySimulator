// Team-agent personas are built on the server (services/agentPersona.js).
//
// Regression lock: GET /sessions/:id/agents and GET /cases/:id/agents served
// every case agent's authored prompt to learners. The template library had
// already been closed (agent-templates-role-projection.test.js), but the
// per-case routes still sent the consultant's script — and the browser needed
// it, because it assembled the prompt itself. Now the client names the agent
// by `case_agent_id` and the server supplies the persona.
//
// The same change fixes a second defect: /sessions/:id/agents omitted both the
// case agent id and the template id, so `agent.agent_template_id || agent.id`
// was undefined and no team-agent request carried an agent at all. Per-agent
// LLM settings and the encounter record never applied to team agents.
//
// These tests fail against the un-fixed code: the first student read returns
// SECRET_CONSULTANT_PROMPT, and the proxy ignores `case_agent_id`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import {
    buildAgentPersonaPrompt,
    learnerMayHoldPrompt,
    CLIENT_BUILT_PROMPT_TYPES,
} from '../../server/services/agentPersona.js';

const PASSWORD = 'PersonaTests1!';
const SECRET_CONSULTANT_PROMPT = 'CONSULTANT-SCRIPT: the troponin is flat; this is not an NSTEMI.';
const OTHER_CASE_PROMPT = 'OTHER-CASE-CONSULTANT: you belong to a different case.';
const PATIENT_PROMPT = 'You are a 58-year-old man with crushing chest pain.';
const SITUATION = 'PATIENT: Case Patient\nHR: 90bpm';

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

// An OpenAI-compatible upstream that records every request body it receives.
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

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe('buildAgentPersonaPrompt', () => {
    it('leads with the role anchor, then the authored prompt, then the situation', () => {
        const out = buildAgentPersonaPrompt(
            { agentType: 'consultant', roleTitle: 'On-call cardiologist', name: 'Dr Haddad', prompt: 'AUTHORED' },
            SITUATION,
        );
        const anchor = out.indexOf('## ROLE');
        const authored = out.indexOf('AUTHORED');
        const header = out.indexOf('--- CURRENT SITUATION ---');
        const situation = out.indexOf('HR: 90bpm');
        expect(anchor).toBe(0);
        expect(authored).toBeGreaterThan(anchor);
        expect(header).toBeGreaterThan(authored);
        expect(situation).toBeGreaterThan(header);
        expect(out).toMatch(/You are: On-call cardiologist\./);
        expect(out).toMatch(/Your name: Dr Haddad\./);
    });

    it('omits the situation header when the client reported nothing', () => {
        for (const situation of ['', '   ', undefined, null, { not: 'text' }]) {
            const out = buildAgentPersonaPrompt({ agentType: 'nurse', prompt: 'AUTHORED' }, situation);
            expect(out).toContain('AUTHORED');
            expect(out).not.toContain('--- CURRENT SITUATION ---');
        }
    });

    it('falls back to the agent type when the template has no role title', () => {
        const out = buildAgentPersonaPrompt({ agentType: 'relative', prompt: '' });
        expect(out).toMatch(/You are: relative\./);
    });

    // Regression lock: config.dos / config.donts reached the prompt only on
    // the CLIENT assembly path (ChatInterface, useDiscussionEngine), so when
    // persona assembly moved to the server in v3.0.0-beta.83 every
    // server-built agent — nurse, consultant, relative, every on-call
    // specialist — silently stopped reading them. The persona editor went on
    // offering the controls for all of them.
    it('emits the authored dos and donts for a server-built agent', () => {
        const out = buildAgentPersonaPrompt({
            agentType: 'nurse',
            roleTitle: 'Bedside nurse',
            prompt: 'AUTHORED',
            config: { dos: ['Speak up if an order seems unsafe'], donts: ['Do the diagnostic work'] },
        });
        expect(out).toContain('You should:\n- Speak up if an order seems unsafe');
        expect(out).toContain('You must not:\n- Do the diagnostic work');
        expect(out.indexOf('You should:')).toBeGreaterThan(out.indexOf('AUTHORED'));
    });

    it('omits the block entirely when neither list is authored', () => {
        for (const config of [undefined, null, {}, { dos: [], donts: [] }, { dos: 42 }]) {
            const out = buildAgentPersonaPrompt({ agentType: 'nurse', prompt: 'AUTHORED', config });
            expect(out).not.toContain('You should:');
            expect(out).not.toContain('You must not:');
        }
    });

    // Not a malformed value: the persona editor saves these lists as one
    // bullet per LINE, so buildPersonaBlocks splits a string on newlines.
    // A config holding a string is an editor save, not a defect.
    it('splits a newline-separated string into bullets', () => {
        const out = buildAgentPersonaPrompt({
            agentType: 'nurse',
            prompt: 'AUTHORED',
            config: { dos: 'First bullet\n\n  Second bullet  \n' },
        });
        expect(out).toContain('You should:\n- First bullet\n- Second bullet');
    });

    // The brief is the last word on what may be disclosed: an educator must
    // not be able to author a "do" that argues with the disclosure gate and
    // have the model read it afterwards. Order is
    //   anchor -> persona -> dos/donts -> brief -> situation.
    it('places a specialist brief after the persona and its dos/donts', () => {
        const out = buildAgentPersonaPrompt(
            {
                agentType: 'pathologist',
                roleTitle: 'Pathologist',
                prompt: 'AUTHORED',
                config: { dos: ['DO-BULLET'], donts: ['DONT-BULLET'] },
            },
            SITUATION,
            '## CASE BRIEF (server)\nBRIEF-BODY',
        );
        const order = ['## ROLE', 'AUTHORED', 'DO-BULLET', 'DONT-BULLET', 'BRIEF-BODY', '--- CURRENT SITUATION ---']
            .map((needle) => out.indexOf(needle));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('omits the brief block when there is none', () => {
        for (const brief of ['', '   ', undefined, null, 42]) {
            const out = buildAgentPersonaPrompt({ agentType: 'nurse', prompt: 'AUTHORED' }, '', brief);
            expect(out.trimEnd().endsWith('AUTHORED')).toBe(true);
        }
    });
});

describe('learnerMayHoldPrompt', () => {
    it('is an allow list of exactly the client-built types', () => {
        expect([...CLIENT_BUILT_PROMPT_TYPES].sort()).toEqual(['discussant', 'patient']);
        expect(learnerMayHoldPrompt('patient')).toBe(true);
        expect(learnerMayHoldPrompt('discussant')).toBe(true);
    });

    it('withholds every other type, including ones that do not exist yet', () => {
        for (const type of ['consultant', 'nurse', 'relative', 'pathologist', '', null, undefined]) {
            expect(learnerMayHoldPrompt(type), String(type)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

let server;
let llm;
let studentToken;
let educatorToken;
let caseId;
let sessionId;
let consultantAgentId;
let disabledAgentId;
let otherCaseAgentId;
let otherStudentToken;
let deletedTemplateAgentId;
const DELETED_TEMPLATE_PROMPT = 'DELETED-RELATIVE: this template was soft-deleted.';

async function login(username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

const getAs = (token, path) =>
    fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

const proxyAs = (token, body) =>
    fetch(`${server.baseUrl}/api/proxy/llm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });

beforeAll(async () => {
    llm = await startRecordingLlm();
    server = await startTestServer();
    const db = await openDb(server.dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const student = await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('persona-student', 'S', 'persona-student@example.com', ?, 'student', 1, 'active')`, [hash]);
        await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('persona-educator', 'E', 'persona-educator@example.com', ?, 'educator', 1, 'active')`, [hash]);
        await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('persona-student-2', 'S2', 'persona-student-2@example.com', ?, 'student', 1, 'active')`, [hash]);

        await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`,
        [llm.baseUrl]);

        const addTemplate = async (type, name, roleTitle, prompt) => (await pRun(db,
            `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, config, tenant_id)
             VALUES (?, ?, ?, ?, '{}', 1)`, [type, name, roleTitle, prompt])).lastID;
        const addCase = async (name) => (await pRun(db,
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
             VALUES (?, 'desc', 'case-prompt', '{}', 1)`, [name])).lastID;
        const attach = async (onCase, templateId, enabled = 1) => (await pRun(db,
            `INSERT INTO case_agents (case_id, agent_template_id, enabled, availability_type, tenant_id)
             VALUES (?, ?, ?, 'on-call', 1)`, [onCase, templateId, enabled])).lastID;

        caseId = await addCase('Persona Case');
        const otherCaseId = await addCase('Other Case');
        const consultantTpl = await addTemplate('consultant', 'Dr Haddad', 'On-call cardiologist', SECRET_CONSULTANT_PROMPT);
        const patientTpl = await addTemplate('patient', 'Patient', 'Simulated Patient', PATIENT_PROMPT);
        const nurseTpl = await addTemplate('nurse', 'Nurse', 'Bedside nurse', 'nurse prompt');
        const otherTpl = await addTemplate('consultant', 'Dr Other', 'Consultant', OTHER_CASE_PROMPT);

        consultantAgentId = await attach(caseId, consultantTpl);
        await attach(caseId, patientTpl);
        disabledAgentId = await attach(caseId, nurseTpl, 0);
        otherCaseAgentId = await attach(otherCaseId, otherTpl);
        // A live attachment whose template was soft-deleted afterwards.
        const deletedTpl = await addTemplate('relative', 'Deleted Relative', 'Daughter', DELETED_TEMPLATE_PROMPT);
        deletedTemplateAgentId = await attach(caseId, deletedTpl);
        await pRun(db, `UPDATE agent_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [deletedTpl]);

        sessionId = (await pRun(db,
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id)
             VALUES (?, ?, 'Persona Student', 'active', 1)`, [caseId, student.lastID])).lastID;
    } finally {
        await closeDb(db);
    }
    studentToken = await login('persona-student');
    educatorToken = await login('persona-educator');
    otherStudentToken = await login('persona-student-2');
}, 90_000);

afterAll(async () => {
    if (server) await server.close();
    if (llm) await llm.close();
});

describe('GET /sessions/:id/agents as the learner who owns the session', () => {
    it('names each agent by case agent id and template id', async () => {
        const res = await getAs(studentToken, `/api/sessions/${sessionId}/agents`);
        expect(res.status).toBe(200);
        const { agents } = await res.json();
        const consultant = agents.find((a) => a.agent_type === 'consultant');
        expect(consultant.case_agent_id).toBe(consultantAgentId);
        expect(Number.isInteger(consultant.agent_template_id)).toBe(true);
    });

    it('never carries a team agent prompt, but keeps the patient prompt the chat assembles', async () => {
        const res = await getAs(studentToken, `/api/sessions/${sessionId}/agents`);
        const { agents } = await res.json();
        expect(JSON.stringify(agents)).not.toContain(SECRET_CONSULTANT_PROMPT);
        expect(agents.find((a) => a.agent_type === 'consultant').system_prompt).toBeNull();
        expect(agents.find((a) => a.agent_type === 'patient').system_prompt).toBe(PATIENT_PROMPT);
    });

    // Regression lock: the list joined agent_templates without
    // `deleted_at IS NULL`, so a soft-deleted template's agent was offered to
    // the learner while the proxy (agentPersona.loadSessionCaseAgent) refused
    // to speak as it — a tab that could only ever 404.
    it('omits an agent whose template was soft-deleted, agreeing with the proxy', async () => {
        const res = await getAs(studentToken, `/api/sessions/${sessionId}/agents`);
        const { agents } = await res.json();
        expect(agents.map((a) => a.case_agent_id)).not.toContain(deletedTemplateAgentId);
        expect(agents.find((a) => a.agent_type === 'consultant')).toBeTruthy();

        const before = llm.bodies.length;
        const proxied = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hi' }],
            agent_llm_config: { case_agent_id: deletedTemplateAgentId },
        });
        expect(proxied.status).toBe(404);
        expect(llm.bodies.length).toBe(before);
    });
});

// verifySessionOwnership lets educator-and-above reach any session in their
// own tenant (routes/_helpers.js), so an educator — not only an admin — may
// read a learner's session agents, and is given the authored prompts.
describe('GET /sessions/:id/agents as an educator viewing a learner session', () => {
    it('returns the team agent prompt the learner is not sent', async () => {
        const res = await getAs(educatorToken, `/api/sessions/${sessionId}/agents`);
        expect(res.status).toBe(200);
        const { agents } = await res.json();
        expect(agents.find((a) => a.agent_type === 'consultant').system_prompt).toBe(SECRET_CONSULTANT_PROMPT);
    });
});

describe('GET /cases/:id/agents', () => {
    it('withholds team agent prompts from a learner', async () => {
        const res = await getAs(studentToken, `/api/cases/${caseId}/agents`);
        expect(res.status).toBe(200);
        const { agents } = await res.json();
        expect(JSON.stringify(agents)).not.toContain(SECRET_CONSULTANT_PROMPT);
        expect(agents.find((a) => a.agent_type === 'patient').system_prompt).toBe(PATIENT_PROMPT);
    });

    it('still gives an educator every prompt, for the case editor', async () => {
        const res = await getAs(educatorToken, `/api/cases/${caseId}/agents`);
        const { agents } = await res.json();
        expect(agents.find((a) => a.agent_type === 'consultant').system_prompt).toBe(SECRET_CONSULTANT_PROMPT);
    });

    it('still lists an attachment whose template was soft-deleted, so the editor can remove it', async () => {
        const res = await getAs(educatorToken, `/api/cases/${caseId}/agents`);
        const { agents } = await res.json();
        expect(agents.map((a) => a.id)).toContain(deletedTemplateAgentId);
    });
});

describe('POST /proxy/llm with case_agent_id', () => {
    const systemTextOf = (body) => (body.messages || [])
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');

    it('speaks from the authored prompt the learner never received, with the situation after it', async () => {
        const before = llm.bodies.length;
        const res = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'Is this an NSTEMI?' }],
            system_prompt: SITUATION,
            agent_llm_config: { case_agent_id: consultantAgentId },
        });
        expect(res.status).toBe(200);
        expect(llm.bodies.length).toBe(before + 1);

        const system = systemTextOf(llm.bodies.at(-1));
        expect(system).toMatch(/You are: On-call cardiologist\./);
        expect(system).toMatch(/Your name: Dr Haddad\./);
        expect(system.indexOf(SECRET_CONSULTANT_PROMPT)).toBeGreaterThan(system.indexOf('## ROLE'));
        expect(system.indexOf('--- CURRENT SITUATION ---')).toBeGreaterThan(system.indexOf(SECRET_CONSULTANT_PROMPT));
        expect(system).toContain('HR: 90bpm');
    });

    it('refuses an agent attached to a different case, without calling the model', async () => {
        const before = llm.bodies.length;
        const res = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hi' }],
            agent_llm_config: { case_agent_id: otherCaseAgentId },
        });
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBeTypeOf('string');
        expect(llm.bodies.length).toBe(before);
    });

    it('refuses a valid case agent on another learner\'s session, without calling the model', async () => {
        const before = llm.bodies.length;
        const res = await proxyAs(otherStudentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'Is this an NSTEMI?' }],
            system_prompt: SITUATION,
            agent_llm_config: { case_agent_id: consultantAgentId },
        });
        expect([403, 404]).toContain(res.status);
        expect(JSON.stringify(await res.json())).not.toContain(SECRET_CONSULTANT_PROMPT);
        expect(llm.bodies.length).toBe(before);
    });

    // Regression lock: AgentService posted `{ case_agent_id: undefined }`,
    // which JSON turns into `{}`, and the proxy fell through to the patient
    // path — the model answered with no persona at all. An agent config that
    // names no agent is now refused.
    it('refuses an agent_llm_config that names no agent, without calling the model', async () => {
        for (const agentLlmConfig of [{}, { case_agent_id: null }, { agent_template_id: null },
            { provider: 'openai', endpoint: 'http://attacker.invalid' }, 'nurse', [7]]) {
            const before = llm.bodies.length;
            const res = await proxyAs(studentToken, {
                session_id: sessionId,
                messages: [{ role: 'user', content: 'hi' }],
                system_prompt: SITUATION,
                agent_llm_config: agentLlmConfig,
            });
            expect(res.status, JSON.stringify(agentLlmConfig)).toBe(400);
            expect((await res.json()).code).toBe('agent_not_named');
            expect(llm.bodies.length, JSON.stringify(agentLlmConfig)).toBe(before);
        }
    });

    it('still accepts an explicit null agent_llm_config as "no agent"', async () => {
        const before = llm.bodies.length;
        const res = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hi' }],
            system_prompt: 'CLIENT-BUILT PATIENT PERSONA',
            agent_llm_config: null,
        });
        expect(res.status).toBe(200);
        expect(llm.bodies.length).toBe(before + 1);
    });

    it('refuses a disabled case agent', async () => {
        const res = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hi' }],
            agent_llm_config: { case_agent_id: disabledAgentId },
        });
        expect(res.status).toBe(404);
    });

    it('requires a session, since the agent is resolved through it', async () => {
        const res = await proxyAs(studentToken, {
            messages: [{ role: 'user', content: 'hi' }],
            agent_llm_config: { case_agent_id: consultantAgentId },
        });
        expect(res.status).toBe(400);
    });

    it('leaves a request with no agent exactly as the client built it', async () => {
        const before = llm.bodies.length;
        const res = await proxyAs(studentToken, {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'hi' }],
            system_prompt: 'CLIENT-BUILT PATIENT PERSONA',
        });
        expect(res.status).toBe(200);
        // Not a stale body from an earlier test.
        expect(llm.bodies.length).toBe(before + 1);
        const system = systemTextOf(llm.bodies.at(-1));
        expect(system).toContain('CLIENT-BUILT PATIENT PERSONA');
        expect(system).not.toContain('## ROLE');
    });
});
