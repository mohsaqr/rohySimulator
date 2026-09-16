// Oyon voice capture, end to end — runs under the `chromium-voice` project,
// which gives the browser a fake microphone (see playwright.config.js).
//
// What is proven:
//   - a learner who accepted consent v3, on a tenant with voice on, presses
//     "talk" to the patient and the server stores a voice window;
//   - the SPEECH DETECTOR actually ran (vad_coverage > 0);
//   - the window carries measurements and never raw audio;
//   - a learner on v2 gets nothing captured, even with voice on.
//
// The detector assertion is the one that matters. Four separate defects each
// left voice "working" — a window stored, every test green — while the Silero
// detector never ran and every window reported vad_coverage 0:
//   1. rohy never set `vadEnabled: true`, so the worker ran DSP-only;
//   2. the onnxruntime-web alias stub answered instead of a real runtime;
//   3. the asset URLs doubled to /api/api/… and 404'd;
//   4. given only the runtime directory, onnxruntime-web asked for JSEP glue the
//      installer never ships — a stale local copy made it die with
//      `t.getValue is not a function`.
// Any one of them regressing brings vad_coverage back to 0.
//
// Not asserted: the metric VALUES. The fake device plays a synthetic tone, so
// speech_ratio is near zero and pitch is (correctly) gated out — a beep is not
// speech. The metrics are Oyon's to test upstream.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

async function asStudent(baseURL, fn) {
    const { token } = await loginAs(baseURL, 'student');
    const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    try { return await fn(ctx); } finally { await ctx.dispose(); }
}

/**
 * Set tenant Oyon voice on/off. PUT /addons/oyon/settings REPLACES its non-signal
 * booleans (an absent field becomes 0), so this reads, spreads and writes back —
 * a bare PUT would switch off emotion capture and every dashboard view for all
 * the specs that run after this one.
 */
async function setTenantVoice(baseURL, on) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const { settings } = await (await admin.get('/api/addons/oyon/settings')).json();
        const res = await admin.put('/api/addons/oyon/settings', { data: { ...settings, voice_enabled: on } });
        expect(res.ok(), await res.text()).toBeTruthy();
    } finally { await admin.dispose(); }
}

async function setPlatformVoiceMode(baseURL, on) {
    const admin = await apiAsAdmin(baseURL);
    try {
        // A key-presence merge, so only these two keys change.
        const res = await admin.put('/api/platform-settings/voice', {
            data: { voice_mode_enabled: on, stt_language: 'en-US' },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
    } finally { await admin.dispose(); }
}

async function openVoiceMode(page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const decline = page.getByRole('button', { name: /No, keep it as it is/i });
    if (await decline.count()) {
        await decline.first().click();
        await expect(decline.first()).toBeHidden();
    }
    const skip = page.getByRole('button', { name: /^Skip$/i });
    if (await skip.count()) {
        await skip.first().click();
        await expect(skip.first()).toBeHidden();
    }
    const talk = page.getByRole('button', { name: /Click to talk to/i });
    if (!(await talk.count())) {
        const voice = page.getByRole('button', { name: /^Voice$/i }).first();
        await voice.waitFor({ state: 'visible', timeout: 25_000 });
        await voice.click();
    }
    await talk.first().waitFor({ state: 'visible', timeout: 15_000 });
    return talk.first();
}

/** Speak for a few seconds, then end the turn if recognition has not already. */
async function speakOneTurn(page, talk) {
    await talk.click();
    // Long enough for the detector to initialise and see frames. If speech
    // recognition refuses in the headless browser it ends the turn itself.
    await page.waitForTimeout(3_000);
    const stop = page.getByRole('button', { name: /Listening… click to stop/i });
    if (await stop.count()) await stop.first().click();
}

const isVoicePost = (r) => r.url().includes('/api/addons/oyon/emotion-records')
    && r.request().method() === 'POST'
    && (r.request().postData() || '').includes('"modality":"voice"');

test.describe('oyon voice capture', () => {
    test.beforeAll(async ({ baseURL }) => {
        const admin = await apiAsAdmin(baseURL);
        try { await admin.put('/api/platform-settings/setup', { data: { completed: true } }); } finally { await admin.dispose(); }
        await setPlatformVoiceMode(baseURL, true);
        await setTenantVoice(baseURL, true);
    });

    // Leave the shared e2e database as other specs expect it.
    test.afterAll(async ({ baseURL }) => {
        await setTenantVoice(baseURL, false);
        await setPlatformVoiceMode(baseURL, false);
    });

    test('a spoken turn under consent v3 is measured by the speech detector and stored', async ({ studentPage, baseURL }) => {
        // The detector's model and runtime are gitignored and installed by
        // `npm run setup:oyon` (download-models.sh). Without them the detector
        // cannot run, and the failure below would read as a code regression.
        // Say what is actually wrong instead.
        const modelProbe = await studentPage.request.get('/api/addons/oyon/assets/models/vad/silero_vad.onnx');
        expect(modelProbe.status(), 'Oyon VAD model not installed — run `npm run setup:oyon`').toBe(200);

        await asStudent(baseURL, (ctx) => ctx.put('/api/users/preferences', {
            data: { onboarding_settings: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' } },
        }));

        // No ONNX runtime, model or wasm may come from a third party.
        const offOrigin = [];
        studentPage.context().on('request', (r) => {
            const u = r.url();
            if (/onnx|ort\.|ort-wasm|silero/i.test(u) && !u.startsWith(baseURL)) offOrigin.push(u);
        });

        const talk = await openVoiceMode(studentPage);
        const posted = studentPage.waitForResponse(isVoicePost, { timeout: 45_000 });
        await speakOneTurn(studentPage, talk);

        const res = await posted;
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.signals_inserted, `server response: ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(1);
        expect(body.signals_consent_blocked).toBe(0);

        const sent = res.request().postData() || '';
        const event = JSON.parse(sent).events.find((e) => e.modality === 'voice');
        const voice = event.voice || event;

        // The detector ran. See the header: four different defects each left
        // this at 0 while everything else looked fine.
        expect(voice.vad_coverage, `speech detector did not run: ${JSON.stringify(voice.insufficient_reasons)}`)
            .toBeGreaterThan(0);
        expect(voice.insufficient_reasons || []).not.toContain('poor_vad_coverage');
        expect(voice.stream_owner).toBe('oyon');

        // The consent card's promise: measurements, never the recording.
        for (const raw of ['"waveform"', '"pcm"', '"raw_audio"', '"audio_data"', '"audio_samples"']) {
            expect(sent, `voice window carried ${raw}`).not.toContain(raw);
        }
        expect(offOrigin, 'the speech detector was loaded from a third party').toEqual([]);
    });

    test('a learner on consent v2 has no voice captured, even with voice on', async ({ studentPage, baseURL }) => {
        await asStudent(baseURL, (ctx) => ctx.put('/api/users/preferences', {
            data: { onboarding_settings: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } },
        }));

        const voicePosts = [];
        studentPage.on('request', (r) => {
            if (r.url().includes('/api/addons/oyon/emotion-records') && (r.postData() || '').includes('"modality":"voice"')) {
                voicePosts.push(r);
            }
        });

        const talk = await openVoiceMode(studentPage);
        await speakOneTurn(studentPage, talk);

        // Nothing to wait for: the assertion is that no voice window is ever sent.
        await studentPage.waitForTimeout(6_000);
        expect(voicePosts, 'a v2 learner had voice captured').toHaveLength(0);
    });
});
