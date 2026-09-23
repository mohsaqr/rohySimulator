// Per-case rooms: a case that switched rooms off shows only the rooms it keeps,
// the phone rings out for a specialist whose rooms are off, and End & Debrief
// without a debrief room ends on the case summary.
//
// The case is built for this spec (a student can only start the default case
// or one assigned through a course, so it is assigned through a fresh course):
// every switchable core room is off, and the bedside with them. No plugin room
// has material, so the room bar must hold the patient room alone.
//
// Presses go through `page.mouse` at the element's centre, like
// oncall-phone.spec.js, for the same reason (software WebGL on CI).

import { test, expect, waitForSeed, apiAsAdmin } from './fixtures/index.js';
import { enterLiveCase, disposeLearnerApi } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-rooms-${Date.now()}`;
const OFF = ['examination', 'lab', 'radiology', 'consultant', 'room3d'];

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    const admin = await apiAsAdmin(baseURL);
    try {
        const created = await admin.post('/api/cases', { data: {
            name: `${RUN_TAG} history only`,
            description: 'A case with the history room and nothing else',
            system_prompt: 'You are a patient with a cough.',
            config: {
                patient_name: 'Rooms Example',
                demographics: { age: 40, gender: 'Female' },
                rooms: { disabled: OFF },
            },
        } });
        expect(created.ok(), await created.text()).toBeTruthy();
        theCase = await created.json();
        expect(theCase.config.rooms.disabled).toEqual([...OFF].sort());

        const cohort = await admin.post('/api/cohorts', { data: { name: `${RUN_TAG} course` } });
        expect(cohort.ok(), await cohort.text()).toBeTruthy();
        const cohortId = (await cohort.json()).cohort.id;
        const member = await admin.post(`/api/cohorts/${cohortId}/members`, { data: { identifier: 'student' } });
        expect(member.ok(), await member.text()).toBeTruthy();
        const assigned = await admin.post(`/api/cohorts/${cohortId}/cases`, { data: { case_ids: [theCase.id] } });
        expect(assigned.ok(), await assigned.text()).toBeTruthy();
    } finally {
        await admin.dispose();
    }
});

test.afterAll(disposeLearnerApi);

async function pressAtCentre(page, locator, what) {
    const box = await locator.boundingBox({ timeout: 30_000 });
    expect(box, `${what} has a box on screen`).not.toBeNull();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('per-case rooms', () => {
    test('the room bar holds only the rooms the case keeps', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-bar`, theCase);
        // Polled: enterLiveCase seeds the case as the learner's GET /cases/:id
        // returns it, and the rooms are known once the session snapshot lands.
        await expect.poll(() => page.locator('[data-testid^="room-button-"]')
            .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('room-button-', ''))))
            .toEqual(['chat']);
    });

    test('a specialist whose rooms are off is on the phone, and the call rings out', async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-phone`, theCase);
        await pressAtCentre(page, page.getByTestId('oncall-phone-button'), 'the phone');
        const handset = page.getByTestId('oncall-phone');
        const lab = handset.getByTestId('oncall-contact-laboratorian');
        await expect(lab).toContainText('No answer');
        await pressAtCentre(page, lab.getByRole('button', { name: /^Call / }), 'call the laboratory');
        const state = handset.getByTestId('oncall-call-state');
        await expect(state).toHaveText('Calling…');
        await expect(state).toHaveText('No answer', { timeout: 15_000 });
    });

    test('End & Debrief without a debrief room ends on the case summary', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-end`, theCase);
        await pressAtCentre(page, page.getByTestId('end-session'), 'End & Debrief');
        await pressAtCentre(page, page.getByTestId('end-session-confirm'), 'the confirmation');
        await expect(page.getByTestId('case-summary-modal')).toBeVisible();
        // Still in the patient room: there is no debrief room to go to.
        await expect(page.getByTestId('room-button-chat')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('room-button-consultant')).toHaveCount(0);
    });
});
