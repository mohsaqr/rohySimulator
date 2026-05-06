// Server-side TTS pitch contract tests.
//
// Locks down the wire format introduced in commit bb34d88, which moved the
// platform's `tts_pitch` units from a 0.5-1.5 multiplier to Google's
// semitone scale (-10..+10). Three concerns:
//
//   Block A — `synthesizeGoogleStream` actually forwards the pitch value to
//             `audioConfig.pitch` on the Google REST request, with the
//             documented clamp/zero-omission semantics.
//   Block B — `PUT /api/platform-settings/voice` validates `tts_pitch`
//             against the new range and rejects out-of-range values.
//   Block C — `PUT /api/platform-settings/avatars` validates the per-gender
//             `default_pitch_<gender>` keys against the same range.
//
// Approach picked (hybrid):
//   - Block A: direct unit test against `synthesizeGoogleStream` with
//     `globalThis.fetch` stubbed via `vi.stubGlobal`. Lets us inspect the
//     literal JSON body that would be sent to texttospeech.googleapis.com
//     without spinning up Google or even an Express app. Cleanest possible
//     contract test.
//   - Blocks B/C: spawn the real server via `startTestServer` (matches the
//     scripts/audit-*.sh pattern) and authenticate by directly inserting an
//     admin row + signing a JWT with the test secret. We avoid going through
//     /auth/login to dodge the rate limiter and bcrypt round-trip; the test
//     is about validation, not the login flow.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { synthesizeGoogleStream } from '../../server/services/googleTts.js';
import { startTestServer } from '../utils/startTestServer.js';

// ---------------------------------------------------------------------------
// Block A — pitch reaches Google audioConfig
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — pitch reaches Google audioConfig', () => {
    let capturedBody;

    // Build a minimal valid Google response. Service requires `audioContent`
    // (base64). We don't need real audio bytes; 64 zero bytes is enough to
    // satisfy the > 44 byte / RIFF / yield logic.
    function makeGoogleResponse() {
        const audioContent = Buffer.alloc(64).toString('base64');
        return {
            ok: true,
            status: 200,
            json: async () => ({ audioContent }),
        };
    }

    beforeEach(() => {
        capturedBody = null;
        const fakeFetch = vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        });
        vi.stubGlobal('fetch', fakeFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function drain(gen) {
        for await (const _chunk of gen) {
            void _chunk;
        }
    }

    it('forwards pitch=5 through to audioConfig.pitch === 5', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 5,
            apiKey: 'fake',
        }));
        expect(capturedBody).toBeTruthy();
        expect(capturedBody.audioConfig.pitch).toBe(5);
    });

    it('clamps pitch=50 to upper bound (audioConfig.pitch === 10)', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 50,
            apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.pitch).toBe(10);
    });

    it('clamps pitch=-50 to lower bound (audioConfig.pitch === -10)', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: -50,
            apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.pitch).toBe(-10);
    });

    it('omits audioConfig.pitch when pitch=0 (zero is the no-op default)', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 0,
            apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig).toBeTruthy();
        expect('pitch' in capturedBody.audioConfig).toBe(false);
    });

    it('omits audioConfig.pitch when pitch is unset', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            apiKey: 'fake',
        }));
        expect('pitch' in capturedBody.audioConfig).toBe(false);
    });

    it('omits audioConfig.pitch when pitch is non-numeric', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 'not-a-number',
            apiKey: 'fake',
        }));
        expect('pitch' in capturedBody.audioConfig).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Blocks B & C — platform-settings validation against the live Express handler
// ---------------------------------------------------------------------------
//
// We spawn the real server (matching the audit-*.sh pattern) so the
// validation logic, audit logging, and platform_settings persistence are all
// exercised exactly as they ship. Auth is short-circuited by inserting an
// admin row directly into the spawned DB and signing a JWT with the same
// secret startTestServer hands to the child.

describe('platform-settings pitch validation (live server)', () => {
    let server;
    let token;
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

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        // Insert an admin user we can authenticate as. We open the DB
        // directly rather than going through /auth/login so the test isn't
        // sensitive to bcrypt cost or the auth rate limiter, and so a
        // login-flow regression in another phase doesn't take us down.
        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['ttsadmin', 'TTS Test Admin', passwordHash, 'ttsadmin@example.com']
        );
        const row = await dbGet(db, 'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['ttsadmin']);
        await dbClose(db);

        token = jwt.sign(
            { id: row.id, username: row.username, email: row.email, role: 'admin', tenant_id: row.tenant_id || 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );
    }, 30_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    async function putVoice(body) {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* not json */ }
        return { status: res.status, json };
    }

    async function putAvatars(body) {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/avatars`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* not json */ }
        return { status: res.status, json };
    }

    async function getVoiceSetting(key) {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/voice`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const j = await res.json();
        return j[key];
    }

    // -----------------------------------------------------------------------
    // Block B — /platform-settings/voice tts_pitch validation
    // -----------------------------------------------------------------------

    it('PUT /platform-settings/voice with tts_pitch=5 returns 200 and persists', async () => {
        const { status, json } = await putVoice({ tts_pitch: 5 });
        expect(status).toBe(200);
        expect(json.message).toMatch(/updated/i);
        const persisted = await getVoiceSetting('tts_pitch');
        // Stored as float; route's GET coerces to number.
        expect(Number(persisted)).toBe(5);
    });

    it('PUT /platform-settings/voice with tts_pitch=11 returns 400 mentioning the [-10, 10] range', async () => {
        const { status, json } = await putVoice({ tts_pitch: 11 });
        expect(status).toBe(400);
        expect(json.error).toMatch(/-10/);
        expect(json.error).toMatch(/10/);
        expect(json.error.toLowerCase()).toContain('tts_pitch');
    });

    it('PUT /platform-settings/voice with tts_pitch=-11 returns 400', async () => {
        const { status, json } = await putVoice({ tts_pitch: -11 });
        expect(status).toBe(400);
        expect(json.error).toMatch(/-10/);
    });

    it('PUT /platform-settings/voice with tts_pitch="abc" returns 400', async () => {
        const { status, json } = await putVoice({ tts_pitch: 'abc' });
        expect(status).toBe(400);
        expect(json.error.toLowerCase()).toContain('tts_pitch');
    });

    it('PUT /platform-settings/voice with tts_pitch=0 returns 200 (zero is valid)', async () => {
        const { status } = await putVoice({ tts_pitch: 0 });
        expect(status).toBe(200);
        const persisted = await getVoiceSetting('tts_pitch');
        expect(Number(persisted)).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Block C — /platform-settings/avatars default_pitch_<gender> validation
    // -----------------------------------------------------------------------

    it('PUT /platform-settings/avatars with default_pitch_male=5 returns 200', async () => {
        const { status, json } = await putAvatars({ default_pitch_male: 5 });
        expect(status).toBe(200);
        expect(json.message).toMatch(/updated/i);
    });

    it('PUT /platform-settings/avatars with default_pitch_male=15 returns 400 with the [-10, 10] range message', async () => {
        const { status, json } = await putAvatars({ default_pitch_male: 15 });
        expect(status).toBe(400);
        expect(json.error).toMatch(/-10/);
        expect(json.error).toMatch(/10/);
        expect(json.error).toContain('default_pitch_male');
    });
});
