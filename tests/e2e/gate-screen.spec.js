// Core cases whose expected result is what the learner SEES: starting and
// ending a case, the monitor, and the laboratory worklist. Each test asserts
// every clause of its case's `expected` text in prova/rohy-cases.yaml, in the
// browser, because a case only counts as automated when nothing in it is left
// for a person to check.
//
// Entry into a running case is `fixtures/liveCase.js` (the session is made
// through the API and the app restores it), except SESSION.START.01, whose
// subject IS the way in.

import { test, expect, waitForSeed, apiAsAdmin } from './fixtures/index.js';
import { enterLiveCase, learnerApi, disposeLearnerApi, pickCase, room, clockSeconds } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-screen-${Date.now()}`;

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await pickCase(baseURL);
});

test.afterAll(disposeLearnerApi);

/** The case as the learner reads it (config included). */
async function caseConfig(baseURL, id) {
    const ctx = await learnerApi(baseURL);
    const full = await (await ctx.get(`/api/cases/${id}`)).json();
    const row = full.case || full;
    return typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
}

/**
 * The trace on a monitor canvas, as one height per pixel column: the mean
 * row of the signal's coloured pixels (the grid is grey and is ignored).
 * Columns with no signal are null.
 */
function traceProfile(page, key) {
    return page.getByTestId(`monitor-trace-${key}`).evaluate((canvas) => {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        if (!width || !height) return [];
        const { data } = ctx.getImageData(0, 0, width, height);
        const columns = [];
        for (let x = 0; x < width; x++) {
            let sum = 0;
            let n = 0;
            for (let y = 0; y < height; y++) {
                const i = (y * width + x) * 4;
                const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
                if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 60) { sum += y; n++; }
            }
            columns.push(n ? sum / n : null);
        }
        return columns;
    });
}

/**
 * How far the trace moved between two profiles: the shift k for which
 * `later[x]` best matches `earlier[x + k]`. Positive k means the picture moved
 * LEFT — new signal entering on the right.
 */
function bestShift(earlier, later, maxShift = 120) {
    let best = { k: 0, err: Infinity };
    for (let k = -maxShift; k <= maxShift; k++) {
        let err = 0;
        let n = 0;
        for (let x = 0; x < later.length; x++) {
            const a = later[x];
            const b = earlier[x + k];
            if (a == null || b == null) continue;
            err += Math.abs(a - b);
            n++;
        }
        if (n > later.length / 3 && err / n < best.err) best = { k, err: err / n };
    }
    return best;
}

const vital = (page, key) => page.getByTestId(`vital-${key}`);

/**
 * Tick the first test the catalogue lists (after an optional search) and
 * return its name. The catalogue re-renders once its list has loaded, which
 * drops a selection made before that — so wait for the list to hold still,
 * then tick, then confirm the tick took.
 */
async function pickFirstTest(page, search) {
    if (search) await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill(search);
    const items = page.getByTestId('catalogue-item');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    let count = -1;
    await expect.poll(async () => { const n = await items.count(); const same = n === count; count = n; return same; },
        { intervals: [500], timeout: 10_000 }).toBe(true);
    const item = items.first();
    const testName = (await item.innerText()).split('\n')[0].trim();
    const box = item.locator('input[type="checkbox"]');
    await box.click();
    await expect(box).toBeChecked();
    return testName;
}

/**
 * A student with no session history: the app resumes a learner's open
 * session from the server, so "before any case is chosen" needs a learner
 * who has never had one.
 */
async function freshStudentToken(baseURL) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const username = `fresh${Date.now().toString(36)}`;
        const password = `Fresh${Date.now().toString(36)}9`;
        const made = await admin.post('/api/users/create', { data: {
            username, name: 'Fresh Student', email: `${username}@e2e.local`, password, role: 'student',
        } });
        expect(made.ok(), await made.text()).toBeTruthy();
        const login = await admin.post('/api/auth/login', { data: { username, password } });
        expect(login.ok(), await login.text()).toBeTruthy();
        const { token } = await login.json();
        // Past the first-run welcome page, the way globalSetup passes the
        // seeded student: that page is its own case, not this one.
        const pref = await admin.put('/api/users/preferences', {
            headers: { Authorization: `Bearer ${token}` },
            data: { onboarding_settings: { first_run_done: 1, oyon_consent: false } },
        });
        expect(pref.ok(), await pref.text()).toBeTruthy();
        return token;
    } finally {
        await admin.dispose();
    }
}

// ---------------------------------------------------------------------------

test.describe('starting a case', () => {
    // SESSION.START.01
    test('choosing a case from the case list puts the learner straight into a live consultation', async ({ page, baseURL }) => {
        const config = await caseConfig(baseURL, theCase.id);
        const token = await freshStudentToken(baseURL);
        await page.addInitScript((t) => {
            for (const role of ['admin', 'educator', 'student']) {
                window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            }
            window.localStorage.setItem('token', t);
        }, token);
        await page.goto('/');

        // A learner with no saved case lands in the platform's default case,
        // already running: there is no empty pane and no Start step.
        // ("No Case Selected." only shows on a platform with no default case.)
        await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('end-session')).toBeVisible();
        const sessionOf = () => page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('rohy_active_session') || '{}').sessionId ?? null; } catch { return null; }
        });
        await expect.poll(sessionOf, { timeout: 10_000 }).not.toBeNull();
        const landedIn = await sessionOf();

        // The menu's Cases item opens the case list, and choosing the case
        // starts it.
        await page.getByTestId('topbar-menu').click();
        await page.getByTestId('menu-cases').click();
        const load = page.getByTestId(`case-load-${theCase.id}`);
        await expect(load, 'Cases opens on the case list').toBeVisible({ timeout: 15_000 });
        await load.click();
        await expect.poll(sessionOf, { message: 'choosing the case starts a new consultation', timeout: 15_000 })
            .not.toBe(landedIn);

        // Running at once: the room bar is there and no Start step is asked of
        // the learner.
        await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
        // No Start step on screen (hidden panels may hold their own Start).
        await expect(page.locator('button:visible').filter({ hasText: /^\s*(start|begin)\b/i })).toHaveCount(0);
        await expect(page.getByTestId('end-session'), 'the case is live').toBeVisible();

        // The monitor is tracing: the ECG picture changes from one moment to
        // the next.
        const before = await traceProfile(page, 'ecg');
        await page.waitForTimeout(600);
        const after = await traceProfile(page, 'ecg');
        expect(before.filter((v) => v != null).length, 'the ECG trace is drawn').toBeGreaterThan(50);
        expect(JSON.stringify(after), 'the ECG trace is moving').not.toEqual(JSON.stringify(before));

        // The patient has already spoken, when the case has a greeting.
        if (config.greeting) {
            const opening = config.greeting.split(/[.!?]/)[0].replace(/[*]/g, '').trim().slice(0, 40);
            await expect(page.getByTestId('chat-turn').filter({ hasText: opening }).first(),
                'the greeting is in the chat').toHaveAttribute('data-role', 'assistant', { timeout: 15_000 });
        }
    });
});

test.describe('ending a case', () => {
    // SESSION.END.01
    test('End & Debrief opens the debrief, and the patient room is plainly over afterwards', async ({ page, baseURL }) => {
        const sessionId = await enterLiveCase(page, baseURL, `${RUN_TAG}-end`, theCase);
        await page.getByTestId('end-session').click();
        await page.getByTestId('end-session-confirm').click();

        // The debrief opens.
        await expect(page.getByTestId('room-view')).toHaveAttribute('data-room', 'consultant', { timeout: 15_000 });
        await expect(room(page, 'consultant')).toHaveAttribute('aria-pressed', 'true');

        await page.getByRole('button', { name: 'Back to patient' }).click();
        await expect(page.getByTestId('room-view')).toHaveAttribute('data-room', 'chat');

        // The clock is marked as ended and frozen.
        await expect(page.getByTestId('monitor-case-ended')).toBeVisible();
        // Coming back remounts the monitor, which shows 0:00 until it has re-read the session's
        // start and then settles on the ended time (CI 2026-10-14 read "0" in that moment and
        // "2" after it). Take the reading once two reads a second apart agree.
        let first = null;
        await expect.poll(async () => {
            const before = await clockSeconds(page);
            await page.waitForTimeout(1_000);
            first = await clockSeconds(page);
            return before === first;
        }, { timeout: 15_000 }).toBe(true);
        await page.waitForTimeout(3_000);
        expect(await clockSeconds(page), 'the clock no longer moves').toBe(first);

        // The composer refuses messages, and the end button is gone.
        await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
        await expect(page.getByTestId('end-session')).toHaveCount(0);

        const ctx = await learnerApi(baseURL);
        const row = (await (await ctx.get(`/api/sessions/${sessionId}`)).json()).session;
        expect(row.end_time, 'the session is closed on the server').toBeTruthy();
    });
});

test.describe('the monitor', () => {
    // MONITOR.VITALS.01
    test('three traces scroll right to left, and the numbers carry units and drift', async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-monitor`, theCase);

        // Each trace moves LEFT: the picture a moment later is the earlier one
        // shifted left, with new signal arriving on the right.
        for (const key of ['ecg', 'pleth', 'resp']) {
            await expect(page.getByTestId(`monitor-trace-${key}`)).toBeVisible();
            let shift;
            await expect.poll(async () => {
                const a = await traceProfile(page, key);
                await page.waitForTimeout(250);
                const b = await traceProfile(page, key);
                shift = bestShift(a, b);
                return shift.k;
            }, { message: `the ${key} trace scrolls right to left`, timeout: 20_000 }).toBeGreaterThan(0);
        }

        // Sensible clinical values, each with its unit.
        const expectations = {
            hr: { unit: 'bpm', min: 20, max: 250 },
            spo2: { unit: '%', min: 50, max: 100 },
            rr: { unit: 'rpm', min: 4, max: 60 },
            temp: { unit: '°C', min: 30, max: 43 },
            etco2: { unit: 'mmHg', min: 5, max: 100 },
        };
        for (const [key, { unit, min, max }] of Object.entries(expectations)) {
            const box = vital(page, key);
            await expect(box, `${key} shows its unit`).toContainText(unit);
            const value = Number(await box.getAttribute('data-value'));
            expect(value, `${key} = ${value}`).toBeGreaterThanOrEqual(min);
            expect(value, `${key} = ${value}`).toBeLessThanOrEqual(max);
        }
        const [sys, dia] = (await vital(page, 'nibp').getAttribute('data-value')).split('/').map(Number);
        expect(sys, 'systolic').toBeGreaterThan(dia);
        expect(dia, 'diastolic').toBeGreaterThan(20);
        await expect(vital(page, 'nibp'), 'NIBP shows its unit').toContainText('mmHg');

        // The digits drift rather than standing still.
        const seen = { hr: new Set(), spo2: new Set(), rr: new Set() };
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && Object.values(seen).some((s) => s.size < 2)) {
            for (const key of Object.keys(seen)) seen[key].add(await vital(page, key).getAttribute('data-value'));
            await page.waitForTimeout(1_000);
        }
        const drifting = Object.entries(seen).filter(([, s]) => s.size >= 2).map(([k]) => k);
        expect(drifting.length, `values that moved in 30 s: ${drifting.join(', ') || 'none'}`).toBeGreaterThan(0);
    });
});

test.describe('the laboratory worklist', () => {
    // CASE.LABS.01
    test('an ordered test counts down under Pending, turns Ready by itself, and opens as a report', async ({ page, baseURL }) => {
        test.setTimeout(300_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-labs01`, theCase);
        await room(page, 'lab').click();
        const testName = await pickFirstTest(page, 'troponin');
        await page.getByRole('button', { name: /^Order 1 test$/ }).click();

        // Pending, with a countdown that goes down.
        const row = page.getByTestId('worklist-row').filter({ hasText: testName }).first();
        await expect(row).toHaveAttribute('data-status', 'pending', { timeout: 15_000 });
        const remaining = async () => Number(await row.getAttribute('data-minutes-remaining'));
        const first = await remaining();
        expect(first, 'a countdown is shown').toBeGreaterThan(0);
        const firstLabel = await row.innerText();
        await expect.poll(remaining, { message: 'the countdown decreases', timeout: 90_000 }).toBeLessThan(first);
        expect(await row.innerText(), 'and the learner can see it change').not.toEqual(firstLabel);

        // Ready by itself, without leaving the room.
        const ready = page.getByTestId('worklist-row').filter({ hasText: testName }).first();
        await expect(ready).toHaveAttribute('data-status', 'ready', { timeout: 240_000 });

        // Clicking it opens a readable report, and the order counts as viewed.
        await ready.click();
        const report = page.locator('#lab-results-report');
        await expect(report).toBeVisible();
        await expect(report).toContainText(testName);
        await room(page, 'chat').click();
        await room(page, 'lab').click();
        await expect(page.getByTestId('worklist-row').filter({ hasText: testName }).first())
            .toHaveAttribute('data-status', 'viewed', { timeout: 15_000 });
    });

    // CASE.LABS.03
    test('Order instantly lands the result as Ready at once, and says it was instant', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-labs03`, theCase);
        await room(page, 'lab').click();
        const testName = await pickFirstTest(page);
        await page.getByRole('button', { name: 'Order instantly' }).click();

        await expect(page.getByRole('status').filter({ hasText: /instant/i }).first(),
            'the confirmation says the order was instant').toBeVisible();
        const row = page.getByTestId('worklist-row').filter({ hasText: testName }).first();
        await expect(row, 'Ready straight away').toHaveAttribute('data-status', 'ready', { timeout: 5_000 });
        await expect(page.getByTestId('worklist-row').filter({ hasText: testName }).and(page.locator('[data-status="pending"]')),
            'never shown as pending').toHaveCount(0);
    });

    // NAV.ROOMS.02
    test('a ready result is advertised on the Laboratory button until it is opened, and nowhere else', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-badge`, theCase);
        await expect(page.locator('[data-testid^="room-badge-"]'), 'no badge before any result').toHaveCount(0);

        await room(page, 'lab').click();
        const testName = await pickFirstTest(page);
        await page.getByRole('button', { name: 'Order instantly' }).click();
        await expect(page.getByTestId('worklist-row').filter({ hasText: testName }).first())
            .toHaveAttribute('data-status', 'ready', { timeout: 5_000 });

        await room(page, 'chat').click();
        await expect(page.getByTestId('room-badge-lab'), 'a green count on Laboratory').toHaveText('1', { timeout: 15_000 });
        await expect(page.locator('[data-testid^="room-badge-"]'), 'and on no other room').toHaveCount(1);

        await room(page, 'lab').click();
        await page.getByTestId('worklist-row').filter({ hasText: testName }).first().click();
        await expect(page.locator('#lab-results-report')).toBeVisible();
        await room(page, 'chat').click();
        await expect(page.getByTestId('room-badge-lab'), 'gone once the result has been opened').toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('[data-testid^="room-badge-"]')).toHaveCount(0);
    });
});

test.describe('the catalogues', () => {
    // CASE.LABS.02 — the learner's half. The master-list half is in
    // clinical-guardrails.spec.js.
    test('a learner on the chest-pain case finds and can order tests unrelated to chest pain', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-labs02`, theCase);
        await room(page, 'lab').click();
        const search = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first();
        // Each search finds tests (the catalogue also matches by group, so a
        // "thyroid" search can list TSH — what matters is that something is
        // offered, and that it is not the cardiac work-up).
        for (const term of ['thyroid', 'vitamin', 'glucose']) {
            await search.fill(term);
            const first = page.getByTestId('catalogue-item').first();
            await expect(first, `"${term}" is offered`).toBeVisible({ timeout: 10_000 });
            await expect(first).not.toContainText(/troponin|CK-MB|BNP/i);
        }
        // And orderable: one of them goes through.
        const testName = await pickFirstTest(page, 'thyroid');
        await page.getByRole('button', { name: 'Order instantly' }).click();
        await expect(page.getByTestId('worklist-row').filter({ hasText: testName }).first(),
            'the unrelated test was ordered').toHaveAttribute('data-status', 'ready', { timeout: 10_000 });
    });

    // CASE.IMAGING.01
    test('a chest X-ray order opens as a structured report with technique, findings and impression', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-imaging01`, theCase);
        await room(page, 'radiology').click();
        const testName = await pickFirstTest(page, 'chest');
        expect(testName, 'a chest study is offered').toMatch(/chest/i);
        await page.getByRole('button', { name: 'Order instantly' }).click();
        const row = page.getByTestId('worklist-row').filter({ hasText: testName }).first();
        await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 10_000 });
        await row.click();

        const report = page.locator('#radiology-results-report');
        await expect(report).toBeVisible();
        for (const heading of ['Technique', 'Findings', 'Impression']) {
            await expect(report.getByRole('heading', { name: heading }), `the report has ${heading}`).toBeVisible();
        }
        // Laid out as a report, not raw data.
        const text = await report.innerText();
        expect(text, 'no raw JSON in the report').not.toMatch(/[{}[\]]"|":\s*[{["]/);
        expect(text).toContain(testName);
    });
});

test.describe('the admin\'s create-user form', () => {
    // AUTH.PASSWORD.01 — the form's half. The mirror-against-server half is in
    // gate-core.spec.js.
    test('states the password rule, refuses weak passwords before submitting, and the accepted one logs in', async ({ adminPage: page }) => {
        await page.addInitScript(() => {
            for (const role of ['admin', 'educator', 'student']) window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
        });
        await page.goto('/');
        await page.getByTestId('topbar-menu').click();
        await page.getByTestId('menu-settings').click();
        await page.getByRole('button', { name: 'Users', exact: true }).first().click();
        await page.getByRole('button', { name: 'New user' }).click();

        const form = page.getByTestId('user-form');
        await expect(form).toBeVisible();
        const username = `pw${Date.now().toString(36)}`;
        await form.getByLabel(/Username/).fill(username);
        await form.getByLabel(/Email/).fill(`${username}@e2e.local`);
        const password = form.getByLabel(/Password/).first();
        const save = form.getByRole('button', { name: 'Create user' });

        // The rule is stated on the form.
        const rules = form.locator('#user-form-password-rules');
        await expect(rules).toBeVisible();
        await expect(rules).toContainText(/8/);

        // The two weak passwords are refused before anything is submitted.
        let posted = 0;
        page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/users/.test(r.url())) posted++; });
        for (const weak of ['short1A', 'alllowercase1']) {
            await password.fill(weak);
            await expect(password, `${weak} is marked invalid`).toHaveAttribute('aria-invalid', 'true');
            await expect(save, `${weak} cannot be submitted`).toBeDisabled();
        }
        expect(posted, 'nothing was sent for the weak passwords').toBe(0);

        // One that meets the stated rules is accepted, and the save agrees.
        const good = `Accepted${Date.now().toString(36)}9`;
        await password.fill(good);
        await expect(password).toHaveAttribute('aria-invalid', 'false');
        await expect(save).toBeEnabled();
        const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/users/.test(r.url()));
        await save.click();
        expect((await created).ok(), 'the server accepts what the form accepted').toBeTruthy();

        // And the new user can log in with it.
        const login = await page.request.post('/api/auth/login', { data: { username, password: good } });
        expect(login.ok(), await login.text()).toBeTruthy();
    });
});


test.describe('the case editor\'s Rooms step', () => {
    /** Open a case's editor on the Rooms step, from wherever the app is. */
    async function openRoomsStep(page, caseId) {
        await page.goto('/');
        const casesList = page.getByRole('heading', { name: /Manage Cases/i });
        await expect(async () => {
            if (await casesList.isVisible()) return;
            if (await page.getByTestId('topbar-menu').isVisible()) {
                await page.getByTestId('topbar-menu').click();
                await page.getByTestId('menu-cases').click();
            } else if (await page.getByRole('button', { name: /^Cases$/i }).first().isVisible()) {
                await page.getByRole('button', { name: /^Cases$/i }).first().click();
            }
            await expect(casesList).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        await page.getByTestId(`case-edit-${caseId}`).click();
        await page.getByRole('button', { name: /Rooms/ }).filter({ hasText: '🚪' }).first().click();
        await expect(page.getByTestId('case-rooms-step')).toBeVisible({ timeout: 10_000 });
    }

    const toggle = (page, key) => page.getByTestId(`room-toggle-${key}`);

    // CASE.ROOMS.04
    test('switching rooms off keeps their material, explains the effects, survives a save, and switches back unchanged', async ({ adminPage: page, baseURL }) => {
        test.setTimeout(120_000);
        await page.addInitScript(() => {
            for (const role of ['admin', 'educator', 'student']) window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            window.localStorage.removeItem('rohy_editing_case');
        });
        const caseName = `${RUN_TAG} rooms`;
        const labs = [{ test_name: 'Troponin I', current_value: 4.2, unit: 'ng/mL', normal_range: '<0.04' }];
        const admin = await apiAsAdmin(baseURL);
        let caseId;
        const readConfig = async () => {
            const body = await (await admin.get(`/api/cases/${caseId}`)).json();
            const row = body.case || body;
            return typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
        };
        try {
            const made = await admin.post('/api/cases', { data: {
                name: caseName, description: 'rooms step', system_prompt: 'You are a patient.',
                config: { patient_name: 'Rooms Patient', investigations: { labs } },
            } });
            expect(made.ok(), await made.text()).toBeTruthy();
            caseId = (await made.json()).id;

            await openRoomsStep(page, caseId);
            // The patient room is always on and has no switch.
            await expect(page.getByTestId('room-row-chat')).toContainText('Always on');
            await expect(toggle(page, 'chat')).toHaveCount(0);

            // Laboratory off: its material is kept, and the lab is named among
            // the specialists who will not answer.
            await toggle(page, 'lab').click();
            await expect(toggle(page, 'lab')).toHaveAttribute('aria-checked', 'false');
            await expect(page.getByTestId('room-note-lab')).toContainText('is kept');
            await expect(page.getByTestId('rooms-silent-specialists')).toContainText(/Laborator/);
            await page.getByRole('button', { name: 'Save', exact: true }).first().click();
            await expect.poll(async () => (await readConfig()).rooms?.disabled || [], { timeout: 10_000 }).toContain('lab');

            // The switch survives the save: reopened, it is still off.
            await openRoomsStep(page, caseId);
            await expect(toggle(page, 'lab')).toHaveAttribute('aria-checked', 'false');

            // Consultant off: End & Debrief ends on the case summary.
            await toggle(page, 'consultant').click();
            await expect(page.getByTestId('rooms-no-debrief-note')).toContainText('case summary');

            // Both back on and saved: the lab results are exactly as they were.
            await toggle(page, 'consultant').click();
            await toggle(page, 'lab').click();
            await expect(toggle(page, 'lab')).toHaveAttribute('aria-checked', 'true');
            await page.getByRole('button', { name: 'Save', exact: true }).first().click();
            await expect.poll(async () => (await readConfig()).rooms?.disabled || [], { timeout: 10_000 })
                .not.toContain('lab');
            const after = await readConfig();
            expect(after.rooms?.disabled || []).not.toContain('consultant');
            expect(after.investigations?.labs, 'the lab results are unchanged').toEqual(labs);
        } finally {
            if (caseId) await admin.delete(`/api/cases/${caseId}`);
            await admin.dispose();
        }
    });
});
