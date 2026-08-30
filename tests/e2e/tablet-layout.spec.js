// Tablet layout guard — the student-facing rooms at iPad viewports.
//
// Why this exists: the room shell put a 350px floor on the chat column and
// a 600px floor on the monitor column inside an `overflow-hidden` viewport.
// That is a 950px minimum, so on an iPad in portrait (820px) the right edge
// of the patient monitor was clipped off-screen with no way to scroll to
// it — invisible on every desktop the layout was ever developed on.
//
// What it asserts, per room per viewport:
//   1. No horizontal overflow — the document is not wider than the viewport.
//      This is the class of failure above: content pushed outside a clipped
//      container is unreachable, not merely ugly.
//   2. The room's key landmarks are actually visible (not merely present in
//      the DOM at zero size or off-screen).
// It also writes a screenshot per room per viewport so a human can flip
// through the real rendering; failures alone don't tell you it looks right.
//
// Not in CI (Playwright was removed as flaky, 2026-05-17). Run locally:
//   npm run build && npx playwright test tests/e2e/tablet-layout.spec.js
// Screenshots land in test-results/tablet-layout/.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, apiAsAdmin } from './fixtures/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHOTS = path.join(__dirname, '..', '..', 'test-results', 'tablet-layout');

// CSS pixel sizes reported by Safari on the two most common school iPads.
// Portrait is the one that breaks layouts: it is narrower than every
// `lg:` breakpoint and narrower than most hardcoded two-column floors.
const VIEWPORTS = [
    { name: 'ipad-portrait', width: 820, height: 1180 },
    { name: 'ipad-landscape', width: 1180, height: 820 },
];

/**
 * Horizontal overflow check.
 *
 * `scrollWidth > clientWidth` on the document is the honest signal: it is
 * true whether the overflow scrolls (ugly) or is clipped by an ancestor's
 * `overflow-hidden` (unreachable). Also returns the widest offending
 * elements so a failure names the culprit instead of just the number.
 */
async function horizontalOverflow(page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        const vw = doc.clientWidth;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // `fixed` overlays that deliberately bleed (toasts, drawers in
            // their off-screen resting position) are not layout failures.
            if (getComputedStyle(el).position === 'fixed') continue;
            if (r.right > vw + 1) {
                offenders.push({
                    tag: el.tagName.toLowerCase(),
                    cls: (el.className?.toString?.() || '').slice(0, 120),
                    right: Math.round(r.right),
                });
            }
        }
        return {
            viewportWidth: vw,
            scrollWidth: doc.scrollWidth,
            overflow: doc.scrollWidth - vw,
            // Deepest elements first would be noise; the widest few is what
            // you actually need to find the constraint.
            offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 5),
        };
    });
}

/**
 * Land in a running room.
 *
 * FirstRunGate stands between login and the simulator, so a fresh e2e DB
 * shows the setup wizard rather than any room. Marking setup complete over
 * the API is both faster and less brittle than clicking through it, and it
 * is not what these tests are about. `App.jsx` then auto-loads a landing
 * case (`pickLandingCase`), so the room mounts with no case-picking.
 */
async function enterRoom(page, baseURL) {
    const ctx = await apiAsAdmin(baseURL);
    try {
        await ctx.put('/api/platform-settings/setup', { data: { completed: true } });
    } finally {
        await ctx.dispose();
    }
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The room navigator is the last thing to mount (it needs a session).
    await page.getByRole('button', { name: /Examination/i })
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    // OnboardingTour is a modal overlay that covers the room navigator. It
    // is localStorage-scoped, so every fresh browser context gets it again.
    const skip = page.getByRole('button', { name: /^Skip$/i });
    if (await skip.count()) {
        await skip.first().click();
        await expect(skip.first()).toBeHidden();
    }
}

async function expectNoHorizontalOverflow(page, label) {
    const result = await horizontalOverflow(page);
    expect(
        result.overflow,
        `${label}: document is ${result.overflow}px wider than the ${result.viewportWidth}px viewport. ` +
        `Widest offenders: ${JSON.stringify(result.offenders, null, 1)}`
    ).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test('login page fits', async ({ page }) => {
            await page.goto('/');
            await page.waitForLoadState('networkidle');
            // Regression lock: an overflow-only assertion passes on a BLANK
            // page (an empty document never overflows) — which is exactly how
            // this test stayed green while the whole suite was serving an
            // unbuilt tree. Demand the login form before measuring layout.
            await expect(page.locator('input[type="password"]')).toBeVisible();
            await page.screenshot({ path: path.join(SHOTS, `${vp.name}-login.png`), fullPage: false });
            await expectNoHorizontalOverflow(page, `${vp.name} login`);
        });

        test('patient room fits and shows both chat and monitor', async ({ adminPage, baseURL }) => {
            await enterRoom(adminPage, baseURL);
            await adminPage.waitForTimeout(1500); // monitor waveforms settle

            await adminPage.screenshot({ path: path.join(SHOTS, `${vp.name}-room-chat.png`) });
            await expectNoHorizontalOverflow(adminPage, `${vp.name} patient room`);

            // The clipped-monitor bug: the ECG canvas existed but its right
            // edge sat outside the viewport. Assert the monitor column is
            // fully inside the frame, not merely present.
            const monitorRight = await adminPage.evaluate(() => {
                const canvas = document.querySelector('canvas');
                return canvas ? Math.round(canvas.getBoundingClientRect().right) : null;
            });
            expect(monitorRight, `${vp.name}: no monitor canvas rendered`).not.toBeNull();
            expect(
                monitorRight,
                `${vp.name}: the monitor's right edge (${monitorRight}px) is outside the ${vp.width}px viewport`
            ).toBeLessThanOrEqual(vp.width + 1);
        });

        // The room navigator is the only way between rooms; if it overflows,
        // a learner is stranded wherever they happen to be.
        test('room navigator keeps every room reachable', async ({ adminPage, baseURL }) => {
            await enterRoom(adminPage, baseURL);

            for (const label of [/Examination/i, /Laboratory/i, /Radiology/i, /Patient/i]) {
                const btn = adminPage.getByRole('button', { name: label }).first();
                await expect(btn, `${vp.name}: "${label}" room button is not visible`).toBeVisible();
                const box = await btn.boundingBox();
                expect(
                    box.x + box.width,
                    `${vp.name}: "${label}" room button extends past the viewport edge`
                ).toBeLessThanOrEqual(vp.width + 1);
            }
        });

        for (const room of [
            { label: /Examination/i, slug: 'examination' },
            { label: /Laboratory/i, slug: 'lab' },
            { label: /Radiology/i, slug: 'radiology' },
        ]) {
            test(`${room.slug} room fits`, async ({ adminPage, baseURL }) => {
                await enterRoom(adminPage, baseURL);
                await adminPage.getByRole('button', { name: room.label }).first().click();
                await adminPage.waitForTimeout(1500);
                await adminPage.screenshot({ path: path.join(SHOTS, `${vp.name}-room-${room.slug}.png`) });
                await expectNoHorizontalOverflow(adminPage, `${vp.name} ${room.slug} room`);
            });
        }
    });
}

// Regression lock: the vitals column must scroll, never squeeze.
//
// The boxes in the monitor's right-hand vitals column are flex children with
// fixed heights and `overflow-hidden`. Without `shrink-0` a column shorter
// than their combined height shrinks them instead of scrolling — the HR box
// measured 25px against its declared 96px, so the "110" was cut in half and
// still looked like a plausible reading. A clipped vital is worse than a
// missing one, and this reproduces on any short window, not just a tablet.
test.describe('monitor vitals column', () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test('keeps every vitals box at its declared height', async ({ adminPage, baseURL }) => {
        await enterRoom(adminPage, baseURL);
        await adminPage.waitForTimeout(1000);

        const boxes = await adminPage.evaluate(() => {
            const col = document.querySelector('[data-aoi-id="vitals_values"]')
                || [...document.querySelectorAll('div')].find(d => /w-64/.test(d.className) && /overflow-y-auto/.test(d.className));
            if (!col) return null;
            return [...col.children].map(el => ({
                label: (el.textContent || '').trim().slice(0, 12),
                height: Math.round(el.getBoundingClientRect().height),
                declared: /h-24/.test(el.className) ? 96 : (/h-32/.test(el.className) ? 128 : null),
            }));
        });

        expect(boxes, 'vitals column not found').not.toBeNull();
        expect(boxes.length).toBeGreaterThan(0);
        for (const b of boxes) {
            if (b.declared === null) continue;
            // max-lg shrinks the h-32 boxes to h-24 by design; anything under
            // 90px means flex squeezed them.
            expect(
                b.height,
                `vitals box "${b.label}" rendered at ${b.height}px — flex squeezed it below its declared height`
            ).toBeGreaterThanOrEqual(90);
        }
    });
});
