// Voice 2.0 v1.4 routing matrix (VOICE2_PLAN.md — sovereignty semantics).
//
// CONTRACT REWRITE (2026-07, twice): first from the single-active-provider
// rule to Voice 2.0 (the voice owns its engine), then to v1.4 sovereignty
// (owner: "the case sound reigns supreme"). The assertions below are the
// current truth obligations:
//
//   - a voice plays on its own (derived) engine — mixed engines in one
//     session are legal; body provider fields are ignored;
//   - A CONFIGURED VOICE IS LITERAL: if its engine is unusable (disabled /
//     unkeyed / not installed) or the id is in no catalogue, the request
//     fails with an HONEST 400 — the server never substitutes, even when
//     per-language defaults exist (those are a client-side tier for
//     speakers with no voice configured at all);
//   - a PAID engine failing at request time is an honest upstream error
//     (502) on both the WAV and streaming paths — the first-chunk
//     pre-flight keeps the response uncommitted so the client gets JSON,
//     not a dead stream;
//   - /tts/preview has identical literal-or-error semantics;
//   - /tts/voice-usage names which cases/personas rely on each engine
//     (feeds the engine-off impact modal).

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

async function putVoiceSettings(server, token, body, expectedStatus = 200) {
    const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    expect(res.status, JSON.stringify(json)).toBe(expectedStatus);
    return json;
}

async function getVoiceSettings(server, token) {
    const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return res.json();
}

async function postTts(server, token, body, { path = '/api/tts', accept } = {}) {
    const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(accept ? { Accept: accept } : {}),
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        buf,
        json: () => JSON.parse(buf.toString('utf8')),
    };
}

const TEXT = 'Hello there, this is a synthesis test.';

describe('POST /api/tts — the voice owns its engine, and is literal', () => {
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
                ROHY_TEST_FAKE_KOKORO_TTS: '1',
            }
        });
        token = await installAdmin(server.dbPath);
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('plays a google voice on google — no platform setting involved', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede' });
        expect(out.status).toBe(200);
        expect(out.contentType).toContain('audio/wav');
    });

    it('plays a kokoro voice in the same session (mixed engines are legal)', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'af_bella' });
        expect(out.status).toBe(200);
        expect(out.contentType).toContain('audio/wav');
    });

    it('plays a German google voice directly while google is usable', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'de-DE-Chirp3-HD-Kore' });
        expect(out.status).toBe(200);
    });

    it('ignores a body provider on the main route (server routes, client cannot force an engine)', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'af_bella', provider: 'google' });
        expect(out.status).toBe(200); // played by kokoro (derived), not rejected by google
    });

    describe('with google disabled in settings (policy toggle)', () => {
        beforeAll(async () => {
            await putVoiceSettings(server, token, { tts_provider_enabled_google: false });
        });
        afterAll(async () => {
            await putVoiceSettings(server, token, { tts_provider_enabled_google: true });
        });

        it('a google voice fails with an honest 400 — the en default does NOT stand in', async () => {
            const out = await postTts(server, token, { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede' });
            expect(out.status).toBe(400);
            const body = out.json();
            expect(body.reason).toBe('engine_unusable');
            expect(body.provider).toBe('google');
            expect(body.detail).toMatch(/disabled in settings/);
        });

        it('a German google voice fails identically — even with a de default configured', async () => {
            await putVoiceSettings(server, token, { tts_default_voice_de: 'alloy' });
            const out = await postTts(server, token, { text: TEXT, voice: 'de-DE-Chirp3-HD-Kore' });
            expect(out.status).toBe(400);
            expect(out.json().reason).toBe('engine_unusable');
            await putVoiceSettings(server, token, { tts_default_voice_de: '' });
        });

        it('streaming path: the 400 arrives as JSON, not a dead PCM stream', async () => {
            const out = await postTts(server, token,
                { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede' },
                { accept: 'application/x-rohy-pcm-stream' });
            expect(out.status).toBe(400);
            expect(out.contentType).toContain('application/json');
        });

        it('/tts/preview keeps literal semantics: the disabled engine still auditions', async () => {
            // Preview exists so an admin can hear a voice before enabling its
            // engine; capability (the key) is present, so it plays.
            const out = await postTts(server, token,
                { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede', provider: 'google' },
                { path: '/api/tts/preview' });
            expect(out.status).toBe(200);
        });
    });

    it('a voice in no catalogue is an honest 400, even though defaults exist', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'notavoiceanywhere' });
        expect(out.status).toBe(400);
        const body = out.json();
        expect(body.reason).toBe('unknown_voice');
    });

    it('preview of a nowhere-voice is a 400', async () => {
        const out = await postTts(server, token,
            { text: TEXT, voice: 'notavoiceanywhere' },
            { path: '/api/tts/preview' });
        expect(out.status).toBe(400);
    });

    describe('settings endpoint (Voice 2.0 keys)', () => {
        it('GET exposes providers status, seeded defaults, and enable toggles', async () => {
            const s = await getVoiceSettings(server, token);
            expect(s.tts_default_voice_en).toBe('af_bella');   // boot seed
            // Unseeded on purpose: kokoro's runtime map is English-only
            // (the Italian .bin pack is not synthesizable), and Piper files
            // can't be assumed — the boot audit names each gap instead.
            expect(s.tts_default_voice_it).toBe(null);
            expect(s.tts_default_voice_de).toBe(null);
            expect(s.tts_provider_enabled_google).toBe(true);
            expect(Array.isArray(s.providers)).toBe(true);
            const ids = s.providers.map(p => p.id).sort();
            expect(ids).toEqual(['google', 'kokoro', 'openai', 'piper']);
            for (const p of s.providers) {
                expect(p).toHaveProperty('capable');
                expect(p).toHaveProperty('enabled');
                expect(p).toHaveProperty('usable');
            }
            expect('tts_provider' in s).toBe(false); // the engine setting is gone
        });

        it('a saved default survives GET-after-PUT (the silent-drop trap)', async () => {
            await putVoiceSettings(server, token, { tts_default_voice_en: 'en-US-Chirp3-HD-Aoede' });
            let s = await getVoiceSettings(server, token);
            expect(s.tts_default_voice_en).toBe('en-US-Chirp3-HD-Aoede');
            await putVoiceSettings(server, token, { tts_default_voice_en: 'af_bella' }); // restore
            s = await getVoiceSettings(server, token);
            expect(s.tts_default_voice_en).toBe('af_bella');
        });

        it('rejects a default that provably speaks the wrong language', async () => {
            const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ tts_default_voice_de: 'af_bella' }),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/does not speak/);
        });

        it('rejects a default that is in no catalogue', async () => {
            const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ tts_default_voice_en: 'notavoiceanywhere' }),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/no provider's catalogue/);
        });

        it('rejects the retired keys loudly (tts_provider, slots, gendered defaults)', async () => {
            for (const retired of [
                { tts_provider: 'google' },
                { voice_google_female: 'en-US-Chirp3-HD-Aoede' },
                { default_voice_kokoro_female: 'af_bella' },
            ]) {
                const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(retired),
                });
                expect(res.status, JSON.stringify(retired)).toBe(400);
                expect((await res.json()).error).toMatch(/Unknown setting/);
            }
        });

        it('enable toggles must be boolean', async () => {
            const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ tts_provider_enabled_google: 'yes' }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/tts/voices (all-providers catalogue)', () => {
        it('default response groups every provider with usability + voices', async () => {
            const res = await fetch(`${server.baseUrl}/api/tts/voices`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.providers)).toBe(true);
            const byId = Object.fromEntries(body.providers.map(p => [p.id, p]));
            expect(byId.google.usable).toBe(true); // env key present
            expect(byId.google.voices.length).toBeGreaterThan(10);
            // kokoro lists its USABLE catalogue without a model load —
            // af_bella yes; the unsynthesizable Italian .bin pack, no.
            const kokoroIds = byId.kokoro.voices.map(v => v.filename);
            expect(kokoroIds).toContain('af_bella');
            expect(kokoroIds).not.toContain('if_sara');
            expect(byId.piper).toBeDefined(); // present even when not usable, with a reason
        });

        it('?provider= keeps the single-provider shape', async () => {
            const res = await fetch(`${server.baseUrl}/api/tts/voices?provider=openai`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await res.json();
            expect(body.provider).toBe('openai');
            expect(body.voices.map(v => v.filename)).toContain('alloy');
        });
    });

    describe('GET /api/tts/voice-usage (the engine-off blast radius)', () => {
        beforeAll(async () => {
            const db = await openDb(server.dbPath);
            await dbRun(db,
                `INSERT INTO cases (name, config, created_by) VALUES (?, ?, 1)`,
                ['Google-voiced case', JSON.stringify({ voice: { case_voice: 'en-US-Chirp3-HD-Aoede' } })]);
            await dbRun(db,
                `INSERT INTO agent_templates (agent_type, name, system_prompt, config) VALUES (?, ?, ?, ?)`,
                ['nurse2', 'Kokoro Persona', 'You are a nurse.', JSON.stringify({ voice: { case_voice: 'af_sky' } })]);
            await dbClose(db);
        });

        it('groups cases/personas by the DERIVED engine of their stored voice', async () => {
            const res = await fetch(`${server.baseUrl}/api/tts/voice-usage`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            const googleNames = body.providers.google.map(e => e.name);
            expect(googleNames).toContain('Google-voiced case');
            const kokoroNames = body.providers.kokoro.map(e => e.name);
            expect(kokoroNames).toContain('Kokoro Persona');
            const entry = body.providers.google.find(e => e.name === 'Google-voiced case');
            expect(entry.kind).toBe('case');
            expect(entry.voice).toBe('en-US-Chirp3-HD-Aoede');
        });

        it('requires auth', async () => {
            const res = await fetch(`${server.baseUrl}/api/tts/voice-usage`);
            expect([401, 403]).toContain(res.status);
        });
    });
});

describe('POST /api/tts — runtime paid-engine failure is an honest error', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer({
            env: {
                JWT_SECRET: TEST_JWT_SECRET,
                GOOGLE_TTS_API_KEY: 'fake-google-key',
                OPENAI_API_KEY: 'fake-openai-key',
                ROHY_TEST_FAIL_GOOGLE_TTS: '1',   // google dies at request time
                ROHY_TEST_FAKE_OPENAI_TTS: '1',
                ROHY_TEST_FAKE_KOKORO_TTS: '1',
            }
        });
        token = await installAdmin(server.dbPath);
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('WAV path: google outage → 502, never a stand-in (the voice is literal)', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede' });
        expect(out.status).toBe(502);
        expect(out.contentType).toContain('application/json');
    });

    it('streaming path: first-chunk pre-flight turns the outage into JSON, not a dead stream', async () => {
        const out = await postTts(server, token,
            { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede' },
            { accept: 'application/x-rohy-pcm-stream' });
        expect(out.status).toBe(502);
        expect(out.contentType).toContain('application/json');
    });

    it('an Italian google voice with an it default configured STILL errors — sovereignty', async () => {
        await putVoiceSettings(server, token, { tts_default_voice_it: 'alloy' });
        const out = await postTts(server, token, { text: TEXT, voice: 'it-IT-Chirp3-HD-Kore' });
        expect(out.status).toBe(502);
    });

    it('preview surfaces the outage literally too', async () => {
        const out = await postTts(server, token,
            { text: TEXT, voice: 'en-US-Chirp3-HD-Aoede', provider: 'google' },
            { path: '/api/tts/preview' });
        expect(out.status).toBe(502);
    });

    it('kokoro voices keep playing while google is down (mixed engines isolate failures)', async () => {
        const out = await postTts(server, token, { text: TEXT, voice: 'af_bella' });
        expect(out.status).toBe(200);
    });
});
