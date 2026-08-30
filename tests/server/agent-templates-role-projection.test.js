// Regression lock: GET /api/agents/templates must not serve the educator's
// agent library to learners (UI swarm finding #14, v2.9.108).
//
// The route was `authenticateToken` + `SELECT *` while every mutating sibling
// is `requireEducator`, so any signed-in student could read the whole library:
// the consultant's coaching script, the debrief tutor's answer guidance, every
// template's LLM routing. API keys were redacted by redactRow(); the pedagogy
// was not.
//
// WHAT THE FIX IS, AND WHY IT IS NOT A FLAT `requireEducator`.
// Two learner runtimes resolve their own conversation partner through this
// endpoint whenever a case has no per-case agent attached — and `case_agents`
// is never seeded, so that is the DEFAULT path on a fresh install:
//
//   * ChatInterface.jsx:465 falls back to a platform-default `patient`
//     template for the persona prose and `config.voice` (how a patient gets a
//     gender-matched voice at all).
//   * discussionService.js:45 falls back to a platform-default `discussant`
//     for the debrief tutor plus its `config.unlock_trigger` /
//     `config.show_encounter_record`.
//
// The client assembles the system prompt and posts it to /proxy/llm (the
// server resolves only LLM ROUTING from agent_templates, never the prompt
// text), so those two prompts must reach the learner's browser or the persona
// and the debrief go mute. Everything else must not. Hence: a learner sees
// only the agent types their own runtime resolves, and only the columns it
// reads.
//
// These tests fail against the un-fixed route on the first assertion — a
// student's list came back holding the consultant and its secret prompt.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'TplTests1!';
const SECRET_CONSULTANT_PROMPT = 'CONSULTANT-ANSWER-KEY: steer them to cath lab within 90 minutes.';
const PATIENT_PROMPT = 'You are a 58-year-old man with crushing chest pain.';
const DISCUSSANT_PROMPT = 'Socratic debrief tutor. Probe their reasoning.';

// Columns a learner has no runtime reason to hold.
const FORBIDDEN_FOR_LEARNERS = [
    'llm_provider', 'llm_model', 'llm_api_key', 'llm_endpoint', 'llm_config',
    'llm_temperature', 'llm_max_tokens', 'memory_access', 'created_by',
    'created_at', 'updated_at', 'tenant_id', 'deleted_at',
];

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

async function seedUser(db, username, role) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
}

async function seedTemplate(db, { type, name, prompt, config = '{}' }) {
    const r = await pRun(
        db,
        `INSERT INTO agent_templates
            (agent_type, name, role_title, system_prompt, config, is_default, tenant_id,
             llm_provider, llm_model, llm_api_key, memory_access)
         VALUES (?, ?, ?, ?, ?, 1, 1, 'openai', 'gpt-5.6', 'sk-secret-key', '{"scope":"full"}')`,
        [type, name, `${type} role`, prompt, config]
    );
    return r.lastID;
}

let server;
let db;
let studentToken;
let educatorToken;
let consultantId;
let patientId;

async function login(username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

const asUser = (token) => (path) =>
    fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
    server = await startTestServer();
    db = await openDb(server.dbPath);

    await seedUser(db, 'tpl-student', 'student');
    await seedUser(db, 'tpl-educator', 'educator');

    // Wipe the boot seeder's templates so the fixtures below are the whole
    // library and a count assertion means something.
    await pRun(db, `DELETE FROM agent_templates`);
    patientId = await seedTemplate(db, {
        type: 'patient',
        name: 'Default Patient (male)',
        prompt: PATIENT_PROMPT,
        config: JSON.stringify({ voice: { gender: 'male', voiceId: 'am_michael' } }),
    });
    await seedTemplate(db, {
        type: 'discussant',
        name: 'Case Debrief Tutor',
        prompt: DISCUSSANT_PROMPT,
        config: JSON.stringify({ unlock_trigger: 'after_case_ended', show_encounter_record: true }),
    });
    consultantId = await seedTemplate(db, {
        type: 'consultant',
        name: 'On-call Cardiologist',
        prompt: SECRET_CONSULTANT_PROMPT,
    });

    studentToken = await login('tpl-student');
    educatorToken = await login('tpl-educator');
}, 90_000);

afterAll(async () => {
    if (db) await closeDb(db);
    if (server) await server.close();
});

describe('GET /agents/templates as a student', () => {
    it('never returns a template type the learner runtime does not resolve', async () => {
        const res = await asUser(studentToken)('/api/agents/templates');
        expect(res.status).toBe(200);
        const { templates } = await res.json();

        const types = templates.map((t) => t.agent_type).sort();
        expect(types).toEqual(['discussant', 'patient']);

        // The whole point of the finding: the consultant's prompt must not be
        // anywhere in the payload.
        expect(JSON.stringify(templates)).not.toContain(SECRET_CONSULTANT_PROMPT);
        expect(JSON.stringify(templates)).not.toContain('On-call Cardiologist');
    });

    it('strips LLM routing, memory access and authorship from what it does return', async () => {
        const res = await asUser(studentToken)('/api/agents/templates');
        const { templates } = await res.json();
        expect(templates.length).toBeGreaterThan(0);

        for (const t of templates) {
            for (const field of FORBIDDEN_FOR_LEARNERS) {
                expect(Object.hasOwn(t, field), `${t.agent_type} leaked ${field}`).toBe(false);
            }
        }
        expect(JSON.stringify(templates)).not.toContain('sk-secret-key');
    });

    it('still carries what the patient chat and the debrief actually read', async () => {
        // Withholding these would mute the patient persona and the debrief
        // tutor on every case with no per-case agent attached — which is every
        // case on a fresh install.
        const res = await asUser(studentToken)('/api/agents/templates');
        const { templates } = await res.json();

        const patient = templates.find((t) => t.agent_type === 'patient');
        expect(patient.system_prompt).toBe(PATIENT_PROMPT);
        expect(patient.config.voice.gender).toBe('male');
        expect(patient.is_default).toBe(true);

        const discussant = templates.find((t) => t.agent_type === 'discussant');
        expect(discussant.system_prompt).toBe(DISCUSSANT_PROMPT);
        expect(discussant.config.show_encounter_record).toBe(true);
    });
});

describe('GET /agents/templates as an educator', () => {
    it('returns the whole library, prompts and routing included', async () => {
        const res = await asUser(educatorToken)('/api/agents/templates');
        expect(res.status).toBe(200);
        const { templates } = await res.json();

        const types = templates.map((t) => t.agent_type).sort();
        expect(types).toEqual(['consultant', 'discussant', 'patient']);

        const consultant = templates.find((t) => t.agent_type === 'consultant');
        expect(consultant.system_prompt).toBe(SECRET_CONSULTANT_PROMPT);
        expect(consultant.llm_provider).toBe('openai');
        expect(consultant.memory_access).toBeDefined();
        // Keys stay redacted for educators too — that guarantee predates this
        // change and must survive it.
        expect(consultant.llm_api_key).not.toBe('sk-secret-key');
    });
});

describe('GET /agents/templates/:id', () => {
    it('404s a student asking for a template type they may not see', async () => {
        const res = await asUser(studentToken)(`/api/agents/templates/${consultantId}`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBeTypeOf('string');
        expect(JSON.stringify(body)).not.toContain(SECRET_CONSULTANT_PROMPT);
    });

    it('narrows a student reading a template type they may see', async () => {
        const res = await asUser(studentToken)(`/api/agents/templates/${patientId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.system_prompt).toBe(PATIENT_PROMPT);
        for (const field of FORBIDDEN_FOR_LEARNERS) {
            expect(Object.hasOwn(body, field), `leaked ${field}`).toBe(false);
        }
    });

    it('gives an educator the full row', async () => {
        const res = await asUser(educatorToken)(`/api/agents/templates/${consultantId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.system_prompt).toBe(SECRET_CONSULTANT_PROMPT);
        expect(body.llm_model).toBe('gpt-5.6');
    });
});
