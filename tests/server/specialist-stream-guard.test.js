// POST /proxy/llm streamed to an on-call specialist on a Finnish case.
//
// Regression lock: FI-0010 journey review, finding F02 (2026-10-14). The
// streaming branch of the proxy logged "specialist reply guard skipped" and
// forwarded every upstream delta as it arrived, so a client asking for
// `?stream=1` received the diagnosis unguarded. These tests fail against that
// proxy: the streamed body carries "adenokarsinooma" and "syöpä". The
// non-streamed test fails against the English-only fallback question.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { GUARD_FALLBACK_REPLIES } from '../../server/services/specialistBrief.js';

const PASSWORD = 'StreamGuard1!';

const FI_CONFIG = {
    case_language: 'fi',
    pathology: {
        manifest: { title: 'Sigmasuolen resektaatti' },
        rubric: {
            activities: [{
                activityId: 'act-1',
                findings: [{ id: 'f1', text: 'Epäsäännöllisiä rauhasia rasvakudoksessa' }],
                diagnosis: {
                    expected: 'Paksusuolen adenokarsinooma',
                    accept: ['kolorektaalinen adenokarsinooma', 'sigmasuolen adenokarsinooma'],
                    requireTerms: ['adenokarsinooma'],
                },
            }],
        },
    },
};

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

// OpenAI-compatible upstream. A streamed request is answered as SSE, one
// chunk per entry of `reply.chunks`; a plain one as a JSON completion of the
// chunks joined.
function startUpstream() {
    const reply = { chunks: ['ok'] };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = JSON.parse(raw || '{}');
            if (body.stream) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                reply.chunks.forEach((content) => {
                    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
                });
                res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 9 } })}\n\n`);
                res.end('data: [DONE]\n\n');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'cmpl-s',
                choices: [{ index: 0, message: { role: 'assistant', content: reply.chunks.join('') }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
            }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, reply, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

let server;
let upstream;
let token;
let sessionId;
let pathologistAgentId;
let nurseAgentId;

const ask = (caseAgentId, { stream }) => fetch(`${server.baseUrl}/api/proxy/llm${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
        session_id: sessionId,
        messages: [{ role: 'user', content: 'Mikä tämä on?' }],
        agent_llm_config: { case_agent_id: caseAgentId },
    }),
});

// The text the client would assemble from the SSE body: every `delta`.
const streamedText = (body) => body.split('\n\n')
    .filter((block) => block.startsWith('data: ') && block !== 'data: [DONE]')
    .map((block) => JSON.parse(block.slice(6)))
    .map((evt) => evt.delta || '')
    .join('');

beforeAll(async () => {
    upstream = await startUpstream();
    server = await startTestServer();
    const db = await openDb(server.dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const student = await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('stream-student', 'S', 'stream-student@example.com', ?, 'student', 1, 'active')`, [hash]);
        await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`,
        [upstream.baseUrl]);
        const caseId = (await pRun(db,
            `INSERT INTO cases (name, config, tenant_id) VALUES ('FI stream case', ?, 1)`,
            [JSON.stringify(FI_CONFIG)])).lastID;
        const attach = async (type, name) => {
            const templateId = (await pRun(db,
                `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, config, tenant_id)
                 VALUES (?, ?, ?, 'PROMPT', '{}', 1)`, [type, name, name])).lastID;
            return (await pRun(db,
                `INSERT INTO case_agents (case_id, agent_template_id, enabled, availability_type, tenant_id)
                 VALUES (?, ?, 1, 'on-call', 1)`, [caseId, templateId])).lastID;
        };
        pathologistAgentId = await attach('pathologist', 'Dr Path');
        nurseAgentId = await attach('nurse', 'Nurse');
        sessionId = (await pRun(db,
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id)
             VALUES (?, ?, 'Stream Student', 'active', 1)`, [caseId, student.lastID])).lastID;
    } finally {
        await closeDb(db);
    }
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'stream-student', password: PASSWORD }),
    });
    token = (await login.json()).token;
}, 90_000);

afterAll(async () => {
    if (server) await server.close();
    if (upstream) await upstream.close();
});

describe('streamed specialist replies are guarded', () => {
    it('never writes a sentence naming the answer, however the upstream chunks it', async () => {
        upstream.reply.chunks = ['Katso ensin rauhasia. Löydös sopii adeno', 'karsinoomaan', '. Tämä on syö', 'pä. Mitä näet?'];
        const res = await ask(pathologistAgentId, { stream: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const body = await res.text();
        expect(body.toLowerCase()).not.toContain('adeno');
        expect(body.toLowerCase()).not.toContain('karsinoom');
        expect(body).not.toContain('syö');
        expect(streamedText(body)).toBe('Katso ensin rauhasia. Mitä näet?');
        expect(body).toContain('"done":true');
    });

    it('ends with the Finnish fallback question when every sentence names the answer', async () => {
        upstream.reply.chunks = ['This is ', 'adenocarcinoma.'];
        const body = await (await ask(pathologistAgentId, { stream: true })).text();
        expect(body).not.toContain('adenocarcinoma');
        expect(streamedText(body)).toBe(GUARD_FALLBACK_REPLIES.fi);
    });

    it('streams a non-specialist agent unguarded', async () => {
        upstream.reply.chunks = ['Potilaalla on ', 'adenokarsinooma.'];
        const body = await (await ask(nurseAgentId, { stream: true })).text();
        expect(streamedText(body)).toBe('Potilaalla on adenokarsinooma.');
    });
});

describe('non-streamed specialist replies on a Finnish case', () => {
    it('answers with the fallback question in Finnish, not English', async () => {
        upstream.reply.chunks = ['Kyseessä on adenokarsinooma.'];
        const body = await (await ask(pathologistAgentId, { stream: false })).json();
        expect(body.choices[0].message.content).toBe(GUARD_FALLBACK_REPLIES.fi);
    });

    it('removes an inflected form and keeps the rest', async () => {
        upstream.reply.chunks = ['Rauhaset ovat epäsäännöllisiä. Löydös sopii adenokarsinoomaan.'];
        const body = await (await ask(pathologistAgentId, { stream: false })).json();
        expect(body.choices[0].message.content).toBe('Rauhaset ovat epäsäännöllisiä.');
    });
});
