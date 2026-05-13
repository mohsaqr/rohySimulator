import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-proxy-budget-secret';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

function startLlmServer() {
    const server = http.createServer((req, res) => {
        if (req.method !== 'POST') {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

describe('proxy budget enforcement', () => {
    let server;
    let llmServer;
    let token;
    let fakeVoiceFile;

    beforeAll(async () => {
        const fakePiper = path.join(os.tmpdir(), `rohy-fake-piper-${process.pid}`);
        fs.writeFileSync(fakePiper, '#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(2048));\n', { mode: 0o755 });
        // The /api/tts piper path checks that the requested voice file lives
        // under server/data/piper/ before it spawns Piper. CI runs against a
        // bare Piper directory (no .onnx voices shipped — they're downloaded
        // by install-piper.sh, opt-in) so the validator rejects the test
        // voice with 400 "unknown voice" before any budget logic runs.
        // Drop a stub file at the expected path; remove it in afterAll.
        const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
        const piperDir = path.join(repoRoot, 'server', 'data', 'piper');
        fs.mkdirSync(piperDir, { recursive: true });
        fakeVoiceFile = path.join(piperDir, 'en_US-amy-medium.onnx');
        if (!fs.existsSync(fakeVoiceFile)) {
            fs.writeFileSync(fakeVoiceFile, '');
        } else {
            // Real voice file already present (local dev). Leave it alone;
            // null the cleanup so we don't delete the operator's install.
            fakeVoiceFile = null;
        }
        llmServer = await startLlmServer();
        server = await startTestServer({
            env: {
                JWT_SECRET: TEST_JWT_SECRET,
                PIPER_BIN: fakePiper,
            },
        });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['budgetadmin', 'Budget Admin', passwordHash, 'budgetadmin@example.com']
        );
        const user = await new Promise((resolve, reject) =>
            db.get('SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['budgetadmin'], (err, row) => err ? reject(err) : resolve(row))
        );
        token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );
        // INSERT OR REPLACE so the test always wins on keys that the server
        // may pre-seed (e.g. tts_provider, which the boot path now writes
        // 'kokoro' into via setSettingIfEmpty on first run).
        await dbRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
            ('llm_enabled', 'true'),
            ('llm_provider', 'custom'),
            ('llm_base_url', ?),
            ('llm_model', 'test-model'),
            ('budget.llm.user.daily_tokens', '10000'),
            ('budget.tts.user.daily_characters', '1000'),
            ('tts_provider', 'piper')`, [llmServer.baseUrl]);
        await dbClose(db);
    }, 30_000);

    afterAll(async () => {
        if (server) await server.close();
        if (llmServer) await llmServer.close();
        if (fakeVoiceFile) {
            try { fs.unlinkSync(fakeVoiceFile); } catch { /* noop */ }
        }
    });

    async function setSetting(key, value) {
        const db = await openDb(server.dbPath);
        await dbRun(
            db,
            `INSERT INTO platform_settings (setting_key, setting_value)
             VALUES (?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
            [key, value]
        );
        await dbClose(db);
    }

    it('allows an under-limit LLM proxy call and records actual tokens', async () => {
        const res = await fetch(`${server.baseUrl}/api/proxy/llm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.usage.total_tokens).toBe(15);
    });

    it('rejects an over-limit LLM proxy call with budget_exceeded', async () => {
        await setSetting('budget.llm.user.daily_tokens', '1');
        const res = await fetch(`${server.baseUrl}/api/proxy/llm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        });
        expect(res.status).toBe(429);
        expect(await res.json()).toMatchObject({ error: 'Budget exceeded', budget_exceeded: true, limit: 1 });
        await setSetting('budget.llm.user.daily_tokens', '10000');
    });

    it('allows under-limit TTS and rejects over-limit TTS with the same shape', async () => {
        const ok = await fetch(`${server.baseUrl}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text: 'hello', voice: 'en_US-amy-medium.onnx' }),
        });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('content-type')).toContain('audio/wav');

        await setSetting('budget.tts.user.daily_characters', '1');
        const blocked = await fetch(`${server.baseUrl}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text: 'hello', voice: 'en_US-amy-medium.onnx' }),
        });
        expect(blocked.status).toBe(429);
        expect(await blocked.json()).toMatchObject({ error: 'Budget exceeded', budget_exceeded: true, limit: 1 });
    });
});
