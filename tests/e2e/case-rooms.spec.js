// Per-case rooms: a case that switched rooms off shows only the rooms it keeps,
// the phone rings out for a specialist whose rooms are off, and End & Debrief
// without a debrief room ends on the case summary.
//
// The case is built for this spec (createAssignedCase): every switchable core
// room is off, and the bedside is off by default. No plugin room
// has material, so the room bar must hold the patient room alone.
//
// Presses go through `page.mouse` at the element's centre, like
// oncall-phone.spec.js, for the same reason (software WebGL on CI).

import { test, expect, waitForSeed } from './fixtures/index.js';
import { createAssignedCase, enterLiveCase, disposeLearnerApi } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-rooms-${Date.now()}`;
const OFF = ['examination', 'lab', 'radiology', 'consultant', 'room3d'];

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await createAssignedCase(baseURL, {
        name: `${RUN_TAG} history only`,
        config: {
            patient_name: 'Rooms Example',
            demographics: { age: 40, gender: 'Female' },
            rooms: { disabled: OFF },
        },
    });
    expect(theCase.config.rooms.disabled).toEqual([...OFF].sort());
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
        // Polled: the room bar settles once the case's rooms are loaded.
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
