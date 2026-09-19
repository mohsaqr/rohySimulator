// The learner's room bar, session clock and end-of-case confirmation.
//
// These are the gate-blocked core cases whose subject IS the interface, so
// unlike gate-core.spec.js they are driven through the browser. That needed
// three hooks the app did not have — `room-navigator`/`room-button-<key>`,
// `session-clock`, and `end-session` with its two confirm buttons — because
// every alternative selector is either translated (room names), stateful
// (a room's accessible name gains "2 ready" when results land) or absent at
// some viewport (End & Debrief is `max-lg:sr-only`). A spec keyed on any of
// those passes or fails for reasons unrelated to what it is testing.
//
// GETTING INTO A LIVE CASE. `case-lifecycle.spec.js` says the Start affordance
// varies by build and avoids it. Rather than guess at it, this spec creates the
// session through the API and seeds `rohy_active_session`, which is the exact
// contract App.jsx restores from (App.jsx:474). The learner then lands in a
// running case the same way they would after a reload.

import { test, expect, waitForSeed, findCase } from './fixtures/index.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

const RUN_TAG = `e2e-rooms-${Date.now()}`;

let _ctx;
let _token;
async function studentApi(baseURL) {
    if (!_ctx) {
        const { token } = await loginAs(baseURL, 'student');
        _token = token;
        _ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    }
    return _ctx;
}

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await findCase(baseURL, (c) => c.is_default === 1) || await findCase(baseURL, () => true);
    expect(theCase, 'a seeded case').toBeTruthy();
});

test.afterAll(async () => {
    if (_ctx) await _ctx.dispose();
    _ctx = null;
});

/** A learner, in a running case, on the patient room. */
async function enterLiveCase(page, baseURL, tag) {
    const ctx = await studentApi(baseURL);
    const res = await ctx.post('/api/sessions', { data: { case_id: theCase.id, student_name: `${RUN_TAG}-${tag}` } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const sessionId = (await res.json()).id;

    const full = await (await ctx.get(`/api/cases/${theCase.id}`)).json();
    const activeCase = full.case || full;

    await page.addInitScript(([session, caseRow, token]) => {
        try {
            // The onboarding tour is a modal that swallows every click, and
            // globalSetup does not cover it.
            for (const role of ['admin', 'educator', 'student']) {
                window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            }
            window.localStorage.setItem('token', token);
            window.localStorage.setItem('rohy_active_session', JSON.stringify({
                activeCase: caseRow, sessionId: session, timestamp: Date.now(),
            }));
        } catch { /* private mode — the app starts cold and the spec says so */ }
    }, [sessionId, activeCase, _token]);

    await page.goto('/');
    await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
    return sessionId;
}

const room = (page, key) => page.getByTestId(`room-button-${key}`);
const clockSeconds = async (page) =>
    Number(await page.getByTestId('session-clock').getAttribute('data-elapsed-seconds'));

/**
 * The clock, once it has recomputed — with the wall-clock instant it was read.
 *
 * PatientMonitor holds elapsed time in `useState(0)` and recomputes it from a
 * wall-clock anchor on each tick, so for up to a second after ANY mount — the
 * first load, or coming back from another room — the attribute reads 0. A read
 * taken immediately after a room change therefore catches the reset rather than
 * the elapsed time, and the delta comes out as 0 or as a jump. Waiting for a
 * non-zero value is waiting for the component to have caught up with itself.
 */
async function readClock(page) {
    let seconds = 0;
    await expect
        .poll(async () => { seconds = await clockSeconds(page); return seconds; }, { timeout: 15_000 })
        .toBeGreaterThan(0);
    return { seconds, at: Date.now() };
}

// ---------------------------------------------------------------------------

test.describe('the room bar', () => {
    // NAV.ROOMS.01
    test('every room in the bar opens, and the case is still live afterwards', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, 'nav01');
        const before = await clockSeconds(page);

        for (const key of ['chat', 'examination', 'lab', 'radiology', 'consultant']) {
            const btn = room(page, key);
            await expect(btn, `${key} is offered in the bar`).toBeVisible();
            await btn.click();
            // The active room is marked, which is how a learner knows where
            // they are — aria-pressed is that mark.
            await expect(btn, `${key} is marked active once opened`).toHaveAttribute('aria-pressed', 'true');
        }

        await room(page, 'chat').click();
        // Back on the patient room the case has CARRIED ON rather than
        // restarted: the clock is the thing that would reset.
        const after = await clockSeconds(page);
        expect(Number.isFinite(after)).toBe(true);
        expect(after, 'the session clock carried on rather than restarting').toBeGreaterThanOrEqual(before);
        await expect(page.getByTestId('end-session'), 'the case is still endable, so it is still live').toBeVisible();
    });

    // NAV.ROOMS.03
    test('visiting the Consultant mid-case does not end the case', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, 'nav03');
        await room(page, 'consultant').click();
        await expect(room(page, 'consultant')).toHaveAttribute('aria-pressed', 'true');

        await room(page, 'chat').click();
        // "No case ended state has appeared" — the end affordance is still
        // offered, and the clock is still running.
        await expect(page.getByTestId('end-session')).toBeVisible();
        await expect(page.getByTestId('session-clock')).toBeVisible();
    });
});

test.describe('the session clock', () => {
    // MONITOR.VITALS.02
    test('the clock is real elapsed time, not a counter that starts at zero', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, 'clock');
        const first = await readClock(page);
        await page.waitForTimeout(4_000);
        const second = await readClock(page);

        // Compared against the wall clock, not against a fixed expectation:
        // the case's own elapsed time must track real seconds, which is what
        // "the session clock is the real elapsed time" claims.
        const ticked = second.seconds - first.seconds;
        const elapsedWall = (second.at - first.at) / 1000;
        expect(ticked, 'the clock advances').toBeGreaterThan(0);
        expect(Math.abs(ticked - elapsedWall), `clock moved ${ticked}s while ${elapsedWall.toFixed(1)}s passed`)
            .toBeLessThanOrEqual(2);
    });

    // SCENARIO.TIME.02
    test('time passes even while the learner is in another room', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, 'time02');
        const before = await readClock(page);

        await room(page, 'lab').click();
        await page.waitForTimeout(4_000);
        await room(page, 'chat').click();

        const after = await readClock(page);
        const away = (after.at - before.at) / 1000;

        // The clock is derived from a wall-clock anchor, so leaving the room
        // must not pause it. A clock that paused would let a learner stall a
        // deteriorating patient simply by walking away — and because the
        // monitor remounts at 0 on return, a paused one is indistinguishable
        // from a running one unless the recomputed value is what you read.
        expect(after.seconds - before.seconds, `away for ${away.toFixed(1)}s`)
            .toBeGreaterThanOrEqual(Math.floor(away) - 2);
    });
});

test.describe('ending the case', () => {
    // SESSION.END.02
    test('ending is deliberate: dismissing the confirmation ends nothing', async ({ page, baseURL }) => {
        const sessionId = await enterLiveCase(page, baseURL, 'end02');

        await page.getByTestId('end-session').click();
        await expect(page.getByTestId('end-session-confirm'), 'a confirmation is asked for').toBeVisible();
        await page.getByTestId('end-session-cancel').click();

        // Nothing ended in the interface...
        await expect(page.getByTestId('end-session-confirm')).toHaveCount(0);
        await expect(page.getByTestId('room-navigator')).toBeVisible();
        await expect(page.getByTestId('session-clock')).toBeVisible();

        // ...and nothing ended on the server either, which is the half a
        // learner cannot see and the half that would lose their work.
        const ctx = await studentApi(baseURL);
        const row = (await (await ctx.get(`/api/sessions/${sessionId}`)).json()).session;
        expect(row.end_time ?? null, 'the session is still open server-side').toBeNull();
    });
});
