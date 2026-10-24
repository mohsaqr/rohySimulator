// Contract for POST /api/platform-settings/llm/models/detect — the route that
// lists the models a configured server actually has loaded so the admin can
// pick the exact id LM Studio wants. Motivated by the "Multiple models are
// loaded. Please specify a model." 400: with several models loaded, an
// OpenAI-compatible server refuses to guess, so the picker must be populated
// from a live `GET <baseUrl>/models`.
//
// The upstream server (LM Studio stand-in) is a tiny http server the test runs
// itself; the spawned app reaches it over loopback and we assert on the parsed
// id list. Auth is short-circuited by inserting an admin row + signing a JWT
// with the secret startTestServer hands the child (same approach as
// tts-route.test.js).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { startTestServer } from '../utils/startTestServer.js';
import { recordSession } from '../utils/authHttp.js';

const TEST_JWT_SECRET = 'rohy-tests-secret';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));
}

describe('POST /platform-settings/llm/models/detect', () => {
    let server;
    let token;
    let upstream;
    let upstreamUrl;
    let lastPath = null;
    let lastAuth = null;
    let lastChatBody = null;

    beforeAll(async () => {
        // Stub "LM Studio": returns the OpenAI-compatible model-list shape.
        upstream = http.createServer((req, res) => {
            lastPath = req.url;
            lastAuth = req.headers.authorization ?? null;
            if (req.url === '/chat/completions') {
                let raw = '';
                req.on('data', (c) => { raw += c; });
                req.on('end', () => {
                    lastChatBody = JSON.parse(raw || '{}');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'test successful' } }] }));
                });
                return;
            }
            if (req.url === '/models') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-7b' }, { id: 'llama-3.1-8b' }] }));
            } else {
                res.writeHead(404);
                res.end('not found');
            }
        });
        await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
        upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['detectadmin', 'Detect Admin', passwordHash, 'detectadmin@example.com']
        );
        const row = await dbGet(db, 'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['detectadmin']);
        await new Promise((resolve) => db.close(() => resolve()));

        token = jwt.sign(
            { id: row.id, username: row.username, email: row.email, role: 'admin', tenant_id: row.tenant_id || 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );
        // authenticateToken fails closed on a token with no active_sessions row.
        await recordSession(server.dbPath, token, { userId: row.id });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        if (upstream) await new Promise((resolve) => upstream.close(resolve));
    });

    async function detect(body, withAuth = true) {
        const headers = { 'Content-Type': 'application/json' };
        if (withAuth) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${server.baseUrl}/api/platform-settings/llm/models/detect`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* not json */ }
        return { status: res.status, json };
    }

    it('lists the ids the configured server has loaded', async () => {
        const { status, json } = await detect({ provider: 'lmstudio', baseUrl: upstreamUrl, apiKey: '' });
        expect(status).toBe(200);
        expect(json.supported).toBe(true);
        expect(json.models).toEqual(['qwen2.5-7b', 'llama-3.1-8b']);
        expect(lastPath).toBe('/models');
    });

    it('short-circuits anthropic (no OpenAI-style /models to enumerate)', async () => {
        const { status, json } = await detect({ provider: 'anthropic', baseUrl: upstreamUrl });
        expect(status).toBe(200);
        expect(json.supported).toBe(false);
        expect(json.models).toEqual([]);
    });

    it('surfaces an upstream failure as a 400, not a silent empty list', async () => {
        const { status, json } = await detect({ provider: 'lmstudio', baseUrl: `${upstreamUrl}/nope` });
        expect(status).toBe(400);
        expect(json.error).toMatch(/returned 404/);
    });

    it('sends a typed key, sends none for an empty one, and uses the SAVED key for the form\u2019s [redacted] placeholder', async () => {
        // Regression lock: the settings form holds REDACTED for a saved key and
        // sends it back; the route used it verbatim as the bearer token, so
        // detection against a key-protected server always failed with 401.
        const db = await openDb(server.dbPath);
        // The saved key is honoured only for the SAVED URL (security audit
        // 2026-10-24, #10): the URL is stored too, and a different body URL
        // with the placeholder gets no key at all.
        await dbRun(db, `INSERT INTO platform_settings (setting_key, setting_value) VALUES ('llm_api_key', 'saved-key')
                         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`);
        await dbRun(db, `INSERT INTO platform_settings (setting_key, setting_value) VALUES ('llm_base_url', ?)
                         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [upstreamUrl]);
        await new Promise((resolve) => db.close(() => resolve()));

        await detect({ provider: 'custom', baseUrl: upstreamUrl, apiKey: 'typed-key' });
        expect(lastAuth).toBe('Bearer typed-key');
        await detect({ provider: 'custom', baseUrl: upstreamUrl, apiKey: '' });
        expect(lastAuth).toBeNull();
        await detect({ provider: 'custom', baseUrl: upstreamUrl, apiKey: '[redacted]' });
        expect(lastAuth).toBe('Bearer saved-key');
        await detect({ provider: 'custom', baseUrl: `${upstreamUrl}/elsewhere`, apiKey: '[redacted]' });
        expect(lastAuth).toBeNull();
    });

    async function adminCall(method, path, body) {
        const res = await fetch(`${server.baseUrl}/api${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* not json */ }
        return { status: res.status, json };
    }

    it('thinking: off by default, refuses an unknown value, round-trips on, and Test Connection sends the switch only for custom', async () => {
        expect((await adminCall('PUT', '/platform-settings/llm', { thinking: 'maybe' })).status).toBe(400);
        // Never set: off.
        expect((await adminCall('GET', '/platform-settings/llm')).json.thinking).toBe('off');

        expect((await adminCall('PUT', '/platform-settings/llm', { provider: 'custom', baseUrl: upstreamUrl })).status).toBe(200);
        expect((await adminCall('POST', '/platform-settings/llm/test', {})).status).toBe(200);
        expect(lastChatBody.chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(lastChatBody.reasoning_effort).toBe('low');

        // A provider with no known switch gets nothing, even with thinking off.
        expect((await adminCall('PUT', '/platform-settings/llm', { provider: 'lmstudio', baseUrl: upstreamUrl })).status).toBe(200);
        expect((await adminCall('POST', '/platform-settings/llm/test', {})).status).toBe(200);
        expect(lastChatBody).not.toHaveProperty('chat_template_kwargs');

        expect((await adminCall('PUT', '/platform-settings/llm', { provider: 'custom', baseUrl: upstreamUrl, thinking: 'on' })).status).toBe(200);
        expect((await adminCall('GET', '/platform-settings/llm')).json.thinking).toBe('on');
        expect((await adminCall('POST', '/platform-settings/llm/test', {})).status).toBe(200);
        expect(lastChatBody).not.toHaveProperty('chat_template_kwargs');
        expect(lastChatBody).not.toHaveProperty('reasoning_effort');
    });

    it('requires authentication', async () => {
        const { status } = await detect({ provider: 'lmstudio', baseUrl: upstreamUrl }, false);
        expect(status).toBe(401);
    });
});
