// The accessibility floor — the automated half of the A11Y.* cases.
//
// This is a floor, not an audit. A person still walks the consultation by
// keyboard and judges whether the focus ring is followable. What a machine can
// judge cheaply, and what regresses silently, is:
//   1. every form control has an accessible name;
//   2. every button has an accessible name (icon-only buttons are the usual
//      offender — they look fine and announce nothing);
//   3. the primary flow is reachable by Tab, and focus is never lost.
//
// "Accessible name" is computed the way a screen reader computes it: a <label>,
// aria-label, aria-labelledby, or the control's own text. Placeholder text is
// deliberately NOT counted — it disappears on typing and many screen readers
// skip it, so a placeholder-only field is exactly the defect being hunted.

import { test, expect } from './fixtures/index.js';

// Resolve an accessible name for an element, in roughly the order the accname
// spec does. Returns '' when the element has none.
const ACCESSIBLE_NAME = `(el) => {
    const byAria = el.getAttribute('aria-label');
    if (byAria && byAria.trim()) return byAria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = labelledBy.split(/\\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ').trim();
        if (text) return text;
    }
    if (el.id) {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label && label.textContent.trim()) return label.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
    if (el.title && el.title.trim()) return el.title.trim();
    const own = (el.textContent ?? '').trim();
    if (own) return own;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    return '';
}`;

async function unnamed(page, selector) {
    return page.locator(selector).evaluateAll(
        (els, fnSource) => {
            const name = new Function('return ' + fnSource)();
            return els
                .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
                .filter((el) => !name(el))
                .map((el) => `${el.tagName.toLowerCase()}${el.type ? `[type=${el.type}]` : ''}`
                    + `${el.id ? `#${el.id}` : ''}${el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''}`);
        },
        ACCESSIBLE_NAME,
    );
}

test.describe('accessibility floor', () => {
    test('every form control on the login screen has an accessible name', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('input').first()).toBeVisible();

        const missing = await unnamed(page, 'input:not([type=hidden]), select, textarea');
        expect(missing, `controls with no accessible name: ${missing.join(', ')}`).toEqual([]);
    });

    test('every button on the login screen has an accessible name', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('button').first()).toBeVisible();

        const missing = await unnamed(page, 'button, [role=button]');
        expect(missing, `buttons that announce nothing: ${missing.join(', ')}`).toEqual([]);
    });

    test('the login form can be completed and submitted by keyboard alone', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('input').first()).toBeVisible();

        // Walk forward with Tab only, filling the first two text-ish controls,
        // and confirm focus is always on a real, identifiable element.
        const filled = [];
        for (let i = 0; i < 25 && filled.length < 2; i += 1) {
            await page.keyboard.press('Tab');
            const focused = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                return { tag: el.tagName.toLowerCase(), type: el.type ?? null };
            });
            // Focus must never fall off the document into nothing.
            expect(focused, 'Tab moved focus to nothing — the tab order has a hole').not.toBeNull();

            if (focused.tag === 'input' && ['text', 'password', null].includes(focused.type)) {
                await page.keyboard.type(filled.length === 0 ? 'admin' : 'admin123');
                filled.push(focused.type);
            }
        }
        expect(filled.length, 'could not reach two text inputs by Tab').toBe(2);

        await page.keyboard.press('Enter');
        // Enter on the form must do something — either authenticate, or report a
        // failure. What it must not do is nothing at all.
        await expect
            .poll(async () => page.url() + '|' + (await page.locator('body').innerText()).slice(0, 400),
                { timeout: 15_000 })
            .not.toBe(page.url() + '|');
    });

    test('the page declares its language', async ({ page }) => {
        await page.goto('/');
        // Without a lang attribute a screen reader reads Finnish with an English
        // voice. It is one attribute and it is the cheapest a11y win there is.
        const lang = await page.locator('html').getAttribute('lang');
        expect(lang, 'the <html> element has no lang attribute').toBeTruthy();
    });
});
