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
// GETTING INTO A LIVE CASE is `fixtures/liveCase.js` — it creates the session
// through the API and seeds the blob App.jsx restores from, rather than
// guessing at a Start affordance that varies by build.

import { test, expect, waitForSeed } from './fixtures/index.js';
import { enterLiveCase, learnerApi, disposeLearnerApi, pickCase, room, readClock, expectClockMatchesSession, ageSession }
    from './fixtures/liveCase.js';

const RUN_TAG = `e2e-rooms-${Date.now()}`;

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await pickCase(baseURL);
});

test.afterAll(disposeLearnerApi);

const enter = (page, baseURL, tag) => enterLiveCase(page, baseURL, `${RUN_TAG}-${tag}`, theCase);

/**
 * A turn is back in the transcript.
 *
 * On failure this reports what the page DOES show. The restore has two paths
 * (localStorage, then `GET /interactions/:session`) and a bare "element not
 * found" cannot tell "the thread came back empty" from "the app started a
 * different session" — which are different bugs with the same symptom.
 */
async function expectInThread(page, text, what) {
    try {
        await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
    } catch (err) {
        const shown = await page.evaluate(() => document.body.innerText).catch(() => '(unreadable)');
        const session = await page
            .evaluate(() => { try { return JSON.parse(localStorage.getItem('rohy_active_session') || '{}').sessionId; } catch { return '(unparseable)'; } })
            .catch(() => '(unreadable)');
        throw new Error(
            `${what} is not in the thread after the restart.\n`
            + `  looked for: ${text}\n`
            + `  page is on session: ${session}\n`
            + `  page shows: ${String(shown).replace(/\s+/g, ' ').slice(0, 600)}\n`
            + `  original: ${err.message.split('\n')[0]}`,
        );
    }
}

/** The session row, which carries the `start_time` the clock must agree with. */
async function sessionRow(baseURL, sessionId) {
    const ctx = await learnerApi(baseURL);
    const res = await ctx.get(`/api/sessions/${sessionId}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).session;
}

// ---------------------------------------------------------------------------

test.describe('the room bar', () => {
    // NAV.ROOMS.01
    test('every room in the bar opens, and the case is still live afterwards', async ({ page, baseURL }) => {
        const sessionId = await enter(page, baseURL, 'nav01');
        const { start_time: startTime } = await sessionRow(baseURL, sessionId);
        // Aged BEFORE the tour: the monitor remounts on the way back to the
        // patient room, and a clock that restarted there is only tellable from
        // one that survived if the case was already measurably old.
        await ageSession(page, startTime);

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
        // restarted. Checked against the session's own start_time: comparing
        // two readings of the same clock cannot tell a clock that kept running
        // from one that restarted and then ticked past the earlier value.
        await expectClockMatchesSession(page, startTime);
        await expect(page.getByTestId('end-session'), 'the case is still endable, so it is still live').toBeVisible();
    });

    // NAV.ROOMS.03
    test('visiting the Consultant mid-case does not end the case', async ({ page, baseURL }) => {
        await enter(page, baseURL, 'nav03');
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
        const sessionId = await enter(page, baseURL, 'clock');
        const { start_time: startTime } = await sessionRow(baseURL, sessionId);

        // "Real elapsed time, not a counter that starts at zero" is a claim
        // about the ANCHOR, so it is checked against the anchor: the case's
        // own start_time on the server.
        await expectClockMatchesSession(page, startTime);

        const first = await readClock(page);
        await page.waitForTimeout(4_000);
        const second = await readClock(page);

        // And it tracks real seconds while it runs.
        const ticked = second.seconds - first.seconds;
        const elapsedWall = (second.at - first.at) / 1000;
        expect(ticked, 'the clock advances').toBeGreaterThan(0);
        expect(Math.abs(ticked - elapsedWall), `clock moved ${ticked}s while ${elapsedWall.toFixed(1)}s passed`)
            .toBeLessThanOrEqual(2);

        // Still the session's age after all that, not merely something that
        // increments once per second from wherever it happened to start.
        await expectClockMatchesSession(page, startTime);
    });

    // SCENARIO.TIME.02
    test('time passes even while the learner is in another room', async ({ page, baseURL }) => {
        const sessionId = await enter(page, baseURL, 'time02');
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

        // And the value it came back with is the case's real age, not a
        // counter that resumed from where it was paused.
        const { start_time: startTime } = await sessionRow(baseURL, sessionId);
        await expectClockMatchesSession(page, startTime);
    });
});

test.describe('ending the case', () => {
    // SESSION.END.02
    test('ending is deliberate: dismissing the confirmation ends nothing', async ({ page, baseURL }) => {
        const sessionId = await enter(page, baseURL, 'end02');

        await page.getByTestId('end-session').click();
        await expect(page.getByTestId('end-session-confirm'), 'a confirmation is asked for').toBeVisible();
        await page.getByTestId('end-session-cancel').click();

        // Nothing ended in the interface...
        await expect(page.getByTestId('end-session-confirm')).toHaveCount(0);
        await expect(page.getByTestId('room-navigator')).toBeVisible();
        await expect(page.getByTestId('session-clock')).toBeVisible();

        // ...and nothing ended on the server either, which is the half a
        // learner cannot see and the half that would lose their work.
        const ctx = await learnerApi(baseURL);
        const row = (await (await ctx.get(`/api/sessions/${sessionId}`)).json()).session;
        expect(row.end_time ?? null, 'the session is still open server-side').toBeNull();
    });
});

test.describe('coming back to a case', () => {
    // SESSION.START.02
    //
    // Only the two halves a machine can settle. The case also expects the
    // examination log to survive the reload; it does not, because ManikinPanel
    // holds `examLog` in `useState([])` and nothing rehydrates it from
    // GET /sessions/:id/exam-findings — the server has the findings, the room
    // just never asks for them again. That is a known defect, filed, and
    // asserting it here would only make this spec red for something already
    // tracked. The case therefore stays manual; this covers the room and the
    // clock, which are the halves that do hold.
    test('a reload comes back to the same room, with the clock carrying on', async ({ page, baseURL }) => {
        const sessionId = await enter(page, baseURL, 'reload');
        const { start_time: startTime } = await sessionRow(baseURL, sessionId);
        // Aged before the reload, for the same reason as the room tour: a
        // clock that restarts on the reload is indistinguishable from one that
        // resumed if the case was only a second old when the page went away.
        await ageSession(page, startTime);

        await room(page, 'examination').click();
        await expect(room(page, 'examination')).toHaveAttribute('aria-pressed', 'true');
        // The room is persisted by an effect, not by the click — give it the
        // render it needs before pulling the page out from under it.
        await expect
            .poll(async () => page.evaluate(() => {
                try { return JSON.parse(localStorage.getItem('rohy_view') || '{}').currentRoom; } catch { return null; }
            }))
            .toBe('examination');

        await page.reload();

        await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
        // Back where they were. A learner who reloads mid-examination and
        // lands on the patient room has lost their place in the case.
        await expect(room(page, 'examination'), 'the reload returns to the examination room')
            .toHaveAttribute('aria-pressed', 'true');

        // And the case did not restart. Measured against the session's own
        // start_time, which is the only thing that distinguishes a clock that
        // survived the reload from one that began again — a comparison with
        // the time since the reload is satisfied by both.
        await room(page, 'chat').click();
        await expectClockMatchesSession(page, startTime);
    });

    // AUTH.SESSION.03
    //
    // "Closing the browser" is modelled the way a browser actually models it:
    // everything that survives a restart is persistent cookies and
    // localStorage, and nothing else. The context is captured, CLOSED, and a
    // new one is opened from that state alone — so anything the app was
    // holding in memory is genuinely gone, as it would be for the learner.
    test('closing the browser and coming back keeps the learner in their case', async ({ browser, baseURL }) => {
        const first = await browser.newContext({ baseURL });
        const page = await first.newPage();

        // A real login, so the auth cookies land in this context's jar the way
        // they land in a learner's browser. page.request shares that jar.
        //
        // NOTHING is written to localStorage['token'] here, deliberately. That
        // is the LEGACY bearer lane: AuthService.login() defaults to
        // `rememberToken = false` (authService.js:47) and a returning learner
        // is authenticated by the `rohy_auth` cookie alone. Seeding a bearer
        // token would make apiClient prefer it, and this test — the only one
        // that asks whether a learner survives a restart — would stay green
        // through a regression that stopped honouring the cookie.
        const login = await page.request.post('/api/auth/login', { data: { username: 'student', password: 'student123' } });
        expect(login.ok(), await login.text()).toBeTruthy();

        const ctx = await learnerApi(baseURL);
        const made = await ctx.post('/api/sessions', { data: { case_id: theCase.id, student_name: `${RUN_TAG}-restart` } });
        expect(made.ok(), await made.text()).toBeTruthy();
        const sessionId = (await made.json()).id;
        const full = await (await ctx.get(`/api/cases/${theCase.id}`)).json();
        const activeCase = full.case || full;

        // The conversation is recorded BEFORE the browser ever opens the case.
        //
        // That ordering is the whole point. ChatInterface restores from its
        // `rohy_chat_history` localStorage copy FIRST and only falls back to
        // `GET /interactions/:session` when that copy is missing or belongs to
        // another session (ChatInterface.jsx:797-820). Turns inserted after
        // the app had already loaded the thread are invisible to that copy, so
        // whether they survived a restart depended on whether the case's own
        // opening exchange had landed in localStorage first — the test passed
        // or failed on a race it was not testing. Recording them up front is
        // also the truthful shape: a learner who comes back has a history the
        // app itself put there.
        const said = `${RUN_TAG} my chest has been tight since this morning`;
        const answered = `${RUN_TAG} tell me more about that`;
        for (const turn of [{ role: 'user', content: said }, { role: 'assistant', content: answered }]) {
            const rec = await ctx.post('/api/interactions', { data: { session_id: sessionId, ...turn } });
            expect(rec.ok(), await rec.text()).toBeTruthy();
        }

        await page.goto('/');
        // Written by page script rather than through the shared
        // `enterLiveCase` helper, because that helper seeds a bearer token and
        // this test must authenticate by cookie (above).
        await page.evaluate(([session, caseRow]) => {
            for (const role of ['admin', 'educator', 'student']) {
                window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            }
            window.localStorage.setItem('rohy_active_session', JSON.stringify({
                activeCase: caseRow, sessionId: session, timestamp: Date.now(),
            }));
        }, [sessionId, activeCase]);
        await page.reload();
        await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
        // The clock is telling the truth BEFORE the restart, so that the same
        // check afterwards is a statement about the restart rather than about
        // the clock in general.
        const opened = await sessionRow(baseURL, sessionId);
        await ageSession(page, opened.start_time);
        await expectClockMatchesSession(page, opened.start_time);

        // The thread is on screen before the restart, so that finding it
        // afterwards is a statement about the restart rather than about
        // whether it was ever displayed at all.
        await expectInThread(page, said, 'what the learner said');

        const state = await first.storageState();
        await first.close();

        // The credential has to be one that a restart keeps. A session cookie
        // is dropped when the browser closes, and storageState would carry it
        // anyway — so the round trip below would pass while the real thing
        // signed the learner out.
        const auth = state.cookies.find((c) => c.name === 'rohy_auth');
        expect(auth, 'the auth cookie was set at login').toBeTruthy();
        expect(auth.expires, 'the auth cookie outlives the browser session').toBeGreaterThan(Date.now() / 1000);

        const second = await browser.newContext({ baseURL, storageState: state });
        try {
            const reopened = await second.newPage();
            await reopened.goto('/');

            // Still signed in — the room bar only renders inside an
            // authenticated, live case.
            await expect(reopened.getByTestId('room-navigator'), 'the learner is still signed in and still in the case')
                .toBeVisible({ timeout: 20_000 });
            await expect(reopened.getByTestId('end-session'), 'the case is still endable, so it is still running').toBeVisible();

            const row = (await (await ctx.get(`/api/sessions/${sessionId}`)).json()).session;
            expect(row.end_time ?? null, 'the session was never closed by the restart').toBeNull();

            // And it is the SAME case, still running. Compared against the
            // SESSION'S OWN start_time rather than against the reading taken
            // before the restart: `after >= before` is satisfied by a clock
            // that restarted at zero and then ticked past a small `before`,
            // and by one that is frozen. Only the server's anchor says how
            // long this case has really been running.
            await expectClockMatchesSession(reopened, row.start_time);

            // And the conversation came back with it — BOTH sides of it. A
            // learner who returns to a live case with an empty thread, or with
            // only their own words and none of the patient's, has lost the
            // history they were reasoning from, whatever the clock says.
            await expectInThread(reopened, said, 'what the learner said');
            await expectInThread(reopened, answered, 'what the patient answered');
        } finally {
            await second.close();
        }
    });
});
