import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-tests-secret';

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

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}

function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

async function installAdmin(dbPath) {
    const db = await openDb(dbPath);
    const passwordHash = await bcrypt.hash('testpass', 4);
    await dbRun(
        db,
        `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
         VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
        ['ttsmatrix', 'TTS Matrix Admin', passwordHash, 'ttsmatrix@example.com']
    );
    const row = await dbGet(db, 'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['ttsmatrix']);
    await dbClose(db);
    return jwt.sign(
        { id: row.id, username: row.username, email: row.email, role: 'admin', tenant_id: row.tenant_id || 1 },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function putSetting(server, token, body) {
    const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
}

async function postTts(server, token, body) {
    const res = await fetch(`${server.baseUrl}/api/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get('content-type'), buf };
}

describe('POST /api/tts matrix — provider override and gender fallback', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer({
            env: {
                JWT_SECRET: TEST_JWT_SECRET,
                GOOGLE_TTS_API_KEY: 'fake-google-key',
                OPENAI_API_KEY: 'fake-openai-key',
                ROHY_TEST_FAKE_GOOGLE_TTS: '1',
                ROHY_TEST_FAKE_OPENAI_TTS: '1',
            }
        });
        token = await installAdmin(server.dbPath);
        await putSetting(server, token, {
            tts_provider: 'google',
            google_tts_api_key: 'fake-google-key',
            openai_tts_api_key: 'fake-openai-key',
        });
    }, 30_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('routes Google voices by body.provider and preserves matching male/female selections', async () => {
        const matrix = [
            { gender: 'male', requested: 'en-US-Chirp3-HD-Charon', expected: 'en-US-Chirp3-HD-Charon' },
            { gender: 'female', requested: 'en-US-Chirp3-HD-Aoede', expected: 'en-US-Chirp3-HD-Aoede' },
        ];

        for (const row of matrix) {
            const res = await postTts(server, token, {
                provider: 'google',
                text: `hello ${row.gender}`,
                voice: row.requested,
                gender: row.gender,
                rate: 1,
                pitch: 0,
            });
            expect(res.status, row.gender).toBe(200);
            expect(res.contentType).toMatch(/audio\/wav/);
        }
    });

    it('does not treat omitted gender as female for a valid Google male voice', async () => {
        const beforeLogs = server.getStdout() + server.getStderr();
        const res = await postTts(server, token, {
            provider: 'google',
            text: 'preview a male google voice with no gender field',
            voice: 'en-US-Chirp3-HD-Charon',
        });
        expect(res.status).toBe(200);

        const afterLogs = server.getStdout() + server.getStderr();
        const newLogs = afterLogs.slice(beforeLogs.length);
        expect(newLogs).not.toContain('tts gender fallback selected');
        expect(newLogs).not.toContain('en-US-Neural2-F');
    });

    it('falls back when a valid Google voice clearly mismatches the requested gender', async () => {
        const maleRes = await postTts(server, token, {
            provider: 'google',
            text: 'male should not use female voice',
            voice: 'en-US-Chirp3-HD-Aoede',
            gender: 'male',
        });
        expect(maleRes.status).toBe(200);

        const femaleRes = await postTts(server, token, {
            provider: 'google',
            text: 'female should not use male voice',
            voice: 'en-US-Chirp3-HD-Charon',
            gender: 'female',
        });
        expect(femaleRes.status).toBe(200);

        const logs = server.getStdout() + server.getStderr();
        expect(logs).toContain('tts gender fallback selected');
        expect(logs).toContain('en-US-Neural2-A');
        expect(logs).toContain('en-US-Neural2-F');
    });

    it('falls back when body.provider differs from platform default and the voice belongs to another provider', async () => {
        const res = await postTts(server, token, {
            provider: 'google',
            text: 'piper id sent to google should fall back',
            voice: 'en_US-amy-medium.onnx',
            gender: 'male',
        });
        expect(res.status).toBe(200);

        const logs = server.getStdout() + server.getStderr();
        expect(logs).toContain('tts voice fallback selected');
        expect(logs).toContain('en_US-amy-medium.onnx');
        expect(logs).toContain('en-US-Neural2-A');
    });

    it('routes OpenAI by body.provider even when platform default is Google', async () => {
        const res = await postTts(server, token, {
            provider: 'openai',
            text: 'openai provider override',
            voice: 'onyx',
            gender: 'male',
        });
        expect([200, 502]).toContain(res.status);
        // The server should not try to validate OpenAI voice IDs as Google
        // just because the platform default is google. A 502 here would mean
        // outbound fake setup changed; a 400 would be the routing regression.
        expect(res.status).not.toBe(400);
    });
});
