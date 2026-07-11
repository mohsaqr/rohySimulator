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

    beforeAll(async () => {
        // Stub "LM Studio": returns the OpenAI-compatible model-list shape.
        upstream = http.createServer((req, res) => {
            lastPath = req.url;
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

    it('requires authentication', async () => {
        const { status } = await detect({ provider: 'lmstudio', baseUrl: upstreamUrl }, false);
        expect(status).toBe(401);
    });
});
