// Regression lock: after a session ended, a patient-persona /proxy/llm request was still admitted and reached the provider (FI-0010 review F09); it is now refused with 409 session_ended before anything upstream is built, while the debrief discussant still speaks after the end
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'EndedPatient1!';

// A stand-in provider that counts every request it receives.
function startCountingLlm() {
    const bodies = [];
    const srv = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            bodies.push(JSON.parse(raw || '{}'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        });
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
        baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, bodies, close: () => new Promise((r) => srv.close(r)),
    })));
}
const pRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));

let llm; let server; let token; let sessionId; let patientTemplateId;

beforeAll(async () => {
    llm = await startCountingLlm();
    server = await startTestServer();
    const db = await new Promise((resolve, reject) => { const d = new (sqlite3.verbose().Database)(server.dbPath, (e) => (e ? reject(e) : resolve(d))); });
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const student = await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('ended-student', 'S', 'ended@example.com', ?, 'student', 1, 'active')`, [hash]);
        await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`, [llm.baseUrl]);
        const config = { patient_name: 'Aino Example', demographics: { age: 60, gender: 'Female' } };
        const caseId = (await pRun(db, `INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('Ended Case', 'p', ?, 1)`, [JSON.stringify(config)])).lastID;
        const tpl = async (type, name) => (await pRun(db, `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, config, tenant_id) VALUES (?, ?, ?, ?, '{}', 1)`, [type, name, name, `${name}-PERSONA`])).lastID;
        const attach = (templateId) => pRun(db, `INSERT INTO case_agents (case_id, agent_template_id, enabled, availability_type, tenant_id) VALUES (?, ?, 1, 'present', 1)`, [caseId, templateId]);
        patientTemplateId = await tpl('patient', 'Patient');
        await attach(patientTemplateId);
        await attach(await tpl('discussant', 'Tutor'));
        sessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, student_name, status, case_snapshot, tenant_id) VALUES (?, ?, 'S', 'active', ?, 1)`,
            [caseId, student.lastID, JSON.stringify({ case_id: caseId, name: 'Ended Case', system_prompt: 'p', config })])).lastID;
    } finally { await new Promise((r) => db.close(r)); }
    const res = await fetch(`${server.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ended-student', password: PASSWORD }) });
    token = (await res.json()).token;
}, 90_000);
afterAll(async () => { await server?.close(); await llm?.close(); });

const proxy = (body) => fetch(`${server.baseUrl}/api/proxy/llm`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
const say = (agentConfig) => proxy({ session_id: sessionId, messages: [{ role: 'user', content: 'hei' }], agent_llm_config: agentConfig });

describe('the patient after the session ended', () => {
    it('answers while the session runs', async () => {
        const before = llm.bodies.length;
        const res = await say({ persona: 'patient' });
        expect(res.status).toBe(200);
        expect(llm.bodies.length).toBe(before + 1);
    });

    it('refuses with 409 session_ended once the session has ended, and never calls the provider', async () => {
        const end = await fetch(`${server.baseUrl}/api/sessions/${sessionId}/end`, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });
        expect(end.status).toBe(200);
        const before = llm.bodies.length;
        for (const agentConfig of [{ persona: 'patient' }, { agent_template_id: patientTemplateId }]) {
            const res = await say(agentConfig);
            expect(res.status).toBe(409);
            expect(await res.json()).toMatchObject({ code: 'session_ended' });
        }
        // Streaming asks take the same path and are refused before the upstream too.
        const streamed = await fetch(`${server.baseUrl}/api/proxy/llm?stream=1`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, accept: 'text/event-stream' },
            body: JSON.stringify({ session_id: sessionId, messages: [{ role: 'user', content: 'hei' }], agent_llm_config: { persona: 'patient' } }),
        });
        expect(streamed.status).toBe(409);
        expect(llm.bodies.length).toBe(before);
    });

    it('still lets the debrief discussant speak after the end', async () => {
        const before = llm.bodies.length;
        const res = await say({ persona: 'discussant' });
        expect(res.status).toBe(200);
        expect(llm.bodies.length).toBe(before + 1);
    });
});
