// Terms of use, end to end.
//
//   - the agreement is readable from the login screen, before signing in;
//   - once an admin requires acceptance, a person who has not accepted meets a
//     full-page step after signing in, and Rohy does not open behind it;
//   - declining signs out; reading to the end and agreeing opens Rohy, and the
//     step does not return;
//   - the admin sees how many accounts have accepted.
//
// Acceptance is switched back off afterwards, so no other spec meets the step.

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';

const STAMP = Date.now();
const LEARNER = { username: `terms_${STAMP}`, password: 'TermsUse123' };
const SHOTS = path.join(process.cwd(), 'tmp');

async function setRequired(baseURL, required) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const res = await admin.put('/api/platform-settings/terms', { data: { required } });
        expect(res.ok(), await res.text()).toBeTruthy();
        return res.json();
    } finally { await admin.dispose(); }
}

async function signedInPage(browser, baseURL) {
    const ctx = await pwRequest.newContext({ baseURL });
    let token;
    try {
        const res = await ctx.post('/api/auth/login', { data: LEARNER });
        expect(res.ok(), await res.text()).toBeTruthy();
        token = (await res.json()).token;
    } finally { await ctx.dispose(); }
    const context = await browser.newContext({ baseURL });
    await context.addInitScript((t) => { try { window.localStorage.setItem('token', t); } catch { /* ignore */ } }, token);
    return { context, page: await context.newPage(), token };
}

test.describe('terms of use', () => {
    test.describe.configure({ mode: 'serial', timeout: 90_000 });

    test.beforeAll(async ({ baseURL }) => {
        fs.mkdirSync(SHOTS, { recursive: true });
        const admin = await apiAsAdmin(baseURL);
        try {
            await admin.put('/api/platform-settings/setup', { data: { completed: true } });
            const created = await admin.post('/api/users/create', {
                data: { ...LEARNER, name: 'Terms Learner', email: `${LEARNER.username}@terms.test`, role: 'student' },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
        } finally { await admin.dispose(); }
    });

    test.afterAll(async ({ baseURL }) => {
        await setRequired(baseURL, false);
    });

    test('the agreement can be read from the login screen', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Terms of use' }).click();
        await expect(page.getByRole('heading', { name: /Learning Analytics Principles and Agreement/ })).toBeVisible();
        await expect(page.getByText('Your privacy is guaranteed.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Back' }).click();
        await expect(page.getByRole('button', { name: 'Terms of use' })).toBeVisible();
    });

    test('a learner must accept before Rohy opens; declining signs out', async ({ browser, baseURL }) => {
        await setRequired(baseURL, true);

        // Decline: signed out, back at the login screen.
        let session = await signedInPage(browser, baseURL);
        try {
            await session.page.goto('/');
            const heading = session.page.getByRole('heading', { name: /Learning Analytics Principles and Agreement/ });
            await expect(heading).toBeVisible({ timeout: 20_000 });
            await expect(session.page.getByPlaceholder(/^Message /i)).toHaveCount(0);
            await session.page.screenshot({ path: path.join(SHOTS, 'terms-gate.png') });
            await session.page.getByRole('button', { name: 'Decline and sign out' }).click();
            await expect(session.page.getByRole('button', { name: 'Terms of use' })).toBeVisible({ timeout: 15_000 });
        } finally { await session.context.close(); }

        // Accept: read to the end, tick, agree — Rohy opens and the step is gone for good.
        session = await signedInPage(browser, baseURL);
        try {
            const { page, token } = session;
            await page.goto('/');
            await expect(page.getByRole('heading', { name: /Learning Analytics Principles and Agreement/ })).toBeVisible({ timeout: 20_000 });
            const agree = page.getByRole('button', { name: 'Agree and continue' });
            const tick = page.getByRole('checkbox');
            await expect(tick).toBeDisabled();
            await page.getByTestId('terms-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
            await expect(tick).toBeEnabled();
            await expect(agree).toBeDisabled();
            await tick.check();
            await agree.click();
            await expect(page.getByRole('heading', { name: /Learning Analytics Principles and Agreement/ })).toHaveCount(0, { timeout: 15_000 });

            const status = await (await page.request.get('/api/terms/status', { headers: { Authorization: `Bearer ${token}` } })).json();
            expect(status.terms).toMatchObject({ accepted: true, pending: false, version: '1.0' });

            await page.reload();
            await page.waitForLoadState('networkidle');
            await expect(page.getByRole('heading', { name: /Learning Analytics Principles and Agreement/ })).toHaveCount(0);
        } finally { await session.context.close(); }
    });

    test('the admin edits the agreement in Settings → Platform → Users', async ({ adminPage, baseURL }) => {
        // The requirement applies to admins too: accept first, as a real admin would.
        const admin = await apiAsAdmin(baseURL);
        try {
            const res = await admin.post('/api/terms/accept', { data: { version: '1.0' } });
            expect(res.ok(), await res.text()).toBeTruthy();
        } finally { await admin.dispose(); }
        await adminPage.addInitScript(() => {
            try { window.localStorage.setItem('rohy_view', JSON.stringify({ view: 'settings' })); } catch { /* noop */ }
        });
        await adminPage.goto('/');
        await adminPage.waitForLoadState('networkidle');
        await adminPage.getByRole('button', { name: 'Platform', exact: true }).first().click({ timeout: 20_000 });
        await adminPage.getByRole('button', { name: 'Users', exact: true }).last().click();
        const heading = adminPage.getByRole('heading', { name: 'Terms of use' });
        await expect(heading).toBeVisible({ timeout: 15_000 });
        const panel = heading.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
        await expect(panel.getByText(/active accounts have accepted version 1\.0/)).toBeVisible();
        await expect(panel.getByLabel('Require acceptance')).toBeChecked();
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: path.join(SHOTS, 'terms-settings.png') });
    });

    test('the admin sees who has accepted', async ({ baseURL }) => {
        const admin = await apiAsAdmin(baseURL);
        try {
            const data = await (await admin.get('/api/platform-settings/terms')).json();
            expect(data.draft.required).toBe(true);
            expect(data.adoption.accepted).toBeGreaterThanOrEqual(1);
        } finally { await admin.dispose(); }
    });
});
