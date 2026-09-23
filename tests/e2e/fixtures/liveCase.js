// Putting a learner inside a running case, without the Start affordance.
//
// `case-lifecycle.spec.js` says the Start button varies by build and avoids
// it. Rather than guess at a selector, these helpers create the session
// through the API and seed `rohy_active_session` — the exact contract
// App.jsx restores from (App.jsx:474). The learner then lands in a running
// case the same way they would after a reload.
//
// Extracted from gate-rooms.spec.js when gate-exam.spec.js needed the same
// entry: two copies of this would drift the moment the restore contract
// changed, and the restore contract is the thing both specs depend on.

import { expect, request as pwRequest } from '@playwright/test';
import { loginAs } from './auth.js';
import { apiAsAdmin, findCase } from './seed.js';
// The app's own parser, not a re-implementation: SQLite hands back
// 'YYYY-MM-DD HH:MM:SS' with no zone marker and JS would read that as local
// time. Parsing it a second way here would test this file against itself.
import { parseUtcTimestamp } from '../../../src/utils/sessionAnchors.js';

let _ctx;
let _token;

/**
 * An APIRequestContext authenticated as the seeded student, minted once per
 * spec file. `loginAs` prefers the token globalSetup cached, and only performs
 * a real login when that cache is missing — which is what keeps a combined
 * suite run under the server's auth rate limit.
 */
export async function learnerApi(baseURL) {
    if (!_ctx) {
        const { token } = await loginAs(baseURL, 'student');
        _token = token;
        _ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    }
    return _ctx;
}

/** The learner's bearer token, available once learnerApi() has run. */
export function learnerToken() {
    return _token;
}

export async function disposeLearnerApi() {
    if (_ctx) await _ctx.dispose();
    _ctx = null;
    _token = undefined;
}

/**
 * A case built for one spec, which the seeded student may start. A student can
 * only launch the default case or one assigned through a course, so this
 * creates the case and a fresh course holding it and the student. Use it when
 * a spec needs a case configured its own way (rooms, material) without
 * touching the default case every other spec plays.
 *
 * @param {string} baseURL
 * @param {{ name: string, config: object }} spec
 * @returns {Promise<object>} the created case row, as POST /cases returns it
 */
export async function createAssignedCase(baseURL, { name, config }) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const created = await admin.post('/api/cases', { data: {
            name, description: 'e2e case', system_prompt: 'You are a patient.', config,
        } });
        expect(created.ok(), await created.text()).toBeTruthy();
        const theCase = await created.json();
        // A new case is hidden from students until published; the learner's
        // GET /cases/:id (which enterLiveCase seeds the app with) answers 404
        // for a hidden one.
        const published = await admin.put(`/api/cases/${theCase.id}/availability`, { data: { is_available: true } });
        expect(published.ok(), await published.text()).toBeTruthy();
        const cohort = await admin.post('/api/cohorts', { data: { name: `${name} course` } });
        expect(cohort.ok(), await cohort.text()).toBeTruthy();
        const cohortId = (await cohort.json()).cohort.id;
        const member = await admin.post(`/api/cohorts/${cohortId}/members`, { data: { identifier: 'student' } });
        expect(member.ok(), await member.text()).toBeTruthy();
        const assigned = await admin.post(`/api/cohorts/${cohortId}/cases`, { data: { case_ids: [theCase.id] } });
        expect(assigned.ok(), await assigned.text()).toBeTruthy();
        return theCase;
    } finally {
        await admin.dispose();
    }
}

/** The default seeded case, or any seeded case if none is marked default. */
export async function pickCase(baseURL) {
    const found = await findCase(baseURL, (c) => c.is_default === 1) || await findCase(baseURL, () => true);
    expect(found, 'a seeded case').toBeTruthy();
    return found;
}

/**
 * A learner, in a running case, on the patient room. Returns the session id.
 */
export async function enterLiveCase(page, baseURL, tag, theCase) {
    const ctx = await learnerApi(baseURL);
    const res = await ctx.post('/api/sessions', { data: { case_id: theCase.id, student_name: tag } });
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

/** A room button in the bottom navigator. */
export const room = (page, key) => page.getByTestId(`room-button-${key}`);

const clockSeconds = async (page) =>
    Number(await page.getByTestId('session-clock').getAttribute('data-elapsed-seconds'));

/**
 * The clock, once it has started moving — with the instant it was read.
 *
 * PatientMonitor holds elapsed time in `useState(0)` and recomputes it from an
 * anchor on each tick, so for up to a second after ANY mount — the first load,
 * or coming back from another room — the attribute reads 0. A read taken
 * immediately after a room change therefore catches the reset rather than the
 * elapsed time.
 *
 * What this does NOT establish: that the SERVER's anchor has arrived. The
 * component falls back to its own mount time until `GET /sessions/:id` lands
 * (`sessionStartMsRef.current ?? mountStartMsRef.current`,
 * PatientMonitor.jsx:295), so a non-zero reading may still be counting from
 * the mount. Anything asserting how long the case has really been running must
 * use `expectClockMatchesSession` instead of comparing two of these.
 */
export async function readClock(page) {
    let seconds = 0;
    await expect
        .poll(async () => { seconds = await clockSeconds(page); return seconds; }, { timeout: 15_000 })
        .toBeGreaterThan(0);
    return { seconds, at: Date.now() };
}

/**
 * Let the case get old enough that a restarted clock would be obvious.
 *
 * Call this BEFORE the action under test — the room tour, the reload, the
 * restart. What distinguishes a surviving clock from one that restarts on
 * every mount is how much of the session had already elapsed when the monitor
 * last mounted, not how old the session is when it is finally read. Ageing it
 * afterwards moves both numbers together and proves nothing.
 */
export async function ageSession(page, startTime, seconds = 6) {
    const startMs = parseUtcTimestamp(startTime);
    expect(startMs, `the session carries a parseable start_time (got ${startTime})`).toBeTruthy();
    const waitMs = seconds * 1000 - (Date.now() - startMs);
    if (waitMs > 0) await page.waitForTimeout(waitMs);
}

/**
 * Assert the displayed clock is the session's real age.
 *
 * `start_time` on the session row is the only ground truth for that, and it is
 * what PatientMonitor anchors to once it has fetched it. Comparing against it
 * — rather than against an earlier reading of the same clock — is what
 * distinguishes a clock that kept running from one that restarted at zero, or
 * one that froze: both of those can satisfy `after >= before`.
 *
 * WHY IT WAITS FOR THE SESSION TO AGE. PatientMonitor falls back to its own
 * mount time until the server anchor arrives, and on a session only a second
 * or two old those two are indistinguishable — the assertion would hold
 * whichever anchor was used, and pass just as happily on a clock that restarts
 * on every mount. Proven, not assumed: mutating the component to ignore the
 * server anchor left two callers green until this wait was added. So the
 * session is allowed to grow older than the tolerance before anything is
 * claimed about it, which is what makes the two anchors tell apart.
 */
export async function expectClockMatchesSession(page, startTime, { toleranceSeconds = 3 } = {}) {
    const startMs = parseUtcTimestamp(startTime);
    expect(startMs, `the session carries a parseable start_time (got ${startTime})`).toBeTruthy();

    const meaningfulAgeMs = (toleranceSeconds + 3) * 1000;
    const waitMs = meaningfulAgeMs - (Date.now() - startMs);
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    let shown = null;
    let real = null;
    await expect
        .poll(async () => {
            shown = await clockSeconds(page);
            real = (Date.now() - startMs) / 1000;
            return Math.abs(shown - real) <= toleranceSeconds;
        }, { timeout: 15_000 })
        .toBe(true);

    // Re-stated as a plain assertion so a failure names both numbers rather
    // than just reporting that a boolean stayed false.
    expect(
        Math.abs(shown - real),
        `the clock shows ${shown}s for a case that started ${real?.toFixed(1)}s ago`,
    ).toBeLessThanOrEqual(toleranceSeconds);
}

export { clockSeconds };
