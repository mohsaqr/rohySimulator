// Regression lock: an unreachable model server is a 502, not a 500
// (UI swarm finding #30, v2.9.108).
//
// POST /api/platform-settings/llm/models/detect proxies `GET <baseUrl>/models`
// so the admin's model picker can list what an OpenAI-compatible server
// actually has loaded. The admin LLM tab auto-fires it on open, so every visit
// with a stopped LM Studio painted a red 500 in the browser console and an
// `error`-level line in the server log — for a condition the admin is on that
// tab to discover.
//
// A refused connection is not a rohy fault. 502 + a machine-readable code says
// "the gateway reached for something and it was not there"; 500 is reserved
// for a genuine internal fault, and the two must stay distinguishable or the
// error log stops meaning anything.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'DetectTst1!';

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

// A port nothing is listening on: bind it, read it back, release it.
function findClosedPort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close((err) => (err ? reject(err) : resolve(port)));
        });
    });
}

let server;
let db;
let adminToken;
let studentToken;
let closedPort;

async function login(username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

function detect(token, body) {
    return fetch(`${server.baseUrl}/api/platform-settings/llm/models/detect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

beforeAll(async () => {
    server = await startTestServer();
    db = await openDb(server.dbPath);
    closedPort = await findClosedPort();

    const hash = await bcrypt.hash(PASSWORD, 4);
    for (const [username, role] of [['det-admin', 'admin'], ['det-student', 'student']]) {
        await pRun(
            db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, ?, 1, 'active')`,
            [username, username, `${username}@example.com`, hash, role]
        );
    }
    adminToken = await login('det-admin');
    studentToken = await login('det-student');
}, 90_000);

afterAll(async () => {
    if (db) await closeDb(db);
    if (server) await server.close();
});

describe('POST /platform-settings/llm/models/detect', () => {
    it('answers 502 with a machine-readable code when the upstream refuses', async () => {
        const res = await detect(adminToken, {
            provider: 'openai',
            baseUrl: `http://127.0.0.1:${closedPort}/v1`,
            apiKey: '',
        });
        // Un-fixed: 500.
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.code).toBe('upstream_unreachable');
        expect(body.error).toBeTypeOf('string');
        expect(body.error.length).toBeGreaterThan(0);
    });

    it('answers 502 for a host that does not resolve', async () => {
        const res = await detect(adminToken, {
            provider: 'openai',
            baseUrl: 'http://this-host-does-not-exist.invalid/v1',
            apiKey: '',
        });
        expect(res.status).toBe(502);
        expect((await res.json()).code).toBe('upstream_unreachable');
    });

    it('keeps 400 for an upstream that answered with an error status', async () => {
        // A reachable server that says no is a different condition, and the
        // route already distinguished it. Pin it so the 502 branch cannot
        // swallow it later.
        const res = await detect(adminToken, {
            provider: 'openai',
            baseUrl: `${server.baseUrl}/api/does-not-exist`,
            apiKey: '',
        });
        expect(res.status).toBe(400);
    });

    it('reports anthropic as unsupported rather than reaching for anything', async () => {
        const res = await detect(adminToken, { provider: 'anthropic' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ models: [], supported: false });
    });

    it('is still admin-only', async () => {
        const res = await detect(studentToken, {
            provider: 'openai',
            baseUrl: `http://127.0.0.1:${closedPort}/v1`,
        });
        expect(res.status).toBe(403);
    });
});
