// An account that has never answered the Oyon consent question is asked — and
// once it says yes, capture runs, without a reload.
//
// Found on production 2026-09-17: an admin switched Oyon Voice on, talked to
// the patient, and nothing was captured. Their account had never answered the
// consent question, and nothing ever asked it — the student welcome page is the
// only place a never-answered person was asked, and admins never see it (they
// get the platform setup wizard). The upgrade card asked only people who had
// already said yes.
//
// Proven here on a fresh admin: the first-time card appears, names the camera
// and the signals, records the tenant's contract on "Yes", and typing is then
// captured on the same page.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';

const STAMP = Date.now();
const ADMIN = { username: `firstask_${STAMP}`, name: 'First Ask', password: 'FirstAsk123' };

/** GET → spread → PUT: the Oyon settings endpoint replaces its booleans. */
async function setTenantVoice(baseURL, on) {
    const admin = await apiAsAdmin(baseURL);
    try {
        const { settings } = await (await admin.get('/api/addons/oyon/settings')).json();
        const res = await admin.put('/api/addons/oyon/settings', { data: { ...settings, voice_enabled: on } });
        expect(res.ok(), await res.text()).toBeTruthy();
    } finally { await admin.dispose(); }
}

test.describe('oyon consent — first ask', () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeAll(async ({ baseURL }) => {
        const admin = await apiAsAdmin(baseURL);
        try {
            await admin.put('/api/platform-settings/setup', { data: { completed: true } });
            const created = await admin.post('/api/users/create', {
                data: { ...ADMIN, email: `${ADMIN.username}@firstask.test`, role: 'admin' },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
        } finally { await admin.dispose(); }
        // Voice on, as on the production tenant where this was found: the card
        // must then name the microphone and use the voice note.
        await setTenantVoice(baseURL, true);
    });

    test.afterAll(async ({ baseURL }) => {
        await setTenantVoice(baseURL, false);
    });

    test('an admin who never answered is asked, and typing is captured once they agree', async ({ browser, baseURL }) => {
        const login = await pwRequest.newContext({ baseURL });
        let token;
        try {
            const res = await login.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
            expect(res.ok(), await res.text()).toBeTruthy();
            token = (await res.json()).token;
        } finally { await login.dispose(); }

        const context = await browser.newContext({ baseURL });
        await context.addInitScript((t) => { try { window.localStorage.setItem('token', t); } catch { /* ignore */ } }, token);
        const page = await context.newPage();
        try {
            let typingStored = 0;
            page.on('response', async (r) => {
                if (!r.url().includes('/api/addons/oyon/emotion-records') || r.request().method() !== 'POST') return;
                if (!(r.request().postData() || '').includes('"modality":"typing"')) return;
                try { typingStored += (await r.json()).signals_inserted ?? 0; } catch { /* counted as nothing */ }
            });

            await page.goto('/');
            await page.waitForLoadState('networkidle');

            const title = page.getByRole('heading', { name: 'Can Oyon record how you work?' });
            await expect(title).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText(/Camera-based estimates of emotion and attention/)).toBeVisible();
            await expect(page.getByText(/Typing rhythm in the message box/)).toBeVisible();
            await expect(page.getByText(/How you sound while you speak to the patient/)).toBeVisible();
            await expect(page.getByText(/keeps your existing/)).toHaveCount(0);
            await page.screenshot({ path: 'tmp/consent-first-ask.png' });

            const { consent_version: required } = await (await page.request.get('/api/addons/oyon/config', {
                headers: { Authorization: `Bearer ${token}` },
            })).json();
            await page.getByRole('button', { name: 'Yes, I agree' }).click();
            await expect(title).toBeHidden();

            const prefs = await (await page.request.get('/api/users/preferences', { headers: { Authorization: `Bearer ${token}` } })).json();
            const onboarding = JSON.parse(prefs.onboarding_settings || '{}');
            expect(onboarding.oyon_consent).toBe(true);
            expect(onboarding.oyon_consent_version).toBe(required);

            const skip = page.getByRole('button', { name: /^Skip$/i });
            if (await skip.count()) await skip.first().click();
            const composer = page.getByPlaceholder(/^Message /i);
            await composer.waitFor({ state: 'visible', timeout: 25_000 });
            await composer.click();
            await composer.pressSequentially('How long has this been going on?', { delay: 60 });
            await composer.press('Enter');
            await expect.poll(() => typingStored, {
                timeout: 30_000,
                message: 'no typing window stored after the admin agreed on the first-time card',
            }).toBeGreaterThanOrEqual(1);

            // Asked once: a reload does not bring the card back.
            await page.reload();
            await page.waitForLoadState('networkidle');
            await expect(title).toHaveCount(0);
        } finally { await context.close(); }
    });
});
