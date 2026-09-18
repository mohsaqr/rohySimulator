// On-call specialist phone, server side: the case brief, the disclosure gate,
// the reply guard, and call attribution on agent conversations.
//
// Regression lock: the specialist's knowledge of the case must come from the
// server. Before this, a specialist spoke from its authored prompt only — the
// findings either were not available at all or would have had to be built in
// the learner's browser, which holds everything it builds. These tests fail
// against the un-fixed proxy: no CASE BRIEF reaches the upstream, and a reply
// naming the diagnosis is passed through verbatim.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { BRIEF_HEADER, BRIEF_WITHHELD, BRIEF_NO_DIAGNOSIS } from '../../server/services/specialistBrief.js';

const PASSWORD = 'OncallPhone1!';
const FINDING = 'Nests of atypical epithelial cells infiltrate desmoplastic stroma';
const SNAPSHOT_FINDING = 'Snapshot-only finding: tubule formation is scant';
const DIAGNOSIS = 'Invasive ductal carcinoma';
const ACCEPTED = 'IDC';
const PATHOLOGIST_PROMPT = 'AUTHORED-PATHOLOGIST: you are collegial and precise.';

const caseConfig = (findingText) => ({
    patient_name: 'Ada Example',
    demographics: { age: 52, gender: 'Female' },
    structuredHistory: { chiefComplaint: 'Left breast lump' },
    pathology: {
        manifest: { title: 'Breast core biopsy' },
        rubric: {
            activities: [{
                activityId: 'act-1',
                findings: [{ id: 'f1', text: findingText, roiId: 'roi-1' }],
                diagnosis: { expected: DIAGNOSIS, accept: [ACCEPTED], requireTerms: ['invasive'] },
            }],
        },
    },
});

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
    return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

// OpenAI-compatible upstream that records request bodies and answers with
// whatever `reply.content` currently holds.
function startRecordingLlm() {
    const bodies = [];
    const reply = { content: 'ok' };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            bodies.push(JSON.parse(raw || '{}'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'cmpl-1',
                choices: [{ index: 0, message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
            }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, bodies, reply, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

let server;
let llm;
let dbPath;
let studentToken;
let caseId;
let pathologistAgentId;
let nurseAgentId;
let liveSessionId;
let snapshotSessionId;
let convoSessionId;
let noAgentSessionId;

async function login(username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

const postAs = (token, path, body) => fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
});
const getAs = (token, path) => fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

const storeStudentTurn = async (sessionId, content, extra = {}) => {
    const res = await postAs(studentToken, `/api/sessions/${sessionId}/agents/pathologist/conversation`, { role: 'user', content, ...extra });
    expect(res.status).toBe(201);
    return res.json();
};

const callPathologist = (sessionId, content) => postAs(studentToken, '/api/proxy/llm', {
    session_id: sessionId,
    messages: [{ role: 'user', content }],
    system_prompt: 'SITUATION: learner is in the pathology room',
    agent_llm_config: { case_agent_id: pathologistAgentId },
});

// The default disclosure gate also requires the learner to have been in the
// specialty's own room (`requireRoomActivity`). Any learning_events row
// carrying that room satisfies it — the gate asks whether they went and
// looked, not what they did there.
const visitRoom = async (sessionId, room) => {
    const db = await openDb(dbPath);
    try {
        await pRun(db,
            `INSERT INTO learning_events (session_id, tenant_id, verb, object_type, object_id, room)
             VALUES (?, 1, 'NAVIGATED', 'room', ?, ?)`,
            [sessionId, room, room]);
    } finally {
        await closeDb(db);
    }
};

const lastSystemPrompt = () => (llm.bodies.at(-1).messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');

beforeAll(async () => {
    llm = await startRecordingLlm();
    server = await startTestServer();
    dbPath = server.dbPath;
    const db = await openDb(dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const student = await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('oncall-student', 'S', 'oncall-student@example.com', ?, 'student', 1, 'active')`, [hash]);
        await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`,
        [llm.baseUrl]);

        caseId = (await pRun(db,
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
             VALUES ('Invasive ductal carcinoma case', 'desc', 'case-prompt', ?, 1)`,
            [JSON.stringify(caseConfig(FINDING))])).lastID;
        const addTemplate = async (type, name, roleTitle, prompt) => (await pRun(db,
            `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, config, tenant_id)
             VALUES (?, ?, ?, ?, '{}', 1)`, [type, name, roleTitle, prompt])).lastID;
        const attach = async (templateId) => (await pRun(db,
            `INSERT INTO case_agents (case_id, agent_template_id, enabled, availability_type, tenant_id)
             VALUES (?, ?, 1, 'on-call', 1)`, [caseId, templateId])).lastID;
        pathologistAgentId = await attach(await addTemplate('pathologist', 'Dr Path', 'Consultant pathologist', PATHOLOGIST_PROMPT));
        nurseAgentId = await attach(await addTemplate('nurse', 'Nurse', 'Bedside nurse', 'NURSE-PROMPT'));

        const addSession = async (snapshot = null, onCase = caseId) => (await pRun(db,
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id, case_snapshot)
             VALUES (?, ?, 'Oncall Student', 'active', 1, ?)`, [onCase, student.lastID, snapshot])).lastID;
        liveSessionId = await addSession();
        snapshotSessionId = await addSession(JSON.stringify({ case_id: caseId, config: caseConfig(SNAPSHOT_FINDING) }));
        convoSessionId = await addSession();
        const bareCaseId = (await pRun(db,
            `INSERT INTO cases (name, config, tenant_id) VALUES ('Bare case', '{}', 1)`)).lastID;
        noAgentSessionId = await addSession(null, bareCaseId);
    } finally {
        await closeDb(db);
    }
    studentToken = await login('oncall-student');
}, 90_000);

afterAll(async () => {
    if (server) await server.close();
    if (llm) await llm.close();
});

describe('POST /proxy/llm as an on-call pathologist', () => {
    it('withholds the findings on the first turn and never carries the diagnosis', async () => {
        await storeStudentTurn(liveSessionId, 'Hello, can you look at my biopsy?');
        llm.reply.content = 'Tell me what you saw.';
        const res = await callPathologist(liveSessionId, 'Hello, can you look at my biopsy?');
        expect(res.status).toBe(200);

        const system = lastSystemPrompt();
        expect(system).toContain(BRIEF_HEADER);
        expect(system).toContain(BRIEF_WITHHELD);
        expect(system).toContain(BRIEF_NO_DIAGNOSIS);
        expect(system).not.toContain(FINDING);
        expect(system).not.toContain(DIAGNOSIS);
        // Regression lock: a specialist read one room's material and never met
        // the patient. The brief led with a patient summary until 2026-09-18 —
        // name, age, sex and CHIEF COMPLAINT, which is a symptom. None of it
        // may reach the prompt.
        expect(system).not.toContain('Left breast lump');
        expect(system).not.toContain('Ada Example');
        expect(system).not.toContain('Female');
        expect(system).toContain('You have not seen the patient');
        // Order: authored prompt -> brief. The client's situation is dropped
        // for a specialist (see the regression lock below), so there is no
        // CURRENT SITUATION block at all.
        expect(system.indexOf(BRIEF_HEADER)).toBeGreaterThan(system.indexOf(PATHOLOGIST_PROMPT));
        expect(system).not.toContain('--- CURRENT SITUATION ---');
    });

    it('holds the findings back while the learner has never opened the pathology room', async () => {
        // Turn quota met (this is the 3rd), room quota not: the default
        // disclosure sets requireRoomActivity, and no learning_events row for
        // this session carries `pathology` yet.
        await storeStudentTurn(liveSessionId, 'I saw cells in the stroma.');
        await storeStudentTurn(liveSessionId, 'They look like nests to me.');
        await callPathologist(liveSessionId, 'They look like nests to me.');
        const system = lastSystemPrompt();
        expect(system).toContain(BRIEF_WITHHELD);
        expect(system).not.toContain(FINDING);
    });

    it('shares the findings once the learner has made three turns AND been in the room', async () => {
        await visitRoom(liveSessionId, 'pathology');
        await storeStudentTurn(liveSessionId, 'Nests, infiltrating.');
        await callPathologist(liveSessionId, 'Nests, infiltrating.');
        const system = lastSystemPrompt();
        expect(system).toContain(FINDING);
        expect(system).not.toContain(BRIEF_WITHHELD);
        expect(system).not.toContain(DIAGNOSIS);
    });

    it('briefs from the session snapshot, not the live case, when a snapshot exists', async () => {
        await visitRoom(snapshotSessionId, 'pathology');
        await storeStudentTurn(snapshotSessionId, 'a');
        await storeStudentTurn(snapshotSessionId, 'b');
        await storeStudentTurn(snapshotSessionId, 'c');
        await callPathologist(snapshotSessionId, 'c');
        const system = lastSystemPrompt();
        expect(system).toContain(SNAPSHOT_FINDING);
        expect(system).not.toContain(FINDING);
    });

    // Regression lock: the browser builds its "situation" with
    // buildDiscussionCaseContext(activeCase, 'full') — the whole case,
    // diagnosis and every report's interpretation included. Appending it to a
    // specialist's prompt handed over the answer the brief exists to withhold
    // (found by watching a real conversation: 37 KB of case text per turn).
    // The server drops it, and replaces it with nothing: the brief is
    // findings alone.
    it('ignores the client situation for a specialist, however much case text it carries', async () => {
        await storeStudentTurn(liveSessionId, 'Anything else?');
        llm.reply.content = 'What do you see?';
        const res = await postAs(studentToken, '/api/proxy/llm', {
            session_id: liveSessionId,
            messages: [{ role: 'user', content: 'Anything else?' }],
            system_prompt: [
                '=== CASE CONTEXT ===',
                `Expected diagnosis: ${DIAGNOSIS}`,
                `Radiology interpretation: ${DIAGNOSIS} with nodal spread`,
                'Treatment plan: neoadjuvant chemotherapy',
            ].join('\n'),
            agent_llm_config: { case_agent_id: pathologistAgentId },
        });
        expect(res.status).toBe(200);

        const system = lastSystemPrompt();
        expect(system).toContain(BRIEF_HEADER);
        expect(system).not.toContain(DIAGNOSIS);
        expect(system).not.toContain('Treatment plan');
        expect(system).not.toContain('=== CASE CONTEXT ===');
        expect(system).not.toContain('--- CURRENT SITUATION ---');
    });

    it('drops the sentence naming the diagnosis from the reply, leaving usage and shape intact', async () => {
        llm.reply.content = 'The nests show invasion. This is invasive ductal carcinoma.';
        const res = await callPathologist(liveSessionId, 'So what is it?');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.choices[0].message.content).toBe('The nests show invasion.');
        expect(body.choices[0].message.content.toLowerCase()).not.toContain('carcinoma');
        expect(body.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
        expect(body.id).toBe('cmpl-1');
        expect(body.choices[0].finish_reason).toBe('stop');
    });

    it('answers with a question when every sentence names the answer', async () => {
        llm.reply.content = 'IDC.';
        const body = await (await callPathologist(liveSessionId, 'Just tell me.')).json();
        expect(body.choices[0].message.content).toBe("What do you make of it yourself? Tell me what you've seen and what supports it.");
    });

    it('does not brief or guard a non-specialist agent', async () => {
        llm.reply.content = 'This is invasive ductal carcinoma.';
        const res = await postAs(studentToken, '/api/proxy/llm', {
            session_id: liveSessionId,
            messages: [{ role: 'user', content: 'hi' }],
            system_prompt: 'SITUATION',
            agent_llm_config: { case_agent_id: nurseAgentId },
        });
        expect(res.status).toBe(200);
        expect(lastSystemPrompt()).toContain('NURSE-PROMPT');
        expect(lastSystemPrompt()).not.toContain(BRIEF_HEADER);
        expect((await res.json()).choices[0].message.content).toBe('This is invasive ductal carcinoma.');
    });
});

describe('agent conversations: channel, call_id, case_agent_id', () => {
    const path = (sessionId, type = 'pathologist') => `/api/sessions/${sessionId}/agents/${type}/conversation`;

    it('stores channel and call_id, resolves the case agent server-side, and GET returns them', async () => {
        const call = await postAs(studentToken, path(convoSessionId), { role: 'user', content: 'on the phone', channel: 'call', call_id: 'call_01-A' });
        expect(call.status).toBe(201);
        const chat = await postAs(studentToken, path(convoSessionId), { role: 'assistant', content: 'typed', case_agent_id: 999999 });
        expect(chat.status).toBe(201);

        const res = await getAs(studentToken, path(convoSessionId));
        expect(res.status).toBe(200);
        const { messages } = await res.json();
        expect(messages.map((m) => [m.content, m.role, m.channel, m.call_id])).toEqual([
            ['on the phone', 'user', 'call', 'call_01-A'],
            ['typed', 'assistant', 'chat', null],
        ]);

        const db = await openDb(dbPath);
        try {
            const rows = await pAll(db, 'SELECT case_agent_id FROM agent_conversations WHERE session_id = ? ORDER BY id', [convoSessionId]);
            // The body's case_agent_id is ignored; both rows carry the real one.
            expect(rows.map((r) => r.case_agent_id)).toEqual([pathologistAgentId, pathologistAgentId]);
        } finally {
            await closeDb(db);
        }
    });

    it('stores a null case_agent_id when the case has no agent of that type', async () => {
        const res = await postAs(studentToken, path(noAgentSessionId), { role: 'user', content: 'x', channel: 'chat' });
        expect(res.status).toBe(201);
        const db = await openDb(dbPath);
        try {
            const rows = await pAll(db, 'SELECT case_agent_id, channel FROM agent_conversations WHERE session_id = ?', [noAgentSessionId]);
            expect(rows).toEqual([{ case_agent_id: null, channel: 'chat' }]);
        } finally {
            await closeDb(db);
        }
    });

    it("rejects a channel other than 'chat' or 'call'", async () => {
        for (const channel of ['sms', '', 1, ['call']]) {
            const res = await postAs(studentToken, path(convoSessionId), { role: 'user', content: 'x', channel });
            expect(res.status, JSON.stringify(channel)).toBe(400);
            expect((await res.json()).code).toBe('invalid_channel');
        }
    });

    it('rejects a malformed call_id', async () => {
        for (const callId of ['', 'a'.repeat(65), 'has space', 'semi;colon', 42, { id: 'x' }]) {
            const res = await postAs(studentToken, path(convoSessionId), { role: 'user', content: 'x', channel: 'call', call_id: callId });
            expect(res.status, JSON.stringify(callId)).toBe(400);
            expect((await res.json()).code).toBe('invalid_call_id');
        }
        const ok = await postAs(studentToken, path(convoSessionId), { role: 'user', content: 'x', channel: 'call', call_id: 'a'.repeat(64) });
        expect(ok.status).toBe(201);
    });
});
