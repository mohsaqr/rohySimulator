// A localisation pass — the automated half of the I18N.* cases.
//
// A person judges whether a translation is *good*. A machine can judge the two
// things that break silently and are tedious to eyeball:
//   1. every shipped language is actually offered, and switching one works;
//   2. nothing on a primary screen is a hardcoded English string.
//
// (2) uses the pseudo-locale. `?pseudo=1` renders `en-XA`, where every
// translated string is wrapped in brackets and accented:
//     "Sign In"  ->  "[Šíğñ Íñ··]"
// so any plain ASCII English still on screen is a string that never went
// through t() — invisible in English, and untranslatable in all eight
// languages. The padding also reveals what will overflow in Finnish.
//
// Languages are read from server/shared/languages.js, the single source of
// truth. Adding a language there must not require editing this spec.

import { test, expect } from './fixtures/index.js';
import { LANGUAGES } from '../../server/shared/languages.js';

const SHIPPED = Object.keys(LANGUAGES);

test.describe('localisation', () => {
    test('the login screen offers every shipped language', async ({ page }) => {
        await page.goto('/');
        const select = page.locator('select').first();
        await expect(select).toBeVisible();

        const offered = await select.locator('option').evaluateAll(
            (options) => options.map((o) => o.value),
        );
        // Every language the server knows must be reachable before login — the
        // login page is the one screen a user cannot get past to change it.
        expect(offered.sort()).toEqual(expect.arrayContaining(SHIPPED.sort()));
    });

    test('choosing a language changes the login screen', async ({ page }) => {
        await page.goto('/');
        const select = page.locator('select').first();

        const before = await page.locator('body').innerText();
        await select.selectOption('de');
        // Locales other than English are code-split and lazy, so wait for the
        // text to actually change rather than for a fixed delay.
        await expect
            .poll(async () => page.locator('body').innerText(), { timeout: 10_000 })
            .not.toBe(before);

        const after = await page.locator('body').innerText();
        expect(after).not.toBe(before);
    });

    test('the login screen has no hardcoded English', async ({ page }) => {
        await page.goto('/?pseudo=1');

        // Wait for the pseudo bundle to land: its strings are bracketed.
        await expect
            .poll(async () => page.locator('body').innerText(), { timeout: 10_000 })
            .toMatch(/\[[^\]]*\]/);

        const text = await page.locator('body').innerText();

        // These are the login screen's own labels. Seeing them verbatim under the
        // pseudo-locale means they bypassed the catalogue.
        for (const literal of ['Sign In', 'Username', 'Password']) {
            expect(text, `"${literal}" is rendered as plain English under the pseudo-locale, so it is hardcoded`)
                .not.toContain(literal);
        }
    });

    test('a language choice survives a reload', async ({ page }) => {
        await page.goto('/');
        await page.locator('select').first().selectOption('sv');
        await expect.poll(async () => page.locator('select').first().inputValue()).toBe('sv');

        await page.reload();
        // The resolved language is parked client-side precisely so a returning
        // browser keeps it when the platform default changes underneath it.
        await expect.poll(async () => page.locator('select').first().inputValue(), { timeout: 10_000 }).toBe('sv');
    });
});
