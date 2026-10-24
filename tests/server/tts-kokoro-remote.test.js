// Remote Kokoro through the real /api/tts route.
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
