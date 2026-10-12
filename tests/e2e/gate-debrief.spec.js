// The patient conversation and the debrief when the model is slow or fails,
// the treatment rubric (a contraindicated order, the answer key), and a case
// with no discussant — all as the learner sees them.
//
// The model is never called: the browser's request to /api/proxy/llm is
// answered by the test (slowly, with an error, or with a reply), which is the
// only way to put the app in front of a failure on demand. Speech is answered
// with a short silent WAV so the debrief does not wait on a real voice.

import { test, expect, waitForSeed, apiAsAdmin } from './fixtures/index.js';
import { enterLiveCase, learnerApi, disposeLearnerApi, createAssignedCase, pickCase, room } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-debrief-${Date.now()}`;
const CONTRAINDICATION = 'Metoprolol is contraindicated here: a beta-blocker would lower an already failing cardiac output.';

let theCase;      // the seeded default case, with its patient and discussant
let rubricCase;   // a case with an expected and a contraindicated treatment
let bareCase;     // a case with no discussant

/** A short silent WAV, so speech resolves at once. */
function silentWav(ms = 200) {
    const rate = 8000;
    const samples = Math.round((rate * ms) / 1000);
    const buf = Buffer.alloc(44 + samples * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
    return buf;
}
const WAV = silentWav();

/**
 * Answer the browser's model calls. `plan` is called for each call with its
 * index and returns what to do: { reply, delayMs } or { fail: true }.
 */
async function stubModel(page, plan) {
    let n = 0;
    await page.route('**/api/proxy/llm**', async (route) => {
        const step = plan(n++, route.request());
        if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
        if (step.fail) {
            await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'LLM provider unreachable' }) });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: step.reply } }] }) });
    });
    await page.route('**/api/tts**', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV }));
}

const composer = (page) => page.getByRole('textbox', { name: 'Message' });
const sendButton = (page) => page.getByRole('button', { name: 'Send message' });
const turns = (page, role) => page.locator(`[data-testid="chat-turn"][data-role="${role}"]`);

async function endTheCase(page) {
    await page.getByTestId('end-session').click();
    await page.getByTestId('end-session-confirm').click();
    await expect(page.getByTestId('room-view')).toHaveAttribute('data-room', 'consultant', { timeout: 15_000 });
}

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    theCase = await pickCase(baseURL);
    const baseConfig = typeof theCase.config === 'string' ? JSON.parse(theCase.config) : (theCase.config || {});

    rubricCase = await createAssignedCase(baseURL, { name: `${RUN_TAG} rubric`, config: { ...baseConfig } });
    // The rubric is snapshotted when a session starts, so it is written first.
    const admin = await apiAsAdmin(baseURL);
    try {
        const put = await admin.put(`/api/cases/${rubricCase.id}/treatments`, { data: { treatments: [
            { treatment_type: 'medication', treatment_name: 'Aspirin', is_available: 1, is_expected: 1,
                feedback_if_missed: 'Aspirin should be given at once in a suspected myocardial infarction.' },
            { treatment_type: 'medication', treatment_name: 'Metoprolol', is_available: 1, is_contraindicated: 1,
                feedback_if_ordered: CONTRAINDICATION },
        ] } });
        expect(put.ok(), await put.text()).toBeTruthy();
    } finally {
        await admin.dispose();
    }

    bareCase = await createAssignedCase(baseURL, { name: `${RUN_TAG} no discussant`, config: {} });
});

test.afterAll(disposeLearnerApi);

// ---------------------------------------------------------------------------

test.describe('talking to the patient', () => {
    // CASE.INTERVIEW.04
    test('while the patient answers, the composer waits and takes no second message, then the answer arrives', async ({ page, baseURL }) => {
        const answer = `${RUN_TAG} it started this morning`;
        await stubModel(page, () => ({ reply: answer, delayMs: 6_000 }));
        await enterLiveCase(page, baseURL, `${RUN_TAG}-busy`, theCase);
        const before = await turns(page, 'assistant').count();

        await composer(page).fill('When did the pain start?');
        await sendButton(page).click();

        // Waiting: the composer is disabled and says so, and the send button
        // with it — a second message cannot be sent.
        await expect(composer(page)).toBeDisabled();
        await expect(composer(page)).toHaveAttribute('placeholder', /waiting/i);
        await expect(sendButton(page)).toBeDisabled();

        // The first answer still arrives normally, and the composer reopens.
        await expect(turns(page, 'assistant').filter({ hasText: answer })).toHaveCount(1, { timeout: 20_000 });
        expect(await turns(page, 'assistant').count()).toBe(before + 1);
        await expect(composer(page)).toBeEnabled();
    });

    // CASE.INTERVIEW.05
    test('a reply that cannot be obtained is shown as an error, with no invented answer, and the chat stays usable', async ({ page, baseURL }) => {
        await stubModel(page, () => ({ fail: true }));
        await enterLiveCase(page, baseURL, `${RUN_TAG}-fail`, theCase);
        const assistantBefore = await turns(page, 'assistant').count();
        const question = `${RUN_TAG} does the pain spread?`;

        await composer(page).fill(question);
        await sendButton(page).click();

        const notice = page.getByTestId('chat-error-notice');
        await expect(notice, 'a visible error for that turn').toBeVisible({ timeout: 15_000 });
        await expect(notice).toContainText(/unreachable|could not|failed|error/i);
        // The learner's message is kept, and no patient answer was made up.
        await expect(turns(page, 'user').filter({ hasText: question })).toHaveCount(1);
        expect(await turns(page, 'assistant').count(), 'no fabricated patient answer').toBe(assistantBefore);
        await expect(composer(page), 'the app stays usable').toBeEnabled();
    });
});

test.describe('the debrief', () => {
    // DEBRIEF.DISCUSS.03
    test('a failed debrief turn says so, keeps the learner\'s words, and can be retried', async ({ page, baseURL }) => {
        let failing = false;
        await stubModel(page, () => (failing ? { fail: true } : { reply: `${RUN_TAG} what did you think was going on?` }));
        const sessionId = await enterLiveCase(page, baseURL, `${RUN_TAG}-debrief`, theCase);
        await endTheCase(page);

        await page.getByRole('button', { name: 'Start debrief' }).click();
        await expect(page.getByTestId('debrief-caption')).toBeVisible({ timeout: 20_000 });

        failing = true;
        const said = `${RUN_TAG} I thought it was a heart attack`;
        await page.getByRole('button', { name: 'Type instead' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('textbox').fill(said);
        await dialog.getByRole('button', { name: /send/i }).click();

        const banner = page.getByTestId('debrief-reply-failed');
        await expect(banner, 'the failure is shown').toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText('Your message was not lost');

        // The transcript keeps what the learner said (on screen and on the server).
        await page.keyboard.press('Escape').catch(() => {});
        const ctx = await learnerApi(baseURL);
        await expect.poll(async () => {
            const res = await ctx.get(`/api/sessions/${sessionId}/agents/discussant/conversation`);
            return JSON.stringify(await res.json());
        }, { message: 'the learner\'s message is stored', timeout: 10_000 }).toContain(said);

        // Retry: the next turn goes through and the banner clears.
        failing = false;
        await page.getByRole('button', { name: 'Type instead' }).click();
        await page.getByRole('dialog').getByRole('textbox').fill(`${RUN_TAG} and the ECG showed ST elevation`);
        await page.getByRole('dialog').getByRole('button', { name: /send/i }).click();
        await expect(banner, 'a retry clears the failure').toHaveCount(0, { timeout: 15_000 });
    });

    // DEBRIEF.DISCUSS.04
    test('a case with no discussant says so plainly and where to add one', async ({ page, baseURL }) => {
        await stubModel(page, () => ({ reply: 'unused' }));
        // A case with no discussant falls back to the platform's discussant
        // template, so "no discussant" is a platform that has none: the
        // template list is answered without its discussants.
        await page.route('**/api/agents/templates**', async (route) => {
            const res = await route.fetch();
            const body = await res.json();
            const strip = (list) => (Array.isArray(list) ? list.filter((t) => t.agent_type !== 'discussant') : list);
            const json = Array.isArray(body) ? strip(body) : { ...body, templates: strip(body.templates) };
            await route.fulfill({ response: res, json });
        });
        await enterLiveCase(page, baseURL, `${RUN_TAG}-bare`, bareCase);
        await room(page, 'consultant').click();
        const message = page.getByTestId('debrief-no-discussant');
        await expect(message, 'not an endless loading state').toBeVisible({ timeout: 10_000 });
        await expect(message).toContainText('No discussant configured');
        await expect(message, 'and where an admin adds one').toContainText('Agent Templates');
        await expect(page.getByRole('button', { name: 'Start debrief' })).toHaveCount(0);
    });

    // DEBRIEF.REVIEW.02
    test('the missed treatments are withheld while the case runs and listed once it has ended', async ({ page, baseURL }) => {
        await stubModel(page, () => ({ reply: 'unused' }));
        await enterLiveCase(page, baseURL, `${RUN_TAG}-key`, rubricCase);

        await room(page, 'consultant').click();
        await page.getByTestId('view-case-summary').click();
        const missed = page.getByTestId('debrief-missed');
        await expect(missed).toBeVisible({ timeout: 15_000 });
        await expect(missed, 'withheld mid-case').toHaveAttribute('data-pending', 'true');
        await expect(missed).not.toContainText('Aspirin');
        await page.keyboard.press('Escape');
        await expect(missed).toHaveCount(0);

        await room(page, 'chat').click();
        await endTheCase(page);
        await page.getByTestId('view-case-summary').click();
        await expect(missed).toBeVisible({ timeout: 15_000 });
        await expect(missed, 'released once the case has ended').toHaveAttribute('data-pending', 'false');
        await expect(missed, 'it lists what was expected and missed').toContainText('Aspirin');
    });
});

test.describe('ordering a treatment', () => {
    // CASE.TREAT.02
    test('a contraindicated order is accepted with a visible warning that explains why', async ({ page, baseURL }) => {
        await stubModel(page, () => ({ reply: 'unused' }));
        await enterLiveCase(page, baseURL, `${RUN_TAG}-contra`, rubricCase);

        await page.getByRole('button', { name: 'Treatments', exact: true }).first().click();
        await page.getByLabel('Search treatments').fill('Metoprolol');
        await page.getByRole('button', { name: /Metoprolol/ }).first().click();
        await page.getByRole('button', { name: /^Order Metoprolol/ }).click();

        // A clearly visible warning, in clinical terms — not a silent accept,
        // not a bare refusal.
        await expect(page.getByRole('status').filter({ hasText: CONTRAINDICATION }).first())
            .toBeVisible({ timeout: 10_000 });

        // And the order was accepted: it stands in Active Orders, ready to give.
        await expect(page.getByText('Active Orders (1)')).toBeVisible();
        await expect(page.getByRole('button', { name: /Give/ })).toBeVisible();
        await expect(page.getByText('Ordered', { exact: true })).toBeVisible();
    });
});
