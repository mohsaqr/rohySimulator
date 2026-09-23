// The seeded monkey walker: a learner who presses things at random inside a
// running case, while the walker checks after every press that nothing broke.
//
//   npm run test:monkey                         # 2 minutes per case
//   MONKEY_MINUTES=15 npm run test:monkey       # the nightly walk
//   MONKEY_SEED=1758620000000 npm run test:monkey   # replay a failed walk
//
// What a walk is: enter a live case (fixtures/liveCase.js), then for
// MONKEY_MINUTES pick weighted random actions — a room button, any visible
// enabled button, typing into a visible text field, Escape, the phone, a
// scroll, a resize between desktop and tablet. After each one it checks:
//
//   - no uncaught exception (`pageerror`) and no unhandled promise rejection;
//   - no console.error outside CONSOLE_ERROR_ALLOWLIST (walker-lib.js);
//   - no HTTP response >= 500 from this server (but the content proxy's
//     designed 503 for a plugin with no content, serverErrorAllowed);
//   - the room bar holds exactly the rooms the case offers (expectedRooms);
//   - the page is not blank: the room bar is visible, or a dialog is open.
//
// Randomness is mulberry32 seeded by MONKEY_SEED (default: now). The seed is
// printed at the start and attached on failure with the last 20 actions, a
// screenshot, and Playwright's trace and video. A seed replays the same
// CHOICES; it cannot replay the same timing, so a race may need a few replays.
//
// Controls that would end the walk rather than exercise the case — End &
// Debrief, leaving the case, signing out, anything that deletes or resets —
// are denylisted in walker-lib.js.
//
// This is its own Playwright project (`monkey`), opted into with
// ROHY_PW_PROJECTS=monkey (see playwright.config.js), so the gate run in CI
// never picks it up by accident.

import { test, expect, waitForSeed } from '../e2e/fixtures/index.js';
import { createAssignedCase, disposeLearnerApi, learnerApi } from '../e2e/fixtures/liveCase.js';
import {
    addStudioGrossImage, createStudioDocument, updateStudioEntity,
} from '../../src/components/pathology/caseStudioModel.js';
import {
    consoleErrorAllowed, expectedRooms, isDenied, localisedDenyWords, mulberry32, pickIndex, pickOne,
    pickWeighted, randomText, roomBarProblem, serverErrorAllowed,
} from './walker-lib.js';

const MINUTES = Number(process.env.MONKEY_MINUTES || 2);
const SEED = Number(process.env.MONKEY_SEED || Date.now());
const RUN_TAG = `monkey-${Date.now()}`;
// Every UI language's words for delete/remove/reset/exit/sign out: the walker
// switches language as it goes, so an English-only list would stop protecting
// the case the moment it pressed "Italiano".
const DENY_WORDS = localisedDenyWords();

// How often each kind of action is chosen. Buttons dominate because that is
// where the application's behaviour is; rooms next, because moving between
// rooms is what a learner does most and what has broken most.
const WEIGHTS = [
    ['button', 35],
    ['room', 20],
    ['type', 15],
    ['escape', 8],
    ['phone', 8],
    ['scroll', 8],
    ['resize', 6],
];
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 820, height: 1180 }];

// The photograph a pathology case shows. Same-origin on purpose: the app's CSP
// is `img-src 'self' data: blob:`, which is how real material arrives (through
// this server's plugin proxy), and the SPA already serves this image.
const PHOTO_URI = '/woman-front.png';

/** A pathology document with one gross photograph: the cheapest material the
 *  pathology room accepts as something a learner can look at. Built with the
 *  package's own studio model, so it is a document the package would write. */
function pathologyWithPhotograph() {
    const count = new Map();
    const idFactory = (kind) => {
        const next = (count.get(kind) ?? 0) + 1;
        count.set(kind, next);
        return `${kind}-${next}`;
    };
    let doc = createStudioDocument({ idFactory, now: () => '2026-09-23T00:00:00.000Z', createdBy: 'monkey' });
    doc = updateStudioEntity(doc, 'specimen', 'specimen-1', { part: 'A', label: 'Skin' });
    return addStudioGrossImage(doc, 'specimen-1', {
        uri: PHOTO_URI, scaleMm: 50, checksum: 'sha256:monkey',
    }, idFactory);
}

const CASES = [
    {
        key: 'plain',
        config: { patient_name: 'Monkey Plain', demographics: { age: 45, gender: 'Female' } },
        withMaterial: [],
    },
    {
        key: 'bedside-pathology',
        config: {
            patient_name: 'Monkey Bedside',
            demographics: { age: 60, gender: 'Male' },
            rooms: { enabled: ['room3d'] },
            pathology: pathologyWithPhotograph(),
        },
        withMaterial: ['pathology'],
    },
];

const created = new Map();

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    for (const c of CASES) {
        created.set(c.key, await createAssignedCase(baseURL, { name: `${RUN_TAG} ${c.key}`, config: c.config }));
    }
});

test.afterAll(disposeLearnerApi);

/**
 * A learner in a running case, authenticated the way a real one is: by the
 * `rohy_auth` cookie a login sets, with NOTHING in localStorage['token'].
 *
 * Not fixtures/liveCase.js's enterLiveCase, which seeds a bearer token — the
 * legacy lane apiClient prefers when present. On that lane the browser's own
 * fetches that carry no header (plugin content loaded by URL, sendBeacon) go
 * out unauthenticated, and the walker's first long run failed on exactly
 * those 401s: a finding about legacy browsers, not the walk a learner takes.
 * The session and the restore blob are the same contract enterLiveCase uses.
 *
 * The UI language is reset to English first: the walker switches language as
 * it goes and the preference is stored per user, so without it a walk would
 * start in whatever language the previous one ended in, and a seed would not
 * replay.
 */
async function enterAsLearner(page, baseURL, tag, theCase) {
    const api = await learnerApi(baseURL);
    const reset = await api.put('/api/users/preferences', { data: { language: 'en' } });
    expect(reset.ok(), await reset.text()).toBeTruthy();

    const login = await page.request.post('/api/auth/login', { data: { username: 'student', password: 'student123' } });
    expect(login.ok(), await login.text()).toBeTruthy();

    const made = await api.post('/api/sessions', { data: { case_id: theCase.id, student_name: tag } });
    expect(made.ok(), await made.text()).toBeTruthy();
    const sessionId = (await made.json()).id;
    const full = await (await api.get(`/api/cases/${theCase.id}`)).json();
    const activeCase = full.case || full;

    await page.addInitScript(([session, caseRow]) => {
        try {
            for (const role of ['admin', 'educator', 'student']) {
                window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            }
            window.localStorage.setItem('rohy_active_session', JSON.stringify({
                activeCase: caseRow, sessionId: session, timestamp: Date.now(),
            }));
        } catch { /* private mode — the app starts cold and the entry check says so */ }
    }, [sessionId, activeCase]);
    await page.goto('/');
    await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 20_000 });
    return sessionId;
}

/** Everything the page did wrong since the last check, drained on read. */
function watchPage(page, baseURL) {
    const problems = [];
    page.on('pageerror', (err) => problems.push(`uncaught exception: ${err.stack || err.message}`));
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        // Chrome's "Failed to load resource" line names no URL in its text;
        // the location does. Matched and reported together.
        const url = msg.location()?.url || '';
        const text = url ? `${msg.text()} [${url}]` : msg.text();
        if (!consoleErrorAllowed(text)) problems.push(`console.error: ${text}`);
    });
    // The context, not the page: a worker's requests do not reach page.on.
    page.context().on('response', (res) => {
        if (res.status() >= 500 && res.url().startsWith(baseURL) && !serverErrorAllowed(res.status(), res.url())) {
            problems.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
        }
    });
    // A new tab or window is not part of the walk; close it and carry on.
    page.context().on('page', (popup) => { popup.close().catch(() => {}); });
    return {
        drain: () => problems.splice(0, problems.length),
    };
}

/**
 * Candidates for an action, measured in the page: each is on screen, enabled,
 * and the element a real pointer would hit at its centre (so nothing covers
 * it). Returns centres, not handles, so the walker clicks through hit-testing
 * with page.mouse — the same reason oncall-phone.spec.js does: on a GPU-less
 * runner the bedside's WebGL starves the main thread and locator.click()'s
 * scroll-into-view never settles.
 */
async function candidates(page, kind) {
    return page.evaluate((what) => {
        const selectors = {
            button: 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="switch"], '
                + '[role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"], summary',
            room: '[data-testid^="room-button-"]',
            phone: '[data-testid="oncall-phone-button"]',
            text: 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], '
                + 'input[type="number"], input[type="tel"], input[type="url"], [contenteditable="true"]',
        };
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return [...document.querySelectorAll(selectors[what])].flatMap((el) => {
            if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return [];
            if (el.closest('[inert]')) return [];
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return [];
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x >= vw || y >= vh) return [];
            const top = document.elementFromPoint(x, y);
            if (!top || (top !== el && !el.contains(top))) return [];
            const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
                .replace(/\s+/g, ' ').trim().slice(0, 80);
            const testid = el.getAttribute('data-testid') || '';
            return [{ x, y, name, testid }];
        });
    }, kind);
}

const describe = (c) => (c.testid ? `[${c.testid}] ${c.name}` : c.name || '(unnamed)');

async function roomBarKeys(page) {
    return page.locator('[data-testid="room-navigator"] [data-testid^="room-button-"]')
        .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('room-button-', '')));
}

async function isVisible(page, selector) {
    return page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }), selector);
}

test.describe('monkey walk', () => {
    for (const c of CASES) {
        test(`a random walk through the ${c.key} case breaks nothing`, async ({ page, baseURL }, testInfo) => {
            test.setTimeout(MINUTES * 60_000 + 180_000);
            const theCase = created.get(c.key);
            const rand = mulberry32(SEED);
            const actions = [];
            const record = (what) => {
                actions.push({ at: new Date().toISOString(), what });
                if (actions.length > 20) actions.shift();
            };
            console.log(`[monkey] ${c.key}: seed ${SEED}, ${MINUTES} min (replay with MONKEY_SEED=${SEED})`);
            await testInfo.attach('seed', { body: String(SEED), contentType: 'text/plain' });

            // The e2e server has no LLM behind it, so /proxy/llm answers 500
            // "LLM Request Failed" for every chat send. The walker is here for
            // the page, not the provider: answer with a canned reply (the
            // non-stream JSON shape, which the streaming client also accepts)
            // so a Send exercises the conversation the way a learner sees it.
            await page.route('**/api/proxy/llm*', (route) => route.fulfill({
                json: {
                    choices: [{ message: { role: 'assistant', content: 'It started this morning, doctor.' } }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                },
            }));
            const watch = watchPage(page, baseURL);
            const sessionId = await enterAsLearner(page, baseURL, `${RUN_TAG}-${c.key}`, theCase);
            const learner = await learnerApi(baseURL);

            const imagingOrdered = async () => {
                const res = await learner.get(`/api/sessions/${sessionId}/radiology-orders`);
                const orders = res.ok() ? (await res.json()).orders ?? [] : [];
                return orders.some((o) => !/12-lead ecg/i.test(String(o.test_name ?? o.study_name ?? '')));
            };

            const check = async (step) => {
                // The page is not blank: the room bar, or a dialog above it.
                // Polled briefly — a room change or a closing dialog passes
                // through a frame with neither.
                let visible = false;
                const deadline = Date.now() + 3_000;
                while (!visible && Date.now() < deadline) {
                    visible = await isVisible(page, '[data-testid="room-navigator"]')
                        || await isVisible(page, '[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
                    if (!visible) await page.waitForTimeout(200);
                }
                const problems = watch.drain();
                if (!visible) problems.push('blank page: neither the room bar nor a dialog is visible');
                if (await isVisible(page, '[data-testid="room-navigator"]')) {
                    const expected = expectedRooms(theCase.config, {
                        withMaterial: c.withMaterial,
                        imagingOrdered: await imagingOrdered(),
                    });
                    const problem = roomBarProblem(await roomBarKeys(page), expected);
                    if (problem) problems.push(problem);
                }
                if (problems.length > 0) {
                    throw new Error(`after action ${step} (${actions.at(-1)?.what}):\n  ${problems.join('\n  ')}`);
                }
            };

            const act = async () => {
                const kind = pickWeighted(rand, [...WEIGHTS]);
                if (kind === 'escape') {
                    record('press Escape');
                    await page.keyboard.press('Escape');
                    return;
                }
                if (kind === 'scroll') {
                    const { width, height } = page.viewportSize();
                    const x = pickIndex(rand, width);
                    const y = pickIndex(rand, height);
                    const dy = pickOne(rand, [-600, -200, 200, 600]);
                    record(`scroll ${dy} at ${x},${y}`);
                    await page.mouse.move(x, y);
                    await page.mouse.wheel(0, dy);
                    return;
                }
                if (kind === 'resize') {
                    const size = pickOne(rand, VIEWPORTS);
                    record(`resize to ${size.width}x${size.height}`);
                    await page.setViewportSize(size);
                    return;
                }
                const pool = kind === 'type' ? 'text' : kind;
                const found = (await candidates(page, pool)).filter((cand) => !isDenied(cand, DENY_WORDS));
                if (found.length === 0) {
                    record(`${kind}: nothing to press`);
                    return;
                }
                const target = pickOne(rand, found);
                if (kind === 'type') {
                    const text = randomText(rand);
                    record(`type ${JSON.stringify(text)} into ${describe(target)}`);
                    await page.mouse.click(target.x, target.y);
                    await page.keyboard.type(text);
                    return;
                }
                record(`${kind}: press ${describe(target)}`);
                await page.mouse.click(target.x, target.y);
            };

            const endAt = Date.now() + MINUTES * 60_000;
            let step = 0;
            try {
                await check('entry');
                while (Date.now() < endAt) {
                    step += 1;
                    await act();
                    // Let the press land: a render, an effect, a fetch start.
                    await page.waitForTimeout(150);
                    await check(step);
                }
                console.log(`[monkey] ${c.key}: ${step} actions, no problem (seed ${SEED})`);
            } catch (err) {
                await testInfo.attach('replay', { body: `MONKEY_SEED=${SEED} npm run test:monkey`, contentType: 'text/plain' });
                await testInfo.attach('last-20-actions', {
                    body: JSON.stringify(actions, null, 2), contentType: 'application/json',
                });
                await testInfo.attach('screenshot', {
                    body: await page.screenshot({ fullPage: false }).catch(() => Buffer.alloc(0)),
                    contentType: 'image/png',
                });
                throw new Error(`monkey walk failed (MONKEY_SEED=${SEED}, step ${step}): ${err.message}`);
            }
            // Not vacuous: a walk that never acted proves nothing.
            expect(step, 'the walk performed actions').toBeGreaterThan(0);
        });
    }
});
