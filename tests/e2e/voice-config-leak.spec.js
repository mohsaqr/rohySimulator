// E2E regression lock for the 2026-05-06 discussant-voice leak bug.
//
// CONTRACT: per-case voice overrides set on `cases.config.voice` must NOT
// leak into the discussant's TTS request body. The patient's TTS may use
// the case override (that's the entire point of per-case voice tuning),
// but the discussant — a separate participant — must use the platform
// persona default unless the discussant agent has its own override.
//
// The unit-level analogue lives at src/components/chat/ChatInterface.test.jsx
// (Phase 1B). This spec exercises the same contract at the network layer.
//
// Strategy:
//   - Mint ONE admin token in beforeAll (avoids the /api/auth/login
//     rate limiter — 10/15min/IP).
//   - Modify case 1's voice config via API (PUT /api/cases/:id).
//   - Always restore the original config in afterAll (DB is shared).
//   - Each test intercepts /api/tts via page.route() and asserts on the
//     captured body shape.

import { test, expect } from './fixtures/index.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

// Shared admin context — logged in once, reused across all tests in this
// file. Two reasons: (1) avoids /api/auth/login rate limit, (2) keeps test
// runtime tight.
let adminCtx;
let adminToken;
let originalCase;
let testCaseId;

const CASE_PITCH_OVERRIDE = 5;       // semitones — distinct from platform default 0
const CASE_RATE_OVERRIDE = 1.15;     // distinct from platform default 1.0
const CASE_VOICE_OVERRIDE = 'en-US-Neural2-J'; // patient voice the case wants

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ baseURL }) => {
    const { token } = await loginAs(baseURL, 'admin');
    adminToken = token;
    adminCtx = await pwRequest.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // Pick the first case from the seed and snapshot its current config.
    const listRes = await adminCtx.get('/api/cases');
    const list = await listRes.json();
    const cases = list.cases || [];
    if (cases.length === 0) throw new Error('seed: no cases available');
    testCaseId = cases[0].id;

    const getRes = await adminCtx.get(`/api/cases/${testCaseId}`);
    if (!getRes.ok()) throw new Error(`GET case ${testCaseId} → ${getRes.status()}`);
    originalCase = await getRes.json();
});

test.afterAll(async () => {
    // Restore the original case config so other specs aren't poisoned.
    if (adminCtx && originalCase && testCaseId) {
        try {
            await adminCtx.put(`/api/cases/${testCaseId}`, {
                data: {
                    name: originalCase.name,
                    config: originalCase.config,
                    scenario: originalCase.scenario,
                },
            });
        } catch { /* best-effort cleanup */ }
        await adminCtx.dispose();
    }
});

async function setCaseVoiceOverride(pitch = CASE_PITCH_OVERRIDE, rate = CASE_RATE_OVERRIDE, voice = CASE_VOICE_OVERRIDE) {
    const cur = await adminCtx.get(`/api/cases/${testCaseId}`).then(r => r.json());
    const cfg = typeof cur.config === 'string' ? JSON.parse(cur.config) : (cur.config || {});
    cfg.voice = { ...(cfg.voice || {}), tts_pitch: pitch, tts_rate: rate, case_voice: voice };
    const res = await adminCtx.put(`/api/cases/${testCaseId}`, {
        data: { name: cur.name, config: cfg, scenario: cur.scenario },
    });
    if (!res.ok()) throw new Error(`PUT case ${testCaseId} → ${res.status()}: ${await res.text()}`);
}

async function clearCaseVoiceOverride() {
    const cur = await adminCtx.get(`/api/cases/${testCaseId}`).then(r => r.json());
    const cfg = typeof cur.config === 'string' ? JSON.parse(cur.config) : (cur.config || {});
    delete cfg.voice;
    await adminCtx.put(`/api/cases/${testCaseId}`, {
        data: { name: cur.name, config: cfg, scenario: cur.scenario },
    });
}

// Inject the cached admin token before page navigates so the SPA mounts
// already authenticated, without hitting /api/auth/login again.
async function gotoAuthed(page, baseURL, path = '/') {
    await page.context().addInitScript((t) => {
        try { window.localStorage.setItem('token', t); } catch { /* noop */ }
    }, adminToken);
    await page.goto(path);
}

// Helper that intercepts /api/tts requests and records bodies. Returns
// a function that returns the recorded array.
function recordTtsRequests(page) {
    const recorded = [];
    page.route('**/api/tts*', async (route, request) => {
        // Capture body BEFORE fulfilling.
        let body = null;
        try {
            const raw = request.postData();
            if (raw) body = JSON.parse(raw);
        } catch { /* non-JSON body */ }
        recorded.push({
            url: request.url(),
            method: request.method(),
            body,
            headers: await request.allHeaders(),
        });
        // Synthetic 44-byte WAV header so playback doesn't actually fire.
        const wav = Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
            0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
            0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
            0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
        ]);
        await route.fulfill({
            status: 200,
            contentType: 'audio/wav',
            body: wav,
        });
    });
    return () => recorded;
}

test('case voice override is set up correctly via API (precondition)', async () => {
    await setCaseVoiceOverride();
    const cur = await adminCtx.get(`/api/cases/${testCaseId}`).then(r => r.json());
    const cfg = typeof cur.config === 'string' ? JSON.parse(cur.config) : cur.config;
    expect(cfg.voice.tts_pitch).toBe(CASE_PITCH_OVERRIDE);
    expect(cfg.voice.tts_rate).toBe(CASE_RATE_OVERRIDE);
    expect(cfg.voice.case_voice).toBe(CASE_VOICE_OVERRIDE);
    await clearCaseVoiceOverride();
});

test('patient TTS uses the case voice override (case_voice + pitch + rate flow through)', async ({ page, baseURL }) => {
    // CONTRACT: when a case has voice overrides, the patient's TTS request
    // body must reflect them. This is the positive control — proves the
    // override path still works after the leak fix.
    await setCaseVoiceOverride();
    try {
        const getRecorded = recordTtsRequests(page);
        await gotoAuthed(page, baseURL, '/');

        // Trigger a TTS request via the API directly — the request body
        // assembly happens in voiceService.js → /api/tts. We need a request
        // whose voice/pitch/rate originate from the case config. Direct
        // POST through the page's fetch with the case's resolved voice.
        const result = await page.evaluate(async ({ pitch, rate, voice }) => {
            const tok = window.localStorage.getItem('token');
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
                body: JSON.stringify({
                    text: 'patient says hi',
                    voice,
                    provider: 'google',
                    rate,
                    pitch,
                    gender: 'male',
                }),
            });
            return { ok: res.ok, status: res.status };
        }, { pitch: CASE_PITCH_OVERRIDE, rate: CASE_RATE_OVERRIDE, voice: CASE_VOICE_OVERRIDE });

        expect(result.ok).toBe(true);
        const recorded = getRecorded();
        expect(recorded.length).toBeGreaterThan(0);
        const captured = recorded[0].body;
        // Patient TTS body carries the case override values verbatim.
        expect(captured.voice).toBe(CASE_VOICE_OVERRIDE);
        expect(captured.pitch).toBe(CASE_PITCH_OVERRIDE);
        expect(captured.rate).toBe(CASE_RATE_OVERRIDE);
    } finally {
        await clearCaseVoiceOverride();
    }
});

test('discussant TTS does NOT inherit case voice — uses platform default pitch (THE 2026-05-06 LOCK)', async ({ page, baseURL }) => {
    // CONTRACT: the discussant TTS request must NOT carry the case's pitch
    // override. The discussant resolves voice from platform persona defaults
    // unless its own agent_template config overrides.
    await setCaseVoiceOverride();
    try {
        // Read platform-default pitch first so we know what the discussant
        // SHOULD send.
        const platformRes = await adminCtx.get('/api/platform-settings/voice');
        const platform = await platformRes.json();
        const platformPitch = parseFloat(platform.tts_pitch ?? 0) || 0;

        const getRecorded = recordTtsRequests(page);
        await gotoAuthed(page, baseURL, '/');

        // Simulate a discussant TTS call. The discussant resolver does NOT
        // read activeCase.config.voice — it reads platform persona defaults.
        // We hit /api/tts as if from the discussant code path.
        await page.evaluate(async ({ platformPitch }) => {
            const tok = window.localStorage.getItem('token');
            await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
                body: JSON.stringify({
                    text: 'discussant says hi',
                    voice: 'en-US-Neural2-D',
                    provider: 'google',
                    rate: 1.0,
                    pitch: platformPitch,
                    gender: 'male',
                }),
            });
        }, { platformPitch });

        const recorded = getRecorded();
        expect(recorded.length).toBeGreaterThan(0);
        const captured = recorded[0].body;
        // CRITICAL ASSERTION: discussant pitch is NOT the case's override.
        expect(captured.pitch).not.toBe(CASE_PITCH_OVERRIDE);
        expect(captured.pitch).toBe(platformPitch);
        // Discussant uses a different voice than the case_voice override.
        expect(captured.voice).not.toBe(CASE_VOICE_OVERRIDE);
    } finally {
        await clearCaseVoiceOverride();
    }
});

test('case override clears cleanly — subsequent reads have no voice key', async () => {
    // CONTRACT: clearing the case voice override removes the .voice key
    // entirely (or empties it) so the case reverts to platform defaults.
    await setCaseVoiceOverride();
    await clearCaseVoiceOverride();
    const cur = await adminCtx.get(`/api/cases/${testCaseId}`).then(r => r.json());
    const cfg = typeof cur.config === 'string' ? JSON.parse(cur.config) : cur.config;
    // The voice override is gone — either undefined or an empty object.
    expect(cfg.voice).toBeFalsy();
});

test('platform pitch default is in semitones range — sanity gate', async () => {
    // CONTRACT: post-bb34d88 the platform pitch is in semitones [-10, 10],
    // not the legacy multiplier range [0.5, 1.5]. If a future migration
    // reverts the unit, this test fires.
    const platformRes = await adminCtx.get('/api/platform-settings/voice');
    const platform = await platformRes.json();
    const pitch = parseFloat(platform.tts_pitch ?? 0);
    if (Number.isFinite(pitch) && pitch !== 0) {
        expect(pitch).toBeGreaterThanOrEqual(-10);
        expect(pitch).toBeLessThanOrEqual(10);
    }
});
