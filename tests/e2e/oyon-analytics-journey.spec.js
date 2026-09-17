// The whole Oyon analytics journey on REAL capture, in one pass.
//
// oyon-signal-analytics.spec.js proves the analytics are right on data seeded
// through the ingest API; oyon-typing / oyon-voice prove capture stores rows.
// Neither proves the two meet: that what a learner actually types and says in
// the browser comes out the other end as the numbers, charts and networks an
// educator reads. This spec does exactly that, with nothing seeded:
//
//   learner  — a fresh account on a tenant with voice on — completes the
//              welcome page, accepts the consent prompt for typing and voice
//              (contract v3), types two
//              messages in the patient chat (one with a typo fixed by
//              backspacing), then speaks one voice turn on the fake microphone;
//   educator — opens Learning Analytics filtered to that learner and checks
//              Text, Voice, Network → Typing and Network → Voice.
//
// Counts are taken from what the SERVER acknowledged during capture, not
// assumed: "Messages" must equal the typing windows the ingest stored, "Turns"
// the voice windows. Runs in the `chromium-voice` project for the microphone.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';

const STAMP = Date.now();
const LEARNER = { username: `journey_${STAMP}`, name: 'Jordan Journey', password: 'Journey123' };

async function adminCall(baseURL, fn) {
    const admin = await apiAsAdmin(baseURL);
    try { return await fn(admin); } finally { await admin.dispose(); }
}

/** GET → spread → PUT: the Oyon settings endpoint replaces its booleans. */
async function setTenantVoice(baseURL, on) {
    await adminCall(baseURL, async (admin) => {
        const { settings } = await (await admin.get('/api/addons/oyon/settings')).json();
        const res = await admin.put('/api/addons/oyon/settings', { data: { ...settings, voice_enabled: on } });
        expect(res.ok(), await res.text()).toBeTruthy();
    });
}

async function setPlatformVoiceMode(baseURL, on) {
    await adminCall(baseURL, async (admin) => {
        const res = await admin.put('/api/platform-settings/voice', { data: { voice_mode_enabled: on, stt_language: 'en-US' } });
        expect(res.ok(), await res.text()).toBeTruthy();
    });
}

async function learnerToken(baseURL) {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const res = await ctx.post('/api/auth/login', { data: { username: LEARNER.username, password: LEARNER.password } });
        expect(res.ok(), await res.text()).toBeTruthy();
        return (await res.json()).token;
    } finally { await ctx.dispose(); }
}

/** A page signed in as `token`, the way the auth fixture builds its pages. */
async function pageFor(browser, baseURL, token) {
    const context = await browser.newContext({
        baseURL,
        permissions: ['microphone'],
    });
    await context.addInitScript((t) => {
        try { window.localStorage.setItem('token', t); } catch { /* ignore */ }
    }, token);
    return { context, page: await context.newPage() };
}

/**
 * A brand-new learner meets the first-run welcome page. Complete it the way a
 * person would: keep the choices as offered and press Start. Voice is left off
 * here — with it on the room opens without a text box — and switched on later
 * with the room's own toggle, after the typing half of the journey.
 */
async function completeWelcome(page) {
    const title = page.getByRole('heading', { name: 'Welcome to Rohy', level: 1 });
    try {
        await title.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
        return false;
    }
    await page.getByRole('button', { name: /^Start$/ }).click();
    await expect(title).toBeHidden({ timeout: 15_000 });
    return true;
}

async function dismissOnboarding(page) {
    for (const name of [/No, keep it as it is/i, /^Skip$/i]) {
        const button = page.getByRole('button', { name });
        if (await button.count()) {
            await button.first().click();
            await expect(button.first()).toBeHidden();
        }
    }
}

/** Tally what the server acknowledged, per endpoint and modality. */
function watchIngest(page) {
    const stored = { typingWindows: 0, voiceWindows: 0, typingEvents: 0, voiceEvents: 0, errors: [] };
    page.on('response', async (res) => {
        const url = res.url();
        const isWindows = url.includes('/api/addons/oyon/emotion-records');
        const isEvents = url.includes('/api/addons/oyon/signal-events');
        if ((!isWindows && !isEvents) || res.request().method() !== 'POST') return;
        const sent = res.request().postData() || '';
        let body = null;
        try { body = await res.json(); } catch { /* recorded below */ }
        if (!res.ok() || !body) {
            stored.errors.push(`${res.status()} ${url} ${JSON.stringify(body)}`);
            return;
        }
        if (isWindows) {
            if (sent.includes('"modality":"typing"')) stored.typingWindows += body.signals_inserted ?? 0;
            if (sent.includes('"modality":"voice"')) stored.voiceWindows += body.signals_inserted ?? 0;
        } else {
            const events = JSON.parse(sent).events || [];
            const voiceShare = events.filter((e) => e.modality === 'voice').length;
            // A batch is single-modality in practice; attribute by what was sent.
            if (voiceShare === events.length) stored.voiceEvents += body.inserted ?? 0;
            else if (voiceShare === 0) stored.typingEvents += body.inserted ?? 0;
            else stored.errors.push(`mixed-modality event batch: ${voiceShare}/${events.length} voice`);
        }
    });
    return stored;
}

/** Open Learning Analytics on `tab`, filtered to the journey learner. */
async function openAnalytics(page, tab, learnerId) {
    await page.addInitScript(() => {
        try { window.localStorage.setItem('rohy_view', JSON.stringify({ view: 'tna' })); } catch { /* noop */ }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await dismissOnboarding(page);
    const button = page.getByRole('button', { name: tab, exact: true });
    await button.first().waitFor({ state: 'visible', timeout: 25_000 });
    await button.first().click();
    const studentFilter = page.locator('select').filter({ has: page.locator('option', { hasText: 'All students' }) }).first();
    await expect(studentFilter.locator(`option[value="${learnerId}"]`)).toHaveCount(1, { timeout: 15_000 });
    await studentFilter.selectOption(String(learnerId));
}

let learnerId = null;
const stored = { typingWindows: 0, voiceWindows: 0, typingEvents: 0, voiceEvents: 0 };

test.describe('oyon analytics journey', () => {
    // A real journey: welcome page, two typed messages with pauses, a voice turn.
    test.describe.configure({ mode: 'serial', timeout: 180_000 });

    test.beforeAll(async ({ baseURL }) => {
        await adminCall(baseURL, async (admin) => {
            await admin.put('/api/platform-settings/setup', { data: { completed: true } });
            const created = await admin.post('/api/users/create', {
                data: { ...LEARNER, email: `${LEARNER.username}@journey.test`, role: 'student' },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
        });
        await setTenantVoice(baseURL, true);
        await setPlatformVoiceMode(baseURL, true);
    });

    test.afterAll(async ({ baseURL }) => {
        await setTenantVoice(baseURL, false);
        await setPlatformVoiceMode(baseURL, false);
    });

    test('a learner types and speaks to the patient, and capture stores windows and state events', async ({ browser, baseURL }) => {
        const token = await learnerToken(baseURL);
        const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
        try {
            learnerId = (await (await api.get('/api/auth/profile')).json()).user?.id
                ?? (await (await api.get('/api/auth/verify')).json()).user?.id;
        } finally { await api.dispose(); }
        expect(learnerId, 'learner id').toBeTruthy();

        const { context, page } = await pageFor(browser, baseURL, token);
        try {
            const seen = watchIngest(page);
            await page.goto('/');
            await page.waitForLoadState('networkidle');
            const welcomed = await completeWelcome(page);
            test.info().annotations.push({ type: 'first-run welcome', description: welcomed ? 'completed' : 'not shown' });
            // The welcome card covers the camera only (it records oyon-consent-v1).
            // Typing and voice are new kinds of data, so the learner is asked
            // again, by a prompt that names them — and says yes.
            const accept = page.getByRole('button', { name: /Yes, record these too/i });
            await accept.waitFor({ state: 'visible', timeout: 20_000 });
            await expect(page.getByText(/How you sound while you speak to the patient/)).toBeVisible();
            await accept.click();
            await expect(accept).toBeHidden();
            await expect.poll(async () => {
                const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
                try {
                    const prefs = await (await ctx.get('/api/users/preferences')).json();
                    return JSON.parse(prefs.onboarding_settings || '{}').oyon_consent_version;
                } finally { await ctx.dispose(); }
            }, { timeout: 10_000 }).toBe('oyon-consent-v3');
            await dismissOnboarding(page);

            // ── Typing: two messages, the first with a typo fixed by backspacing.
            const composer = page.getByPlaceholder(/^Message /i);
            await composer.waitFor({ state: 'visible', timeout: 25_000 });
            await composer.click();
            await composer.pressSequentially('Whre', { delay: 90 });
            for (let i = 0; i < 3; i += 1) await composer.press('Backspace', { delay: 120 });
            await composer.pressSequentially('here does it hurt?', { delay: 70 });
            await composer.press('Enter');
            await expect.poll(() => seen.typingWindows, {
                timeout: 30_000,
                message: 'no typing window was stored for a message typed right after accepting the consent prompt',
            }).toBeGreaterThanOrEqual(1);

            await composer.click();
            await composer.pressSequentially('When did', { delay: 80 });
            await page.waitForTimeout(2_600); // a real pause, above Oyon's 2 s burst threshold
            await composer.pressSequentially(' the pain start?', { delay: 80 });
            await composer.press('Enter');
            await expect.poll(() => seen.typingWindows, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
            await expect.poll(() => seen.typingEvents, { timeout: 15_000 }).toBeGreaterThan(20);

            // ── Voice: one turn on the fake microphone.
            const talk = page.getByRole('button', { name: /Click to talk to/i });
            if (!(await talk.count())) {
                const voice = page.getByRole('button', { name: /^Voice$/i }).first();
                await voice.waitFor({ state: 'visible', timeout: 25_000 });
                await voice.click();
            }
            await talk.first().waitFor({ state: 'visible', timeout: 15_000 });
            await talk.first().click();
            await page.waitForTimeout(3_500);
            const stop = page.getByRole('button', { name: /Listening… click to stop/i });
            if (await stop.count()) await stop.first().click();
            await expect.poll(() => seen.voiceWindows, { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
            await expect.poll(() => seen.voiceEvents, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

            // Let any trailing batch land, then freeze the tallies.
            await page.waitForTimeout(2_500);
            expect(seen.errors, 'every ingest POST succeeded').toEqual([]);
            Object.assign(stored, seen);
            test.info().annotations.push({ type: 'stored', description: JSON.stringify(stored) });
        } finally { await context.close(); }
    });

    test('the Text tab shows exactly those messages and draws their writing process', async ({ adminPage }) => {
        test.skip(!learnerId, 'capture step did not run');
        await openAnalytics(adminPage, 'Text', learnerId);

        const messages = adminPage.getByText('Messages', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
        await expect(messages).toContainText(String(stored.typingWindows), { timeout: 20_000 });

        const section = adminPage.getByRole('heading', { name: 'Writing process' }).locator('xpath=ancestor::section[1]');
        await expect(section).toBeVisible();
        // A real session is labelled by username: the chat starts it with
        // student_name = user.username (ChatInterface), unlike the seeded spec.
        await expect(section.getByRole('combobox').first()).toContainText(LEARNER.username);
        // Drawn from real capture: every edit positioned, bursts agree with Oyon.
        await expect(section.getByText(/Not drawable/)).toHaveCount(0);
        await expect(section.getByText(/matches the counts Oyon reported/)).toBeVisible();

        await adminPage.setViewportSize({ width: 1440, height: 3600 });
        await adminPage.screenshot({ path: test.info().outputPath('journey-text-tab.png'), fullPage: true });
        await test.info().attach('journey-text-tab', { path: test.info().outputPath('journey-text-tab.png'), contentType: 'image/png' });
    });

    test('the Voice tab counts exactly the stored turns', async ({ adminPage }) => {
        test.skip(!learnerId, 'capture step did not run');
        await openAnalytics(adminPage, 'Voice', learnerId);
        const turns = adminPage.getByText('Turns', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
        await expect(turns).toContainText(String(stored.voiceWindows), { timeout: 20_000 });
        await expect(adminPage.getByRole('heading', { name: 'Turns in one session' })).toBeVisible();
        await adminPage.setViewportSize({ width: 1440, height: 3000 });
        await adminPage.screenshot({ path: test.info().outputPath('journey-voice-tab.png'), fullPage: true });
        await test.info().attach('journey-voice-tab', { path: test.info().outputPath('journey-voice-tab.png'), contentType: 'image/png' });
    });

    test('Network → Typing and → Voice build networks from the learner\'s own state log', async ({ adminPage }) => {
        test.skip(!learnerId, 'capture step did not run');
        await openAnalytics(adminPage, 'Network', learnerId);
        const source = adminPage.locator('select').filter({ has: adminPage.locator('option[value="typing-states"]') }).first();

        await source.selectOption('typing-states');
        await expect(adminPage.getByText('Capture sequences', { exact: true })).toBeVisible({ timeout: 20_000 });
        for (const state of ['Insert', 'Delete']) {
            await expect(adminPage.locator('svg text', { hasText: new RegExp(`^${state}$`) }).first()).toBeVisible();
        }
        await adminPage.screenshot({ path: test.info().outputPath('journey-network-typing.png') });
        await test.info().attach('journey-network-typing', { path: test.info().outputPath('journey-network-typing.png'), contentType: 'image/png' });

        await source.selectOption('voice-states');
        await expect(adminPage.getByText('Voice states', { exact: true })).toBeVisible({ timeout: 20_000 });
        // Every voice turn opens and closes, whatever the microphone heard (the
        // fake device plays a tone, so Speech is not guaranteed). The state
        // names are read from the page as a whole: node labels may wrap or sit
        // below the fold, the centrality chart lists them in full.
        for (const state of ['Turn start', 'Turn end']) {
            await expect(adminPage.getByText(state, { exact: true }).first()).toBeAttached();
        }
        await adminPage.screenshot({ path: test.info().outputPath('journey-network-voice.png') });
        await test.info().attach('journey-network-voice', { path: test.info().outputPath('journey-network-voice.png'), contentType: 'image/png' });
    });
});
