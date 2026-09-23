// The on-call phone: reachable from every room, and the lab and radiology on
// call on every case.
//
// Two regressions this locks, both shipped and both invisible to the unit
// tests:
//   - beta.101: the phone rendered on NO case in production — it hid itself
//     on a case with no specialist attached, and nothing attached one;
//   - beta.103: moved into the shared top bar, it was hidden and unclickable
//     under the immersive bedside room, a full-bleed overlay over an `inert`
//     chat layout.
// So each room is checked by CLICKING the button, not by finding it — with a
// real mouse event at the button's centre (`pressAtCentre`). If anything is
// drawn over it, that thing takes the click and the handset stays shut.
//
// Not `locator.click()`: on CI's GPU-less runner the bedside's WebGL scene
// renders in software and starves the main thread, and Playwright's
// scroll-into-view step then never settles (seen on the first CI run: the
// phone was on screen and uncovered, and the click timed out anyway).
//
// GETTING INTO A LIVE CASE is `fixtures/liveCase.js`.

import { test, expect, waitForSeed } from './fixtures/index.js';
import { enterLiveCase, disposeLearnerApi, pickCase, room } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-oncall-${Date.now()}`;

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await pickCase(baseURL);
});

test.afterAll(disposeLearnerApi);

const phoneButton = (page) => page.getByTestId('oncall-phone-button');
const handset = (page) => page.getByTestId('oncall-phone');

/** A real pointer press at the centre of `locator`, through hit-testing. */
async function pressAtCentre(page, locator, what) {
    // Generous: measuring the box is a round trip to a page whose main thread
    // the bedside's software-rendered WebGL can hold for seconds on CI.
    const box = await locator.boundingBox({ timeout: 30_000 });
    expect(box, `${what} has a box on screen`).not.toBeNull();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('the on-call phone', () => {
    test('opens from every room in the bar, the bedside overlay included', async ({ page, baseURL }) => {
        // Six rooms, one of them a WebGL scene, after entering a case: past
        // the 30 s default on a busy runner.
        test.setTimeout(120_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-rooms`, theCase);
        const keys = await page.locator('[data-testid^="room-button-"]')
            .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('room-button-', '')));
        // Not vacuous: the bar must hold the core rooms, and the overlay room
        // when its plugin is installed — that is the one that hid the phone.
        expect(keys).toEqual(expect.arrayContaining(['chat', 'examination', 'lab', 'radiology', 'consultant']));

        for (const key of keys) {
            await pressAtCentre(page, room(page, key), `the ${key} room button`);
            await expect(room(page, key), key).toHaveAttribute('aria-pressed', 'true');
            await expect(phoneButton(page), `one phone in ${key}`).toHaveCount(1);
            await pressAtCentre(page, phoneButton(page), `the phone in ${key}`);
            await expect(handset(page), `the handset opens from ${key}`).toBeVisible();
            await pressAtCentre(page, phoneButton(page), `the phone in ${key}`);
            await expect(handset(page), `the handset closes from ${key}`).toBeHidden();
        }
    });

    test('reaches the lab and radiology on a case nobody set up', async ({ page, baseURL }) => {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-contacts`, theCase);
        await pressAtCentre(page, phoneButton(page), 'the phone');
        // From the patient room the phone opens on the contact list: no
        // specialty owns that room.
        await expect(handset(page).getByTestId('oncall-contact-laboratorian')).toBeVisible();
        await expect(handset(page).getByTestId('oncall-contact-radiologist')).toBeVisible();
    });
});
