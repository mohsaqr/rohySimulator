// Oyon typing capture, end to end — the automated half of the typing cases.
//
// Typing was fully wired for months and never produced a single row: the only
// screen that wrote a server consent row (student first-run) recorded the wrong
// contract, and the upgrade prompt only asks people who already have one. Unit
// tests of each piece passed throughout. This spec proves the WHOLE path: a
// learner holding consent v2 types in the patient composer, sends, and the
// server stores a typing window.
//
// What it deliberately does not assert: the metrics inside the window (pause
// distribution, burst length). Those are Oyon's, tested upstream; rohy owns
// getting an episode from the composer to the table under the right consent.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

async function asStudent(baseURL, fn) {
    const { token } = await loginAs(baseURL, 'student');
    const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    try { return await fn(ctx); } finally { await ctx.dispose(); }
}

async function completeSetup(baseURL) {
    const admin = await apiAsAdmin(baseURL);
    try { await admin.put('/api/platform-settings/setup', { data: { completed: true } }); } finally { await admin.dispose(); }
}

/**
 * Land in the patient room and return the composer.
 *
 * A learner on an older contract is shown the re-consent card, a modal that
 * sits over the onboarding tour — so it has to be answered first. Declining is
 * the realistic path for these tests: it keeps the learner exactly where they
 * were, which is the state being tested.
 */
async function openComposer(page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const decline = page.getByRole('button', { name: /No, keep it as it is/i });
    if (await decline.count()) {
        await decline.first().click();
        await expect(decline.first()).toBeHidden();
    }
    const skip = page.getByRole('button', { name: /^Skip$/i });
    if (await skip.count()) {
        await skip.first().click();
        await expect(skip.first()).toBeHidden();
    }
    const composer = page.getByPlaceholder(/^Message /i);
    await composer.waitFor({ state: 'visible', timeout: 25_000 });
    return composer;
}

function typingPost(page) {
    return page.waitForResponse(
        (r) => r.url().includes('/api/addons/oyon/emotion-records')
            && r.request().method() === 'POST'
            && (r.request().postData() || '').includes('"modality":"typing"'),
        { timeout: 30_000 },
    );
}

function typingEventsPost(page) {
    return page.waitForResponse(
        (r) => r.url().includes('/api/addons/oyon/signal-events')
            && r.request().method() === 'POST'
            && (r.request().postData() || '').includes('"modality":"typing"'),
        { timeout: 30_000 },
    );
}

test.describe('oyon typing capture', () => {
    test.beforeAll(async ({ baseURL }) => {
        await completeSetup(baseURL);
    });

    test('a message typed under consent v2 is stored as a typing window', async ({ studentPage, baseURL }) => {
        await asStudent(baseURL, (ctx) => ctx.put('/api/users/preferences', {
            data: { onboarding_settings: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } },
        }));

        const composer = await openComposer(studentPage);
        const posted = typingPost(studentPage);
        const eventsPosted = typingEventsPost(studentPage);

        await composer.click();
        // Real keystrokes with real gaps: the adapter measures timing, so a
        // single fill() would be one event and no rhythm at all.
        await composer.pressSequentially('Where does it hurt?', { delay: 60 });
        await composer.press('Enter');

        const res = await posted;
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.signals_inserted, `server response: ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(1);
        expect(body.signals_consent_blocked).toBe(0);

        // The privacy promise on the consent card: rhythm, never the words.
        expect(res.request().postData()).not.toContain('Where does it hurt');

        // The per-event state log, for sequence analysis: one row per edit, so
        // a 19-character message yields at least that many stored events.
        const eventsRes = await eventsPosted;
        expect(eventsRes.status(), await eventsRes.text()).toBe(200);
        const eventsBody = await eventsRes.json();
        expect(eventsBody.consent_blocked).toBe(0);
        const sentEvents = JSON.parse(eventsRes.request().postData()).events;
        expect(sentEvents.filter((e) => e.state === 'insert').length).toBeGreaterThanOrEqual(1);
        expect(eventsBody.inserted).toBe(sentEvents.length);
        expect(eventsRes.request().postData()).not.toContain('Where does it hurt');
    });

    test('nothing is captured for a learner on the camera-only contract', async ({ studentPage, baseURL }) => {
        await asStudent(baseURL, (ctx) => ctx.put('/api/users/preferences', {
            data: { onboarding_settings: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } },
        }));

        const typingRequests = [];
        studentPage.on('request', (r) => {
            if (/\/api\/addons\/oyon\/(emotion-records|signal-events)/.test(r.url()) && (r.postData() || '').includes('"modality":"typing"')) {
                typingRequests.push(r);
            }
        });

        const composer = await openComposer(studentPage);
        await composer.click();
        await composer.pressSequentially('Any chest pain?', { delay: 60 });
        await composer.press('Enter');

        // No event to wait for — the assertion is that one never comes. Give
        // the capture as long as the positive test needed, then check.
        await studentPage.waitForTimeout(8_000);
        expect(typingRequests, 'a v1 learner had typing captured').toHaveLength(0);
    });
});
