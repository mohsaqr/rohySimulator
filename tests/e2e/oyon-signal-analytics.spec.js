// The Text and Voice analytics tabs, end to end.
//
// Two learners' typing episodes and voice turns go in through the REAL ingest
// path — per-learner consent, a real session, POST /addons/oyon/emotion-records
// — and an admin then opens Learning Analytics → Text and → Voice. The values
// are chosen so the cohort figures are known exactly:
//
//   typing speed, per learner:  A = median(100, 140) = 120,  B = 200
//   cohort (median of learners): median(120, 200)     = 160
//
//   speaking share, per learner (measured turns only):
//                               A = median(0.6, 0.8) = 0.70,  B = 0.40
//   cohort:                     median(0.70, 0.40)    = 0.55 → "55%"
//
// A also has one voice turn Oyon marked insufficient, with a real 0 speech
// ratio. If it leaked into the metrics A would read 0.60 and the cohort 0.50 —
// so "55%" on screen proves insufficient turns are kept out.
//
// Isolation: the windows are written against a case created by THIS run's
// beforeAll, and the test selects that case in the dashboard's Case filter.
// Playwright re-runs beforeAll in a fresh worker after a failure; the first
// version of this spec shared the seeded case and a retry doubled the data
// (the figures on screen were still right — for the doubled data). Scoping to
// a per-run case also keeps windows from the typing and voice specs out.
//
// Screenshots land in ./tmp/ for review.

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

const STAMP = Date.now();
const SECOND = { username: `analytics_b_${STAMP}`, name: 'Beatrice Analytics', password: 'Analytics123' };
const SHOTS = path.join(process.cwd(), 'tmp');

async function ctxFor(baseURL, token) {
    return pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

async function tokenFor(baseURL, username, password) {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const res = await ctx.post('/api/auth/login', { data: { username, password } });
        expect(res.ok(), await res.text()).toBeTruthy();
        return (await res.json()).token;
    } finally { await ctx.dispose(); }
}

/** Oyon voice on at tenant level. GET → spread → PUT: the endpoint replaces its booleans. */
async function setTenantVoice(baseURL, on) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const { settings } = await (await admin.get('/api/addons/oyon/settings')).json();
        const res = await admin.put('/api/addons/oyon/settings', { data: { ...settings, voice_enabled: on } });
        expect(res.ok(), await res.text()).toBeTruthy();
    } finally { await admin.dispose(); }
}

const ENVELOPE = { capture_mode: 'local-browser', consent_version: 'oyon-consent-v3' };
let seq = 0;
function bounds() {
    // Inside the session's bounds: after it started, and before "now + 60 s".
    seq += 1;
    const start = new Date(Date.now() - 45_000 + seq * 1_000);
    return { window_start: start.toISOString(), window_end: new Date(start.getTime() + 800).toISOString() };
}

const pauses = (short, mid) => ({ lt_500_ms: short, '500_to_1000_ms': mid, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 0 });

function typingWindow(sessionId, { cpm, revision, submitted = true }) {
    return {
        ...ENVELOPE, ...bounds(), session_id: String(sessionId), modality: 'typing', window_kind: 'episode',
        typing: {
            chars_per_min_active: cpm, chars_per_min: cpm / 2, revision_ratio: revision,
            submitted, abandoned: !submitted, pasted_graphemes: 0, first_input_latency_ms: 900,
            burst_count: 3, correction_count: 1, pause_histogram: pauses(5, 1),
        },
    };
}

function voiceWindow(sessionId, { speech, insufficient = false }) {
    return {
        ...ENVELOPE, ...bounds(), session_id: String(sessionId), modality: 'voice', window_kind: 'episode',
        voice: {
            speech_ratio: speech, turn_duration_ms: 4000, speech_duration_ms: 4000 * speech,
            pitch_median_hz: insufficient ? null : 170, internal_pause_count: 2,
            insufficient_data: insufficient,
            insufficient_reasons: insufficient ? ['insufficient_analyzable_speech'] : [],
            pause_histogram: pauses(2, 1),
        },
    };
}

/** A state log for one capture, timestamped inside the session. */
function stateEvents(captureId, modality, states) {
    const base = Date.now() - 40_000;
    return states.map((state, i) => ({
        capture_id: captureId, sequence_index: i, modality, state,
        source: state === 'playback' ? 'ai' : 'user', timestamp: base + i * 100,
    }));
}

/** One learner: consent v3 on record, a real session, the session consent row, then the windows and state log. */
async function seedLearner(baseURL, token, caseId, studentName, events, stateLog = []) {
    const ctx = await ctxFor(baseURL, token);
    try {
        const prefs = await ctx.put('/api/users/preferences', {
            data: { onboarding_settings: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' } },
        });
        expect(prefs.ok(), await prefs.text()).toBeTruthy();

        const s = await ctx.post('/api/sessions', {
            data: { case_id: caseId, student_name: studentName, llm_settings: {}, monitor_settings: {} },
        });
        expect(s.ok(), await s.text()).toBeTruthy();
        const sessionId = (await s.json()).id;

        const consent = await ctx.post('/api/addons/oyon/consent', { data: { session_id: String(sessionId), consent_granted: true } });
        expect(consent.ok(), await consent.text()).toBeTruthy();

        const res = await ctx.post('/api/addons/oyon/emotion-records', {
            data: { schema_version: 'oyon-window-batch-v4', events: events(sessionId) },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        const body = await res.json();
        expect(body.signals_consent_blocked, JSON.stringify(body)).toBe(0);

        const logged = await ctx.post('/api/addons/oyon/signal-events', {
            data: { session_id: String(sessionId), events: stateLog },
        });
        expect(logged.ok(), await logged.text()).toBeTruthy();
        const logBody = await logged.json();
        expect(logBody).toMatchObject({ inserted: stateLog.length, consent_blocked: 0 });
        return body.signals_inserted;
    } finally { await ctx.dispose(); }
}

/** Open Learning Analytics full-page on a tab. The app restores its view from `rohy_view`. */
async function openAnalyticsTab(page, label) {
    await page.addInitScript(() => {
        try { window.localStorage.setItem('rohy_view', JSON.stringify({ view: 'tna' })); } catch { /* noop */ }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: /^Skip$/i });
    if (await skip.count()) await skip.first().click();
    const tab = page.getByRole('button', { name: label, exact: true });
    await tab.first().waitFor({ state: 'visible', timeout: 25_000 });
    await tab.first().click();
    const caseFilter = page.locator('select').filter({ has: page.locator('option', { hasText: 'All cases' }) }).first();
    await expect(caseFilter.locator(`option[value="${seededCaseId}"]`)).toHaveCount(1, { timeout: 15_000 });
    await caseFilter.selectOption(String(seededCaseId));
}

let seededCaseId = null;

/** Network tab, a Source, and this run's case. */
async function openNetworkSource(page, source) {
    await openAnalyticsTab(page, 'Network');
    const sourceSelect = page.locator('select').filter({ has: page.locator('option[value="typing-states"]') }).first();
    await sourceSelect.selectOption(source);
}

test.describe('oyon signal analytics', () => {
    test.beforeAll(async ({ baseURL }) => {
        const admin = await apiAsAdmin(baseURL);
        try {
            await admin.put('/api/platform-settings/setup', { data: { completed: true } });
            const created = await admin.post('/api/users/create', {
                data: { ...SECOND, email: `${SECOND.username}@analytics.test`, role: 'student' },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
        } finally { await admin.dispose(); }
        await setTenantVoice(baseURL, true);

        const admin2 = await apiAsAdmin(baseURL);
        try {
            const created = await admin2.post('/api/cases', {
                data: {
                    name: `Signal analytics ${STAMP}`,
                    description: 'e2e: Text and Voice analytics',
                    system_prompt: 'You are a test patient.',
                    config: { demographics: { name: 'Test', age: 40, gender: 'Male' } },
                },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
            seededCaseId = (await created.json()).id;
        } finally { await admin2.dispose(); }
        const theCase = { id: seededCaseId };
        const { token: tokenA } = await loginAs(baseURL, 'student');
        const tokenB = await tokenFor(baseURL, SECOND.username, SECOND.password);

        const insertedA = await seedLearner(baseURL, tokenA, theCase.id, 'Demo Student', (sid) => [
            typingWindow(sid, { cpm: 100, revision: 0.1 }),
            typingWindow(sid, { cpm: 140, revision: 0.3, submitted: false }),
            voiceWindow(sid, { speech: 0.6 }),
            voiceWindow(sid, { speech: 0.8 }),
            voiceWindow(sid, { speech: 0, insufficient: true }),
        ], [
            ...stateEvents(`cap_a_${STAMP}`, 'typing', ['start', 'insert', 'insert', 'pause', 'delete', 'submit']),
            ...stateEvents(`cap_a_voice_${STAMP}`, 'voice', ['start', 'speech', 'silence', 'pause', 'speech', 'end']),
        ]);
        const insertedB = await seedLearner(baseURL, tokenB, theCase.id, SECOND.name, (sid) => [
            typingWindow(sid, { cpm: 200, revision: 0.0 }),
            voiceWindow(sid, { speech: 0.4 }),
        ], [
            ...stateEvents(`cap_b_${STAMP}`, 'typing', ['start', 'insert', 'pause', 'insert', 'submit']),
            ...stateEvents(`cap_b_voice_${STAMP}`, 'voice', ['start', 'speech', 'playback', 'end']),
        ]);
        expect(insertedA).toBe(5);
        expect(insertedB).toBe(2);
        fs.mkdirSync(SHOTS, { recursive: true });
    });

    test.afterAll(async ({ baseURL }) => {
        await setTenantVoice(baseURL, false);
    });

    test('the Text tab summarises typing per learner, each learner counting once', async ({ adminPage }) => {
        await openAnalyticsTab(adminPage, 'Text');

        await expect(adminPage.getByText('Typing speed')).toBeVisible({ timeout: 20_000 });
        // Cohort speed: median of per-learner medians — A 120, B 200 → 160, quartiles 140–180.
        await expect(adminPage.getByText('160 (140–180)')).toBeVisible();
        // Revision: A median(0.1, 0.3) = 0.2, B 0.0 → 0.10.
        await expect(adminPage.getByText('0.10 (0.05–0.15)')).toBeVisible();
        await expect(adminPage.getByText('2 learners · 2 sessions')).toBeVisible();

        const byLearner = adminPage.getByRole('heading', { name: 'By learner' }).locator('xpath=ancestor::section[1]');
        await expect(byLearner.getByRole('row')).toHaveCount(3); // header + 2 learners
        await expect(byLearner.getByText(SECOND.name)).toBeVisible();

        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-text-tab.png'), fullPage: true });
    });

    test('the Voice tab keeps unmeasurable turns out of the figures and says why', async ({ adminPage }) => {
        await openAnalyticsTab(adminPage, 'Voice');

        await expect(adminPage.getByText('Speaking share').first()).toBeVisible({ timeout: 20_000 });
        // A 0.70, B 0.40 → 55%, quartiles 48–63%. 50% would mean the insufficient
        // turn (speech 0) leaked into A's median.
        await expect(adminPage.getByText(/^55% \(/).first()).toBeVisible();
        // A: 3 turns (1 insufficient), B: 1 → 4 turns, 3 measured, 1 of 4 not measurable.
        await expect(adminPage.getByText('3 measured · 25% not measurable')).toBeVisible();

        await expect(adminPage.getByRole('heading', { name: 'Turns that could not be measured' })).toBeVisible();
        await expect(adminPage.getByText(/Too little speech to measure/)).toBeVisible();

        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-voice-tab.png'), fullPage: true });
    });

    test('Network → Typing builds one sequence per capture from the stored state log', async ({ adminPage }) => {
        await openNetworkSource(adminPage, 'typing-states');
        const card = (label) => adminPage.getByText(label, { exact: true }).locator('xpath=..');
        // Two captures (A, B); A has 6 actions, B 5 → 11; states: Start Insert Pause Delete Send → 5.
        await expect(card('Capture sequences')).toContainText('2', { timeout: 20_000 });
        await expect(card('Typing actions')).toContainText('11');
        await expect(card('States')).toContainText('5');
        await expect(adminPage.locator('svg text', { hasText: /^Delete$/ }).first()).toBeVisible();
        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-network-typing.png'), fullPage: true });
    });

    test('Network → Voice builds the speech, silence and pause network', async ({ adminPage }) => {
        await openNetworkSource(adminPage, 'voice-states');
        const card = (label) => adminPage.getByText(label, { exact: true }).locator('xpath=..');
        // A: 6 states, B: 4 → 10; Turn start, Speech, Silence, Pause, Turn end, Patient speaking → 6.
        await expect(card('Capture sequences')).toContainText('2', { timeout: 20_000 });
        await expect(card('Voice states')).toContainText('10');
        await expect(card('States')).toContainText('6');
        await expect(adminPage.locator('svg text', { hasText: /^Patient speaking$/ }).first()).toBeVisible();
        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-network-voice.png'), fullPage: true });
    });
});
