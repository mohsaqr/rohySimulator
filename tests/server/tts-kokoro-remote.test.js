// Remote Kokoro through the real /api/tts route, and its admin settings.
//
// kokoroTts.test.js locks the service in isolation; this file proves the
// wiring end to end: a server started with ROHY_KOKORO_URL speaks a Kokoro
// voice by calling the remote host (one request per sentence, pcm, bearer
// key) and frames the result as application/x-rohy-pcm-stream, exactly what
// voiceService.js reads. The "remote host" is a local HTTP stub, so the test
// runs offline and never loads the real model.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { startTestServer } from '../utils/startTestServer.js';
import { mintToken, recordSession } from '../utils/authHttp.js';

const TEST_JWT_SECRET = 'rohy-tests-secret';
const REMOTE_KEY = 'remote-test-key';

// Parse [4 LE sampleRate] then repeated [4 LE len][len bytes] until len 0.
function parsePcmStream(buf) {
    const sampleRate = buf.readUInt32LE(0);
    const frames = [];
    let off = 4;
    while (off + 4 <= buf.length) {
        const len = buf.readUInt32LE(off);
        off += 4;
        if (len === 0) return { sampleRate, frames, eof: true };
        frames.push(buf.subarray(off, off + len));
        off += len;
    }
    return { sampleRate, frames, eof: false };
}

describe('POST /api/tts with ROHY_KOKORO_URL (live server, stub remote host)', () => {
    let remote;
    let remoteRequests = [];
    let server;
    let token;

    beforeAll(async () => {
        // The stub answers each sentence with PCM whose every byte is the
        // sentence length, so the test can tell sentences apart in order.
        remote = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                const body = JSON.parse(raw);
                remoteRequests.push({ path: req.url, auth: req.headers.authorization, body });
                res.writeHead(200, { 'Content-Type': 'audio/pcm' });
                res.end(Buffer.alloc(200, body.input.length));
            });
        });
        await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
        const { port } = remote.address();

        server = await startTestServer({
            env: {
                JWT_SECRET: TEST_JWT_SECRET,
                ROHY_KOKORO_URL: `http://127.0.0.1:${port}/v1`,
                ROHY_KOKORO_API_KEY: REMOTE_KEY,
            },
        });

        const db = await new Promise((resolve, reject) => {
            const d = new (sqlite3.verbose().Database)(server.dbPath, (err) => (err ? reject(err) : resolve(d)));
        });
        const passwordHash = await bcrypt.hash('testpass', 4);
        const row = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES ('kstudent', 'Kokoro Student', ?, 'kstudent@example.com', 'student', 'active', 1)`,
                [passwordHash],
                function done(err) { return err ? reject(err) : resolve({ id: this.lastID }); },
            );
        });
        await new Promise((resolve) => db.close(() => resolve()));
        token = jwt.sign(
            { id: row.id, username: 'kstudent', email: 'kstudent@example.com', role: 'student', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' },
        );
        // authenticateToken fails closed on a token with no active_sessions row.
        await recordSession(server.dbPath, token, { userId: row.id });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        if (remote) await new Promise((resolve) => remote.close(resolve));
    });

    async function tts(path, body) {
        remoteRequests = [];
        const res = await fetch(`${server.baseUrl}/api${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        return { res, buf: Buffer.from(await res.arrayBuffer()) };
    }

    it('streams one framed chunk per sentence, synthesized remotely with the key', async () => {
        const { res, buf } = await tts('/tts?stream=1', { text: 'Hello doctor. It hurts!', voice: 'am_michael' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/x-rohy-pcm-stream');
        const { sampleRate, frames, eof } = parsePcmStream(buf);
        expect(sampleRate).toBe(24000);
        expect(eof).toBe(true);
        expect(frames.map((f) => [f.length, f[0]])).toEqual([[200, 'Hello doctor.'.length], [200, 'It hurts!'.length]]);
        expect(remoteRequests).toEqual([
            { path: '/v1/audio/speech', auth: `Bearer ${REMOTE_KEY}`, body: { model: 'kokoro', voice: 'am_michael', input: 'Hello doctor.', response_format: 'pcm', speed: 1 } },
            { path: '/v1/audio/speech', auth: `Bearer ${REMOTE_KEY}`, body: { model: 'kokoro', voice: 'am_michael', input: 'It hurts!', response_format: 'pcm', speed: 1 } },
        ]);
    });

    it('serves the non-streaming path as a 24 kHz WAV from one remote request', async () => {
        const { res, buf } = await tts('/tts', { text: 'Is it serious?', voice: 'bf_emma' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('audio/wav');
        expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(buf.readUInt32LE(24)).toBe(24000);
        expect(buf.length).toBe(44 + 200);
        expect(remoteRequests).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// The remote host set from Settings → Voice: GET/PUT /platform-settings/voice
// and POST /platform-settings/voice/kokoro-remote/test. The server starts with
// an env-file KEY but no env URL, so the test can prove that key never goes to
// a URL an admin typed in.
// ---------------------------------------------------------------------------

describe('remote Kokoro from Settings → Voice (live server)', () => {
    const ENV_SECRET = 'env-file-secret-key';
    const SAVED_KEY = 'saved-in-settings-key';
    let remote;
    let remoteRequests = [];
    let remoteStatus = 200;
    let remoteUrl;
    let server;
    let adminToken;
    let studentToken;
    let dbPath;

    function openDb() {
        return new Promise((resolve, reject) => {
            const d = new (sqlite3.verbose().Database)(dbPath, (err) => (err ? reject(err) : resolve(d)));
        });
    }
    const dbAll = (db, sql, params = []) => new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

    async function addUser(username, role) {
        const db = await openDb();
        const passwordHash = await bcrypt.hash('testpass', 4);
        const id = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [username, username, passwordHash, `${username}@example.com`, role],
                function done(err) { return err ? reject(err) : resolve(this.lastID); },
            );
        });
        await new Promise((resolve) => db.close(() => resolve()));
        // mintToken signs AND records the active_sessions row authenticateToken requires.
        return mintToken(dbPath, { id, username, email: `${username}@example.com`, role, tenant_id: 1 }, TEST_JWT_SECRET);
    }

    async function call(method, path, token, body) {
        const res = await fetch(`${server.baseUrl}/api${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: res.status, json, text };
    }

    beforeAll(async () => {
        remote = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                remoteRequests.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
                if (remoteStatus !== 200) {
                    res.writeHead(remoteStatus, { 'Content-Type': 'application/json' });
                    res.end('{"error":"stub host private detail"}');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'audio/pcm' });
                res.end(Buffer.alloc(4800, 1));
            });
        });
        await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
        remoteUrl = `http://127.0.0.1:${remote.address().port}/v1`;

        server = await startTestServer({
            // ROHY_KOKORO_URL pinned empty: dotenv never overrides a set
            // variable, so a developer's own server/.env cannot leak a URL in.
            env: { JWT_SECRET: TEST_JWT_SECRET, ROHY_KOKORO_URL: '', ROHY_KOKORO_API_KEY: ENV_SECRET },
        });
        dbPath = server.dbPath;
        adminToken = await addUser('kadmin', 'admin');
        studentToken = await addUser('kstudent2', 'student');
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        if (remote) await new Promise((resolve) => remote.close(resolve));
    });

    it('starts local, and shows the remote fields to admins only', async () => {
        const asAdmin = await call('GET', '/platform-settings/voice', adminToken);
        expect(asAdmin.status).toBe(200);
        expect(asAdmin.json).toMatchObject({
            kokoro_remote_url: '',
            kokoro_remote_api_key_set: false, // the env key has no env URL to go with
            kokoro_remote: { enabled: false, source: null, host: null },
        });
        const asStudent = await call('GET', '/platform-settings/voice', studentToken);
        expect(asStudent.status).toBe(200);
        expect(Object.keys(asStudent.json).filter((k) => k.startsWith('kokoro_remote'))).toEqual([]);
    });

    it('refuses an unacceptable URL and saves nothing', async () => {
        for (const bad of ['ftp://h/v1', 'not a url', 'https://u:p@h/v1', 'https://h/v1?k=1', 42]) {
            const res = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_url: bad });
            expect(res.status).toBe(400);
            expect(res.json.error).toMatch(/kokoro_remote_url/);
        }
        const res = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_api_key: 'has space' });
        expect(res.status).toBe(400);
        expect((await call('GET', '/platform-settings/voice', adminToken)).json.kokoro_remote.enabled).toBe(false);
    });

    it('a student cannot save or test the remote host', async () => {
        expect((await call('PUT', '/platform-settings/voice', studentToken, { kokoro_remote_url: remoteUrl })).status).toBe(403);
        expect((await call('POST', '/platform-settings/voice/kokoro-remote/test', studentToken, {})).status).toBe(403);
    });

    it('testing with nothing configured is a 400 not_configured', async () => {
        const res = await call('POST', '/platform-settings/voice/kokoro-remote/test', adminToken, {});
        expect(res.status).toBe(400);
        expect(res.json.code).toBe('not_configured');
    });

    it('a saved URL alone is used at once — and the env-file key is never sent to it', async () => {
        const put = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_url: `${remoteUrl}/` });
        expect(put.status).toBe(200);
        const got = (await call('GET', '/platform-settings/voice', adminToken)).json;
        expect(got.kokoro_remote_url).toBe(remoteUrl); // trailing slash normalized away
        expect(got.kokoro_remote).toMatchObject({ enabled: true, source: 'settings', key_set: false });

        remoteRequests = [];
        const res = await fetch(`${server.baseUrl}/api/tts?stream=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ text: 'Hello doctor.', voice: 'am_michael' }),
        });
        expect(res.status).toBe(200);
        await res.arrayBuffer();
        expect(remoteRequests).toHaveLength(1);
        expect(remoteRequests[0].auth || '').not.toContain(ENV_SECRET);
    });

    it('a saved key is used without a restart, is never returned, and is redacted in the audit chain and settings list', async () => {
        const put = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_api_key: SAVED_KEY });
        expect(put.status).toBe(200);

        const got = await call('GET', '/platform-settings/voice', adminToken);
        expect(got.json).toMatchObject({ kokoro_remote_api_key_set: true, kokoro_remote_api_key_via_env: false, kokoro_remote: { key_set: true } });
        expect(got.text).not.toContain(SAVED_KEY);

        remoteRequests = [];
        const res = await fetch(`${server.baseUrl}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ text: 'Is it serious?', voice: 'bf_emma' }),
        });
        expect(res.status).toBe(200);
        expect(remoteRequests[0].auth).toBe(`Bearer ${SAVED_KEY}`);

        const list = await call('GET', '/platform-settings', adminToken);
        expect(list.status).toBe(200);
        expect(list.text).not.toContain(SAVED_KEY);

        const db = await openDb();
        let rows = [];
        for (let i = 0; i < 40 && rows.length === 0; i++) {
            rows = await dbAll(db, "SELECT old_value, new_value FROM system_audit_log WHERE resource_id = 'kokoro_remote_api_key'");
            if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((resolve) => db.close(() => resolve()));
        expect(rows.length).toBeGreaterThan(0);
        expect(JSON.stringify(rows)).not.toContain(SAVED_KEY);
    });

    // Regression lock: production 2026-10-25 — a remote key the host refused
    // (HTTP 403 "model not available for this API key") was "saved
    // successfully"; every reply then fell back to local CPU synthesis and
    // nothing on the Voice card said so. A save now verifies the pair with one
    // real synthesis, like the cloud keys: still saved, but the response warns
    // and the card remembers the failure.
    it('saving a key the host refuses is saved but warned about, and the card shows the failure', async () => {
        remoteStatus = 403;
        remoteRequests = [];
        const put = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_api_key: 'refused-key' });
        remoteStatus = 200;
        expect(put.status).toBe(200);
        expect(put.json.kokoro_remote_test).toMatchObject({ ok: false, kind: 'http', status: 403, host: new URL(remoteUrl).host });
        expect(put.json.warnings.join(' ')).toMatch(/Remote Kokoro host .* refused the API key \(HTTP 403\)/);
        expect(put.text).not.toContain('refused-key');
        expect(remoteRequests).toHaveLength(1); // the probe, with the key just saved
        expect(remoteRequests[0].auth).toBe('Bearer refused-key');

        const card = (await call('GET', '/platform-settings/voice', adminToken)).json.kokoro_remote;
        expect(card).toMatchObject({ enabled: true, key_set: true, failures: 0, paused: false });
        expect(card.last_error).toMatchObject({ kind: 'http', status: 403 });

        // Saving a key the host accepts clears the warning and the card's error.
        remoteRequests = [];
        const ok = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_api_key: SAVED_KEY });
        expect(ok.status).toBe(200);
        expect(ok.json.kokoro_remote_test).toMatchObject({ ok: true });
        expect(ok.json.warnings ?? []).toEqual([]);
        expect((await call('GET', '/platform-settings/voice', adminToken)).json.kokoro_remote.last_error).toBeNull();
    });

    it('the test endpoint speaks one sentence from the saved host', async () => {
        remoteStatus = 200;
        remoteRequests = [];
        const res = await call('POST', '/platform-settings/voice/kokoro-remote/test', adminToken, {});
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ ok: true, host: new URL(remoteUrl).host, audio_seconds: 0.1 });
        expect(remoteRequests).toHaveLength(1);
        expect(remoteRequests[0].auth).toBe(`Bearer ${SAVED_KEY}`);
    });

    it('a refused key is reported as such — with no local fallback and no host body in the reply', async () => {
        remoteStatus = 401;
        const res = await call('POST', '/platform-settings/voice/kokoro-remote/test', adminToken, {});
        remoteStatus = 200;
        expect(res.status).toBe(502);
        expect(res.json).toMatchObject({ code: 'remote_http', status: 401 });
        expect(res.json.error).toMatch(/refused the API key/);
        expect(res.text).not.toContain('stub host private detail');
    });

    it('clearing the URL returns to local synthesis', async () => {
        const put = await call('PUT', '/platform-settings/voice', adminToken, { kokoro_remote_url: '' });
        expect(put.status).toBe(200);
        const got = (await call('GET', '/platform-settings/voice', adminToken)).json;
        expect(got.kokoro_remote_url).toBe('');
        expect(got.kokoro_remote.enabled).toBe(false);
    });
});
