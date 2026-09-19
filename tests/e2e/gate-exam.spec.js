// The examination room: the body map, its controls, and the log.
//
// gate-core.spec.js already holds the SERVER half of CASE.EXAM.02 — that a
// repeated region-and-technique is one row and one increment. This is the half
// a learner actually sees: that the technique comes back marked as done, that
// the same finding is shown again, and that the log did not grow a second
// entry for it.
//
// `exam-finding` carries the finding text so "the same finding is shown again"
// can be compared across the repeat. Its fallback is a translated
// `no_finding`, so reading the node by text would test the locale.
//
// Hooks this needed, and why each one: `exam-aspect-<view>`,
// `exam-shortcut-<region>`, `exam-technique-<id>` and `exam-figure` are all
// labelled with translated strings, so a spec keyed on their text passes in
// English and fails in Finnish for no reason of its own. `bodymap-region-<id>`
// is an SVG <polygon> with no text at all — there is nothing else to aim at.
// `exam-log[data-entry-count]` publishes the count the room renders as a
// pluralised sentence, which is again translated, and which is precisely the
// number CASE.EXAM.02 is about.

import { test, expect, waitForSeed } from './fixtures/index.js';
import { enterLiveCase, learnerApi, disposeLearnerApi, pickCase, room } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-exam-${Date.now()}`;

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await pickCase(baseURL);
});

test.afterAll(disposeLearnerApi);

/** A learner standing in the examination room of a running case. */
async function enterExamRoom(page, baseURL, tag) {
    const sessionId = await enterLiveCase(page, baseURL, `${RUN_TAG}-${tag}`, theCase);
    await room(page, 'examination').click();
    await expect(room(page, 'examination')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('exam-log')).toBeVisible({ timeout: 15_000 });
    return sessionId;
}

const regions = (page) => page.locator('[data-testid^="bodymap-region-"]');
const techniques = (page) => page.locator('[data-testid^="exam-technique-"]');
const logRows = (page) => page.getByTestId('exam-log-row');

/** Which regions the map is currently offering, in order. */
const regionIds = (page) =>
    regions(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')));

/**
 * The number of examinations the log says it holds, and the number of rows it
 * actually draws — asserted to be the same, then returned.
 *
 * `data-entry-count` is the length of the array the component was given;
 * `exam-log-row` is what the learner can see. Reading only the attribute would
 * let a render that dropped or doubled rows pass, which is exactly the shape
 * of the bug CASE.EXAM.02 is about.
 */
async function logCount(page) {
    const claimed = Number(await page.getByTestId('exam-log').getAttribute('data-entry-count'));
    const drawn = await logRows(page).count();
    expect(drawn, `the log claims ${claimed} entries and draws ${drawn} rows`).toBe(claimed);
    return claimed;
}

// ---------------------------------------------------------------------------

test.describe('the body map', () => {
    // CASE.EXAM.03
    //
    // The case's second step — switching the figure between the male and
    // female silhouette — is NOT asserted as a toggle, because inside a case
    // there is no toggle: ManikinPanel renders a locked indicator once the
    // patient has a sex, and switching the figure away from the patient in
    // front of you would be the bug, not the feature. What is asserted is that
    // the figure is shown, and locked. The case text still describes the
    // pre-case behaviour and wants amending.
    test('each aspect and each shortcut redraws a map that can still be worked', async ({ page, baseURL }) => {
        await enterExamRoom(page, baseURL, 'bodymap');

        // Anterior is where the room opens.
        await expect(page.getByTestId('exam-aspect-anterior')).toHaveAttribute('aria-pressed', 'true');
        expect(await regions(page).count(), 'the anterior map has regions').toBeGreaterThan(0);

        const anteriorIds = await regionIds(page);

        await page.getByTestId('exam-aspect-posterior').click();
        await expect(page.getByTestId('exam-aspect-posterior')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('exam-aspect-anterior')).toHaveAttribute('aria-pressed', 'false');

        // "No control leaves the pane blank" is the case's own wording, and a
        // blank pane is what a missing posterior region set produces — the
        // toggle flips, the silhouette changes, and nothing is clickable.
        //
        // The map must actually REDRAW, not merely keep some polygons: a view
        // stuck on anterior while the buttons update correctly would satisfy
        // "has regions", so the region ids are compared. Posterior carries its
        // own set (backUpper, buttocks…), so an unchanged set means the toggle
        // moved nothing but its own highlight.
        const posteriorIds = await regionIds(page);
        expect(posteriorIds.length, 'the posterior map has regions of its own').toBeGreaterThan(0);
        expect(posteriorIds, 'the posterior map is a different map, not the anterior one relabelled')
            .not.toEqual(anteriorIds);

        // And they are clickable, which is the part "no control leaves the
        // pane blank" turns on. A polygon whose click handler was dropped is
        // still visible and still counted; selecting it is what proves the
        // learner can work the new view.
        await regions(page).first().click();
        expect(await techniques(page).count(), 'a posterior region opens its techniques').toBeGreaterThan(0);

        await page.getByTestId('exam-aspect-anterior').click();
        await expect
            .poll(async () => regionIds(page))
            .toEqual(anteriorIds);

        // The figure is the patient's, and it is not the learner's to change.
        const figure = page.getByTestId('exam-figure');
        await expect(figure, 'the case fixes the figure to the patient').toBeVisible();
        expect(['male', 'female']).toContain(await figure.getAttribute('data-figure'));
        await expect(page.getByTestId('exam-figure-male'), 'no figure toggle inside a case').toHaveCount(0);

        // The shortcuts open examinations that no region on the silhouette
        // offers — a learner who cannot reach General has no way to record a
        // general survey at all.
        for (const shortcut of ['general', 'neurological']) {
            await page.getByTestId(`exam-shortcut-${shortcut}`).click();
            await expect(page.getByTestId(`exam-shortcut-${shortcut}`)).toHaveAttribute('aria-pressed', 'true');
            expect(await techniques(page).count(), `${shortcut} offers techniques`).toBeGreaterThan(0);
        }
    });
});

test.describe('repeating an examination', () => {
    // CASE.EXAM.02 — the half the learner sees. The server half is in
    // gate-core.spec.js.
    test('the same technique twice is marked done, shown again, and logged once', async ({ page, baseURL }) => {
        const sessionId = await enterExamRoom(page, baseURL, 'repeat');
        expect(await logCount(page), 'the log starts empty').toBe(0);

        // A shortcut rather than a silhouette region: it is always present in
        // both aspects, so this does not depend on which regions a figure has.
        await page.getByTestId('exam-shortcut-general').click();
        const first = techniques(page).first();
        const key = await first.getAttribute('data-testid');
        expect(key, 'a technique is offered').toBeTruthy();

        await expect(first, 'not yet performed').toHaveAttribute('data-performed', 'false');
        // Its label before it has been performed, so the "done" cue below is
        // measured as an ADDITION to it rather than against a fixed string
        // (the label is translated; the cue is too).
        const techniqueLabelLength = (await first.innerText()).trim().length;
        await first.click();
        await expect
            .poll(async () => logCount(page), { timeout: 10_000 })
            .toBe(1);
        const finding = (await page.getByTestId('exam-finding').innerText()).trim();
        expect(finding.length, 'the examination produced a finding').toBeGreaterThan(0);

        // Leave the technique and come back, so the second click is a genuine
        // repeat rather than a double-click on a button still holding state.
        await page.getByTestId('exam-shortcut-neurological').click();
        await page.getByTestId('exam-shortcut-general').click();

        const again = page.getByTestId(key);
        await expect(again, 'the technique is marked as already done').toHaveAttribute('data-performed', 'true');
        // And the mark is VISIBLE, not merely a state flag: `data-performed`
        // only says the technique is in the performed set, while the learner's
        // cue is the word the button grows underneath its label. Asserting the
        // attribute alone would pass if that cue were dropped.
        await expect(again, 'and the learner can see that it is done')
            .toHaveText(/\S/);
        const markedText = (await again.innerText()).trim();
        expect(markedText.length, 'the done technique carries more than its bare label')
            .toBeGreaterThan(techniqueLabelLength);
        await again.click();

        // The same finding is shown again — repeating an examination shows
        // you what you found, it does not blank the pane and it does not
        // produce a different answer to the same question...
        await expect(page.getByTestId('exam-finding')).toHaveText(finding);
        // ...and the log still holds one row for it.
        await expect
            .poll(async () => logCount(page), { timeout: 10_000 })
            .toBe(1);

        // The server agrees, which is what the debrief will read.
        //
        // POLLED, because `usePhysicalExam` posts the finding fire-and-forget
        // (`apiPost(...).catch(...)`, usePhysicalExam.js:99) and updates the
        // visible log synchronously. No UI assertion above is a barrier for
        // either request, so a bare read here could see zero rows on a slow
        // box, or see the first row while the repeat is still in flight and
        // pass before the thing under test had happened.
        const ctx = await learnerApi(baseURL);
        const findings = async () =>
            (await (await ctx.get(`/api/sessions/${sessionId}/exam-findings`)).json()).findings || [];
        await expect.poll(async () => (await findings()).length, { timeout: 10_000 }).toBe(1);

        // Then held: a second row arriving late would still be a duplicate.
        // Waiting past the point where it would have landed is what makes the
        // count above mean "one", rather than "one so far".
        await page.waitForTimeout(1_500);
        const rows = await findings();
        expect(rows.length, 'one finding recorded, not two').toBe(1);
        expect(rows[0].exam_type, 'and it is the technique that was performed')
            .toBe(key.replace('exam-technique-', ''));
    });
});
