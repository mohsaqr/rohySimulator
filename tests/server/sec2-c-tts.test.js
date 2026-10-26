// Regression lock: security audit 2026-10-26, F-07 / L8-03 / L6-09 — POST
// /api/tts had no rate limit, no concurrency bound, no overall deadline, and
// its budget was check-then-record. Synthesis runs on this server's CPU, so
// one account could queue enough of it to stall voice for everyone.
//
// A fake Piper binary stands in for the engine: it sleeps for as many
// milliseconds as the text's leading number says, then writes PCM.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from '../utils/startTestServer.js';
import { asUser, closeDb, openDb, run, seedUser } from '../utils/authHttp.js';

const VOICE = 'en_US-amy-medium.onnx';
let server;
let fakePiper;
let fakeVoiceFile;
const users = {};

const speak = (call, text) => call('/api/tts', { method: 'POST', json: { text, voice: VOICE } });

beforeAll(async () => {
    fakePiper = path.join(os.tmpdir(), `rohy-sec2c-piper-${process.pid}`);
    // `-i <file>` carries the text; "<ms> words" sleeps <ms> first.
    fs.writeFileSync(fakePiper, `#!/usr/bin/env node
const fs = require('fs');
const i = process.argv.indexOf('-i');
const text = i > 0 ? fs.readFileSync(process.argv[i + 1], 'utf8') : '';
const ms = parseInt(text, 10) || 0;
setTimeout(() => { process.stdout.write(Buffer.alloc(2048)); }, ms);
`, { mode: 0o755 });
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const piperDir = path.join(repoRoot, 'server', 'data', 'piper');
    fs.mkdirSync(piperDir, { recursive: true });
    fakeVoiceFile = path.join(piperDir, VOICE);
    if (!fs.existsSync(fakeVoiceFile)) fs.writeFileSync(fakeVoiceFile, '');
    else fakeVoiceFile = null;   // a real voice is installed; leave it alone

    server = await startTestServer({
        env: {
            PIPER_BIN: fakePiper,
            ROHY_TTS_PER_USER_ACTIVE: '1',
            ROHY_TTS_PER_USER_QUEUED: '1',
            ROHY_TTS_RATE_PER_MIN: '10',
            ROHY_TTS_TIMEOUT_MS: '1500',
        },
    });
    const db = await openDb(server.dbPath);
    try {
        for (const name of ['t-queue', 't-rate', 't-slow', 't-budget']) await seedUser(db, { username: name, role: 'student' });
        await run(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES ('tts_provider', 'piper')`);
    } finally { await closeDb(db); }
    for (const name of ['t-queue', 't-rate', 't-slow', 't-budget']) users[name] = await asUser(server.baseUrl, name);
}, 120_000);

afterAll(async () => {
    if (server) await server.close();
    try { fs.unlinkSync(fakePiper); } catch { /* noop */ }
    if (fakeVoiceFile) { try { fs.unlinkSync(fakeVoiceFile); } catch { /* noop */ } }
});

describe('POST /api/tts is bounded', () => {
    // Regression lock: any number of concurrent syntheses per user were admitted (F-07)
    it('runs one, queues one, and refuses the third concurrent request from one user', async () => {
        const results = await Promise.all(['700 one', '700 two', '700 three'].map((t) => speak(users['t-queue'], t)
            .then(async (r) => ({ status: r.status, body: r.status === 200 ? null : await r.json() }))));
        expect(results.filter((r) => r.status === 200)).toHaveLength(2);
        const refused = results.filter((r) => r.status === 429);
        expect(refused).toHaveLength(1);
        expect(refused[0].body.code).toBe('tts_busy');
    });

    // Regression lock: /tts had no per-user request rate (F-07)
    it('limits requests per user per minute (ROHY_TTS_RATE_PER_MIN=10 here)', async () => {
        const statuses = [];
        for (let i = 0; i < 11; i += 1) statuses.push((await speak(users['t-rate'], `0 hello ${i}`)).status);
        expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
        expect(statuses[10]).toBe(429);
    });

    // Regression lock: a synthesis that never finished held the request for ever (F-07)
    it('answers 504 when the synthesis passes its deadline', async () => {
        const res = await speak(users['t-slow'], '4000 very slow');
        expect(res.status).toBe(504);
        expect((await res.json()).code).toBe('tts_timeout');
    }, 15_000);

    // Regression lock: the character budget was checked, then recorded, so parallel requests all passed (F-07)
    it('reserves characters atomically: of two concurrent requests that each fit, only one fits both', async () => {
        const db = await openDb(server.dbPath);
        try {
            await run(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES ('budget.tts.user.daily_characters', '30')`);
        } finally { await closeDb(db); }
        // 20 characters each: one fits under 30, both do not. The second waits
        // in the queue behind the first, so the check happens while the first
        // is still synthesising — exactly the overlap that used to pass.
        const text = '300 twenty chars....';
        expect(text).toHaveLength(20);
        const statuses = (await Promise.all([speak(users['t-budget'], text), speak(users['t-budget'], text)])).map((r) => r.status);
        expect(statuses.sort()).toEqual([200, 429]);
    });
});
