// Regression locks for what the API fuzzer (scripts/fuzz-api.sh) found on its
// first local run, 2026-09-23. Each was a 500 for a request that was the
// client's mistake, or an upstream's.
//
//   1. Express 5 leaves req.body UNDEFINED when no body parser ran, and
//      handlers destructure it — ~40 routes answered a bodiless POST with a
//      500 TypeError. Fixed once in server/server.js.
//   2. Six routes inserted a missing field into a NOT NULL column and answered
//      SQLITE_CONSTRAINT as 500. Fixed with missingField() (routes/_helpers.js).
//   3. /proxy/llm answered an unreachable provider ("fetch failed") with 500.
//      It is an upstream failure: 502.
//   4. PUT /cases/:id on an unknown case answered 200 (an UPDATE of nothing),
//      and with no name stored NULL into a NOT NULL column (500).
//   5. Duplicating an agent template twice hit UNIQUE(agent_type, name): 500.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { startTestServer } from '../utils/startTestServer.js';
import { closeDb, openDb, run } from '../utils/authHttp.js';
import { missingField } from '../../server/routes/_helpers.js';

const TEST_JWT_SECRET = 'rohy-fuzz-regressions-secret';

// A port nothing listens on: bind to :0, read the port, release it.
function closedPort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

describe('missingField', () => {
    it('names the first field NOT NULL would refuse', () => {
        expect(missingField({ a: 1, b: null }, ['a', 'b'])).toBe('b');
        expect(missingField({ a: 1 }, ['a', 'b'])).toBe('b');
        expect(missingField({ a: 0, b: false }, ['a', 'b'])).toBeNull();
    });

    it('keeps accepting an empty string, which NOT NULL stores', () => {
        expect(missingField({ unit: '' }, ['unit'])).toBeNull();
    });

    it('treats a body that is not a plain object as missing everything', () => {
        expect(missingField([null, null], ['name'])).toBe('name');
        expect(missingField(undefined, ['name'])).toBe('name');
        expect(missingField('name', ['name'])).toBe('name');
    });
});

describe('API fuzzer findings stay fixed', () => {
    let server;
    let educatorToken;

    beforeAll(async () => {
        const deadPort = await closedPort();
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('testpass', 4);
        await run(db, `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
            VALUES ('fuzzlock', 'Fuzz Lock', ?, 'fuzzlock@example.com', 'educator', 'active', 1)`, [hash]);
        const user = await new Promise((resolve, reject) => db.get(
            'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['fuzzlock'],
            (err, row) => (err ? reject(err) : resolve(row)),
        ));
        educatorToken = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: 'educator', tenant_id: 1 },
            TEST_JWT_SECRET, { expiresIn: '1h' },
        );
        // A provider that cannot be reached: nothing listens on deadPort.
        await run(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'), ('llm_provider', 'custom'),
            ('llm_base_url', ?), ('llm_model', 'test-model')`, [`http://127.0.0.1:${deadPort}/v1`]);
        await closeDb(db);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const post = (path, { body, raw, token = educatorToken } = {}) => fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // Regression lock: a bodiless POST was a 500 TypeError ("Cannot destructure
    // property 'username' of 'req.body' as it is undefined").
    it('a POST with no body gets the handler\'s own 400, not a 500', async () => {
        const login = await post('/api/auth/login', { token: null });
        expect(login.status).toBe(400);
        expect((await login.json()).error).toMatch(/required/i);

        const notes = await post('/api/sessions/1/notes');
        expect(notes.status).toBe(400);
        expect((await notes.json()).error).toBe('content is required');
    });

    // Regression lock: each of these inserted NULL into a NOT NULL column and
    // answered SQLITE_CONSTRAINT as 500.
    it.each([
        ['/api/cases', 'name'],
        ['/api/master/body-regions', 'region_id'],
        ['/api/master/scenario-templates', 'template_id'],
        ['/api/master/lab-tests', 'test_name'],
        ['/api/master/medications', 'generic_name'],
        ['/api/settings/log', 'setting_type'],
    ])('%s without %s is a 400 naming the field', async (path, field) => {
        const res = await post(path, { body: {} });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(`${field} is required`);
    });

    it('a JSON array body is refused the same way, not stored as nulls', async () => {
        const res = await post('/api/cases', { raw: '[null, null]' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('name is required');
    });

    const put = (path, body) => fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${educatorToken}`, 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

    // Regression lock: PUT on a case that does not exist answered 200.
    it('PUT /cases/:id is a 404 for an unknown case and a 400 without a name', async () => {
        const unknown = await put('/api/cases/987654', { name: 'Nobody' });
        expect(unknown.status).toBe(404);

        const created = await post('/api/cases', { body: { name: 'Fuzz lock case', config: {} } });
        expect(created.ok).toBe(true);
        const { id } = await created.json();
        const noName = await put(`/api/cases/${id}`, '[]');
        expect(noName.status).toBe(400);
        expect((await noName.json()).error).toBe('name is required');
        // Not vacuous: a real update of the same case still succeeds.
        expect((await put(`/api/cases/${id}`, { name: 'Fuzz lock case, renamed', config: {} })).status).toBe(200);
    });

    // Regression lock: the second Duplicate click was a 500 (UNIQUE constraint).
    it('duplicating a template twice gives two copies with distinct names', async () => {
        const list = await (await fetch(`${server.baseUrl}/api/agents/templates`, {
            headers: { Authorization: `Bearer ${educatorToken}` },
        })).json();
        const templates = Array.isArray(list) ? list : list.templates;
        expect(templates.length, 'the seeded templates').toBeGreaterThan(0);
        const original = templates[0];

        const first = await post(`/api/agents/templates/${original.id}/duplicate`);
        const second = await post(`/api/agents/templates/${original.id}/duplicate`);
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect((await first.json()).id).not.toBe((await second.json()).id);

        // An explicitly requested name that is taken is the caller's conflict.
        const clash = await post(`/api/agents/templates/${original.id}/duplicate`, { body: { name: original.name } });
        expect(clash.status).toBe(409);
    });

    // Regression lock: "fetch failed" from an unreachable provider was a 500.
    it('an unreachable LLM provider is a 502, not a 500', async () => {
        const res = await post('/api/proxy/llm', { body: { messages: [{ role: 'user', content: 'hello' }] } });
        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe('LLM provider unreachable');
    });
});
