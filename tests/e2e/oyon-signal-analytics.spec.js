// The Text and Voice analytics tabs, end to end.
//
// Two learners' typing episodes and voice turns go in through the REAL ingest
// path — per-learner consent, a real session, POST /addons/oyon/emotion-records
// — and an admin then opens Learning Analytics → Text and → Voice. The data is
// deliberately uneven (different speeds, pauses, turn lengths, pitch) so the
// charts show real shape, and the values are chosen so the cohort figures are
// known exactly (R type-7 quantiles, as in signalStats.js):
//
//   typing speed, per learner:  A = median(96, 132, 150) = 132,  B = median(188, 236) = 212
//   cohort (median of learners): 172, IQR 152–192
//   pooled across all five messages it would be 150 — so "172" proves each
//   learner counts once, not each message.
//
//   revision ratio: A = median(0.08, 0.22, 0.31) = 0.22,  B = median(0.04, 0.08) = 0.06
//   cohort: 0.14, IQR 0.10–0.18
//
//   speaking share, measured turns only:
//     A = median(0.58, 0.66, 0.71, 0.62, 0.74) = 0.66,  B = median(0.46, 0.52, 0.44) = 0.46
//     cohort: 56%, IQR 51%–61%
//
// A also has one voice turn Oyon marked insufficient, with a real 0 speech
// ratio. If it leaked into the metrics A would read 0.64 and the cohort 55% —
// so "56%" on screen proves insufficient turns are kept out.
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
import { TypingAggregator } from '../../OyonR/src/aggregation/TypingAggregator.js';

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

const pauses = ([lt500, to1s, to2s, to5s, gte5s]) => ({
    lt_500_ms: lt500, '500_to_1000_ms': to1s, '1000_to_2000_ms': to2s, '2000_to_5000_ms': to5s, gte_5000_ms: gte5s,
});

/** A typing episode summary. `locations` is [mid-word, between words, sentences, paragraphs]. */
function typingWindow(sessionId, {
    cpm, revision, latency, hist, kept, pBursts, rBursts, locations, pasted = 0, submitted = true,
}) {
    const [mid, word, sentence, paragraph] = locations;
    return {
        ...ENVELOPE, ...bounds(), session_id: String(sessionId), modality: 'typing', window_kind: 'episode',
        typing: {
            chars_per_min_active: cpm, chars_per_min: Math.round(cpm * 0.6), revision_ratio: revision,
            submitted, abandoned: !submitted, pasted_graphemes: pasted, first_input_latency_ms: latency,
            burst_count: pBursts + rBursts, p_burst_count: pBursts, r_burst_count: rBursts,
            correction_count: rBursts, product_ratio: kept, pause_histogram: pauses(hist),
            committed_graphemes: Math.round(cpm / 3),
            pause_location_counts: {
                mid_word: mid, word_boundary: word, sentence_boundary: sentence, paragraph_boundary: paragraph,
            },
        },
    };
}

/**
 * One voice turn, its time split the way VoiceTurnAggregator reports it:
 * silence before speaking, speech (= duration × ratio), pauses, and the rest
 * as silence after.
 */
function voiceWindow(sessionId, {
    duration, speech, initial, pauseCount = 0, pauseTotal = 0, segmentMean = null, pitch = null, hist = [0, 0, 0, 0, 0],
    insufficient = false,
}) {
    const speechMs = Math.round(duration * speech);
    return {
        ...ENVELOPE, ...bounds(), session_id: String(sessionId), modality: 'voice', window_kind: 'episode',
        voice: {
            speech_ratio: speech, turn_duration_ms: duration, speech_duration_ms: speechMs,
            initial_silence_ms: initial, internal_pause_total_ms: pauseTotal,
            trailing_silence_ms: Math.max(0, duration - initial - speechMs - pauseTotal),
            segment_duration_mean_ms: segmentMean,
            pitch_median_hz: insufficient ? null : pitch, internal_pause_count: pauseCount,
            insufficient_data: insufficient,
            insufficient_reasons: insufficient ? ['insufficient_analyzable_speech'] : [],
            pause_histogram: pauses(hist),
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

        if (stateLog.length > 0) {
            const logged = await ctx.post('/api/addons/oyon/signal-events', {
                data: { session_id: String(sessionId), events: stateLog },
            });
            expect(logged.ok(), await logged.text()).toBeTruthy();
            const logBody = await logged.json();
            expect(logBody).toMatchObject({ inserted: stateLog.length, consent_blocked: 0 });
        }
        return body.signals_inserted;
    } finally { await ctx.dispose(); }
}

/** Open Learning Analytics full-page on a tab. The app restores its view from `rohy_view`. */
async function openAnalyticsTab(page, label, caseId = seededCaseId) {
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
    await expect(caseFilter.locator(`option[value="${caseId}"]`)).toHaveCount(1, { timeout: 15_000 });
    await caseFilter.selectOption(String(caseId));
}

let seededCaseId = null;
let processCaseId = null;
let processWindow = null;

/**
 * A typing window exactly as Oyon's own aggregator produces it — per-edit
 * positions, intervals, bursts and the quality block — for a scripted message:
 * type 12 characters, pause 3 s, backspace twice, jump back to revise earlier
 * text, then finish and send.
 */
function realTypingWindow(sessionId) {
    const aggregator = new TypingAggregator();
    let t = 1000;
    let len = 0;
    aggregator.start({ timestamp: t });
    const edit = ({ gap, delta, caret }) => {
        t += gap;
        const prev = len;
        len += delta;
        aggregator.record({
            timestamp: t, wallTimestamp: Date.now() - 30_000 + t, inputType: delta < 0 ? 'deleteContentBackward' : 'insertText',
            previousGraphemes: prev, currentGraphemes: len, caretOffset: caret ?? len,
            previousWords: Math.floor(prev / 5), currentWords: Math.floor(len / 5),
            boundaryContext: len % 6 === 0 ? 'word_boundary' : 'mid_word',
        });
    };
    // Uneven, human-looking rhythm: quick runs, a hesitation at a word boundary,
    // a long planning pause, two backspaces, a jump back to revise, a typo fixed
    // on the spot, then a finish.
    const typeRun = (gaps) => gaps.forEach((gap) => edit({ gap, delta: 1 }));
    typeRun([180, 95, 120, 210, 140, 105, 160, 90, 130, 115, 250, 125]);
    edit({ gap: 3200, delta: -1 });
    edit({ gap: 170, delta: -1 });
    [240, 150, 185].forEach((gap, i) => edit({ gap, delta: 1, caret: 2 + i }));
    typeRun([900, 140, 110, 95, 175]);
    // A typo caught at once: a quick backspace mid-run ends that burst in a revision.
    edit({ gap: 150, delta: -1 });
    typeRun([220, 120, 135, 260, 100, 145, 115, 190, 105, 130]);
    const { typing, quality } = aggregator.finalize({ timestamp: t + 700, reason: 'submitted' });
    const start = new Date(Date.now() - 30_000);
    return {
        ...ENVELOPE, session_id: String(sessionId), modality: 'typing', window_kind: 'episode',
        window_start: start.toISOString(), window_end: new Date(start.getTime() + 12_000).toISOString(),
        typing, quality,
    };
}

/**
 * The dashboard scrolls inside its own panel, so a full-page screenshot stops at
 * the viewport. Grow the viewport to the panel's content height, then shoot.
 */
async function shootWholeTab(page, file, width = 1440) {
    await page.setViewportSize({ width, height: 900 });
    const height = await page.evaluate(() => {
        const scrollers = [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 4
            && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
        return Math.max(900, ...scrollers.map((el) => el.scrollHeight + 60));
    });
    await page.setViewportSize({ width, height: Math.min(height, 12_000) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
}

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
            typingWindow(sid, {
                cpm: 96, revision: 0.08, latency: 1400, hist: [14, 5, 2, 1, 0], kept: 0.92, pBursts: 3, rBursts: 1, locations: [3, 9, 2, 0],
            }),
            typingWindow(sid, {
                cpm: 132, revision: 0.22, latency: 2600, hist: [9, 6, 3, 2, 1], kept: 0.81, pBursts: 2, rBursts: 2, locations: [5, 6, 1, 0],
            }),
            typingWindow(sid, {
                cpm: 150, revision: 0.31, latency: 800, hist: [6, 2, 1, 0, 0], kept: 0.64, pBursts: 1, rBursts: 2, locations: [2, 3, 0, 0],
                pasted: 12, submitted: false,
            }),
            voiceWindow(sid, { duration: 5200, speech: 0.58, initial: 900, pauseCount: 2, pauseTotal: 700, segmentMean: 1500, pitch: 182, hist: [1, 1, 0, 0, 0] }),
            voiceWindow(sid, { duration: 7400, speech: 0.66, initial: 600, pauseCount: 3, pauseTotal: 1100, segmentMean: 1600, pitch: 176, hist: [1, 2, 0, 0, 0] }),
            voiceWindow(sid, { duration: 3100, speech: 0.71, initial: 350, pauseCount: 1, pauseTotal: 300, segmentMean: 2200, pitch: 171, hist: [1, 0, 0, 0, 0] }),
            // A click-and-release: all silence, Oyon could not measure it.
            voiceWindow(sid, { duration: 900, speech: 0, initial: 900, insufficient: true }),
            voiceWindow(sid, { duration: 9800, speech: 0.62, initial: 1400, pauseCount: 5, pauseTotal: 2100, segmentMean: 1200, pitch: 164, hist: [2, 2, 1, 0, 0] }),
            voiceWindow(sid, { duration: 6100, speech: 0.74, initial: 500, pauseCount: 2, pauseTotal: 600, segmentMean: 2250, pitch: 168, hist: [1, 1, 0, 0, 0] }),
        ], [
            ...stateEvents(`cap_a_${STAMP}`, 'typing', ['start', 'insert', 'insert', 'pause', 'delete', 'submit']),
            ...stateEvents(`cap_a_voice_${STAMP}`, 'voice', ['start', 'speech', 'silence', 'pause', 'speech', 'end']),
        ]);
        const insertedB = await seedLearner(baseURL, tokenB, theCase.id, SECOND.name, (sid) => [
            typingWindow(sid, {
                cpm: 188, revision: 0.04, latency: 1100, hist: [18, 4, 1, 0, 0], kept: 0.95, pBursts: 4, rBursts: 0, locations: [1, 10, 3, 1],
            }),
            typingWindow(sid, {
                cpm: 236, revision: 0.08, latency: 1900, hist: [15, 3, 2, 1, 0], kept: 0.9, pBursts: 3, rBursts: 1, locations: [2, 7, 2, 0],
            }),
            voiceWindow(sid, { duration: 4200, speech: 0.46, initial: 1200, pauseCount: 2, pauseTotal: 800, segmentMean: 1000, pitch: 213, hist: [1, 1, 0, 0, 0] }),
            voiceWindow(sid, { duration: 6600, speech: 0.52, initial: 1500, pauseCount: 4, pauseTotal: 1500, segmentMean: 850, pitch: 205, hist: [1, 2, 1, 0, 0] }),
            voiceWindow(sid, { duration: 5000, speech: 0.44, initial: 1800, pauseCount: 3, pauseTotal: 900, segmentMean: 730, pitch: 219, hist: [2, 1, 0, 0, 0] }),
        ], [
            ...stateEvents(`cap_b_${STAMP}`, 'typing', ['start', 'insert', 'pause', 'insert', 'submit']),
            ...stateEvents(`cap_b_voice_${STAMP}`, 'voice', ['start', 'speech', 'playback', 'end']),
        ]);
        // A second case holding one real aggregator window, for the writing-process charts.
        const admin3 = await apiAsAdmin(baseURL);
        try {
            const created = await admin3.post('/api/cases', {
                data: {
                    name: `Writing process ${STAMP}`,
                    description: 'e2e: writing-process charts',
                    system_prompt: 'You are a test patient.',
                    config: { demographics: { name: 'Test', age: 40, gender: 'Male' } },
                },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
            processCaseId = (await created.json()).id;
        } finally { await admin3.dispose(); }
        const insertedProcess = await seedLearner(baseURL, tokenA, processCaseId, 'Demo Student', (sid) => {
            processWindow = realTypingWindow(sid);
            return [processWindow];
        });
        expect(insertedProcess).toBe(1);
        expect(insertedA).toBe(9);
        expect(insertedB).toBe(5);
        fs.mkdirSync(SHOTS, { recursive: true });
    });

    test.afterAll(async ({ baseURL }) => {
        await setTenantVoice(baseURL, false);
    });

    test('the Text tab summarises typing per learner, each learner counting once', async ({ adminPage }) => {
        await openAnalyticsTab(adminPage, 'Text');
        const card = (label) => adminPage.getByText(label, { exact: true }).first().locator('xpath=..');

        await expect(card('Typing speed')).toBeVisible({ timeout: 20_000 });
        // Cohort speed: median of per-learner medians — A 132, B 212 → 172, IQR 152–192.
        // Pooling all five messages would give 150.
        await expect(card('Typing speed')).toContainText('172');
        await expect(card('Typing speed')).toContainText('IQR 152–192');
        // Revision: A 0.22, B 0.06 → 0.14, IQR 0.10–0.18.
        await expect(card('Revision ratio')).toContainText('0.14');
        await expect(card('Revision ratio')).toContainText('IQR 0.10–0.18');
        await expect(card('Messages')).toContainText('5');
        await expect(card('Messages')).toContainText('2 learners · 2 sessions');
        // 4 of 5 messages sent; one (A's third) had pasted text.
        await expect(card('Sent')).toContainText('80%');
        await expect(card('With paste')).toContainText('20%');

        // Caret context was recorded for every message: 13 + 35 + 8 + 1 = 57 pauses.
        await expect(adminPage.getByText('57 pauses from 5 messages')).toBeVisible();
        // Keystroke pause histograms pooled: 62 + 20 + 9 + 4 + 1 = 96.
        await expect(adminPage.getByText('96 pauses pooled across the selection')).toBeVisible();

        const byLearner = adminPage.getByRole('heading', { name: 'By learner' }).locator('xpath=ancestor::section[1]');
        await expect(byLearner.getByRole('row')).toHaveCount(3); // header + 2 learners
        await expect(byLearner.getByText(SECOND.name)).toBeVisible();

        await adminPage.setViewportSize({ width: 1440, height: 900 });
        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-text-tab.png'), fullPage: true });
        await shootWholeTab(adminPage, 'analytics-text-tab-full.png');

        // Phone width: the tab reflows, nothing pushes the page sideways.
        await adminPage.setViewportSize({ width: 390, height: 844 });
        await expect(card('Typing speed')).toBeVisible();
        const overflow = await adminPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await shootWholeTab(adminPage, 'analytics-text-tab-phone.png', 390);
    });

    test('the Voice tab keeps unmeasurable turns out of the figures and says why', async ({ adminPage }) => {
        await openAnalyticsTab(adminPage, 'Voice');
        const card = (label) => adminPage.getByText(label, { exact: true }).first().locator('xpath=..');

        await expect(card('Speaking share')).toBeVisible({ timeout: 20_000 });
        // A 0.66, B 0.46 → 56%, IQR 51%–61%. 55% would mean the insufficient
        // turn (speech 0) leaked into A's median.
        await expect(card('Speaking share')).toContainText('56%');
        await expect(card('Speaking share')).toContainText('IQR 51%–61%');
        // A: 6 turns (1 insufficient), B: 3 → 9 turns, 8 measured, 1 of 9 not measurable.
        await expect(card('Turns')).toContainText('9');
        await expect(card('Turns')).toContainText('8 measured · 11% not measurable');
        // Measured turns' pause histograms only: 10 + 10 + 2 = 22.
        await expect(adminPage.getByText('22 pauses pooled across the selection')).toBeVisible();

        await expect(adminPage.getByRole('heading', { name: 'Turns that could not be measured' })).toBeVisible();
        await expect(adminPage.getByText(/Too little speech to measure/)).toBeVisible();

        // One session's turns: A's session holds six turns, the fourth not measurable.
        await expect(adminPage.getByRole('heading', { name: 'Turns in one session' })).toBeVisible();
        const session = adminPage.getByRole('heading', { name: 'Turns in one session' }).locator('xpath=ancestor::section[1]');
        await session.getByLabel('Learner').selectOption({ label: 'Demo Student' });
        await expect(session.getByText('Across turns')).toBeVisible();
        await expect(session.getByText('Median pitch')).toBeVisible();
        // "Latest" skips the unmeasurable turn: A's last measured speaking share is 74%.
        await expect(session.getByText('Speaking share', { exact: true }).locator('xpath=..')).toContainText(/74%\s*latest/);
        // The unmeasurable turn has no pitch: a gap, stated, not a zero.
        await expect(session.getByText('5 of 6 turns measured — the rest: too few voiced frames.')).toBeVisible();
        await expect(session.getByText('Silence before speaking', { exact: true })).toBeVisible();
        await adminPage.setViewportSize({ width: 1440, height: 2400 });
        await session.scrollIntoViewIfNeeded();
        await session.screenshot({ path: path.join(SHOTS, 'analytics-voice-session.png') });

        await adminPage.setViewportSize({ width: 1440, height: 900 });
        await adminPage.screenshot({ path: path.join(SHOTS, 'analytics-voice-tab.png'), fullPage: true });
        await shootWholeTab(adminPage, 'analytics-voice-tab-full.png');
    });

    test('the Text tab draws the writing process of one real message', async ({ adminPage }) => {
        await openAnalyticsTab(adminPage, 'Text', processCaseId);
        await expect(adminPage.getByRole('heading', { name: 'Writing process' })).toBeVisible({ timeout: 20_000 });

        for (const title of ['Progression', 'Production curve', 'Pause-length distribution', 'Burst strip']) {
            await expect(adminPage.getByText(title, { exact: true })).toBeVisible();
        }
        // The strip rebuilds bursts from the stored per-edit series and checks
        // them against the counts Oyon's aggregator reported for this window.
        const { p_burst_count: p, r_burst_count: r } = processWindow.typing;
        expect(p + r).toBeGreaterThan(1);
        await expect(adminPage.getByText(`Rebuilt ${p} P / ${r} R — matches the counts Oyon reported.`)).toBeVisible();
        // The stored quality block reached the chart: its pause threshold labels the histogram.
        const threshold = processWindow.quality.thresholds.burst_threshold_ms / 1000;
        await expect(adminPage.getByText(`pause threshold ${threshold}s`)).toBeVisible();
        await expect(adminPage.getByRole('heading', { name: 'Where learners pause' })).toBeVisible();

        // The dashboard scrolls inside its own panel, so a tall viewport is what
        // lets one screenshot hold the whole section.
        await adminPage.setViewportSize({ width: 1440, height: 3200 });
        const section = adminPage.getByRole('heading', { name: 'Writing process' }).locator('xpath=ancestor::section[1]');
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({ path: path.join(SHOTS, 'analytics-writing-process.png') });
    });

    test('Network → Typing builds one sequence per capture from the stored state log', async ({ adminPage }) => {
        await openNetworkSource(adminPage, 'typing-states');
        const card = (label) => adminPage.getByText(label, { exact: true }).locator('xpath=..');
        // Two captures (A, B); A has 6 actions, B 5 → 11; states: Start Insert Pause Delete Send → 5.
        await expect(card('Capture sequences')).toContainText('2', { timeout: 20_000 });
        await expect(card('Typing actions')).toContainText('11');
        await expect(card('States')).toContainText('5');
        await expect(adminPage.locator('svg text', { hasText: /^Delete$/ }).first()).toBeVisible();
        await shootWholeTab(adminPage, 'analytics-network-typing.png');
    });

    test('Network → Voice builds the speech, silence and pause network', async ({ adminPage }) => {
        await openNetworkSource(adminPage, 'voice-states');
        const card = (label) => adminPage.getByText(label, { exact: true }).locator('xpath=..');
        // A: 6 states, B: 4 → 10; Turn start, Speech, Silence, Pause, Turn end, Patient speaking → 6.
        await expect(card('Capture sequences')).toContainText('2', { timeout: 20_000 });
        await expect(card('Voice states')).toContainText('10');
        await expect(card('States')).toContainText('6');
        await expect(adminPage.locator('svg text', { hasText: /^Patient speaking$/ }).first()).toBeVisible();
        await shootWholeTab(adminPage, 'analytics-network-voice.png');
    });
});
