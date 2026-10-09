// PRV-22: pressing Start is never an affirmative camera-consent action,
// including on a shared browser holding another person's previous grant.
import { test, expect } from './fixtures/index.js';
import { apiAsAdmin } from './fixtures/seed.js';
import { request as pwRequest } from '@playwright/test';
import { parseOnboardingSettings } from '../../src/utils/onboardingSettings.js';

test.describe('student camera consent', () => {
    test.describe.configure({ timeout: 60_000 });
    let originalOyon;

    test.beforeAll(async ({ baseURL }) => {
        const admin = await apiAsAdmin(baseURL);
        try {
            const setup = await admin.put('/api/platform-settings/setup', { data: { completed: true } });
            expect(setup.ok(), await setup.text()).toBeTruthy();
            const settings = await admin.get('/api/addons/oyon/settings');
            expect(settings.ok(), await settings.text()).toBeTruthy();
            originalOyon = (await settings.json()).settings;
            const enabled = await admin.put('/api/addons/oyon/settings', {
                data: { ...originalOyon, emotion_capture_enabled: true },
            });
            expect(enabled.ok(), await enabled.text()).toBeTruthy();
        } finally { await admin.dispose(); }
    });

    test.afterAll(async ({ baseURL }) => {
        if (!originalOyon) return;
        const admin = await apiAsAdmin(baseURL);
        try {
            const restored = await admin.put('/api/addons/oyon/settings', { data: originalOyon });
            expect(restored.ok(), await restored.text()).toBeTruthy();
        } finally { await admin.dispose(); }
    });

    async function newLearner(browser, baseURL, staleBrowserConsent) {
        const username = `prv22_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const password = 'Consent123';
        const admin = await apiAsAdmin(baseURL);
        try {
            const created = await admin.post('/api/users/create', {
                data: { username, password, name: 'Consent Regression', email: `${username}@consent.test`, role: 'student' },
            });
            expect(created.ok(), await created.text()).toBeTruthy();
        } finally { await admin.dispose(); }
        const anonymous = await pwRequest.newContext({ baseURL });
        let token;
        try {
            const login = await anonymous.post('/api/auth/login', { data: { username, password } });
            expect(login.ok(), await login.text()).toBeTruthy();
            token = (await login.json()).token;
            expect(token).toBeTruthy();
        } finally { await anonymous.dispose(); }
        const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
        const localStorage = [{ name: 'token', value: token }];
        if (staleBrowserConsent) localStorage.push(
            { name: 'oyon.defaultConsent', value: '1' },
            { name: 'oyon.consentVersion', value: 'oyon-consent-v3' },
        );
        const context = await browser.newContext({
            baseURL,
            storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage }] },
        });
        return { api, context, page: await context.newPage() };
    }

    async function readConsent(api) {
        const prefs = await api.get('/api/users/preferences');
        expect(prefs.ok(), await prefs.text()).toBeTruthy();
        return parseOnboardingSettings(await prefs.json());
    }

    async function verifyChoice(browser, baseURL, { staleBrowserConsent = false, optIn = false } = {}) {
        const { api, context, page } = await newLearner(browser, baseURL, staleBrowserConsent);
        try {
            const before = await readConsent(api);
            expect(before.oyon_consent === true).toBe(false);
            expect(before.first_run_done ?? 0).toBe(0);
            await page.goto('/');
            const welcome = page.getByRole('heading', { name: 'Welcome to Rohy', level: 1 });
            await expect(welcome).toBeVisible();
            const consent = page.getByRole('checkbox', { name: /Allow camera-based emotion capture/i });
            await expect(consent).toBeVisible();
            await expect(consent).not.toBeChecked();
            await test.info().attach('welcome-consent-starts-unchecked', {
                body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
            });
            if (optIn) await consent.check();
            await page.getByRole('button', { name: /^Start$/ }).click();
            await expect(welcome).toBeHidden({ timeout: 15_000 });
            const expected = {
                first_run_done: 1,
                oyon_consent: optIn,
                oyon_consent_version: optIn ? 'oyon-consent-v1' : null,
            };
            await expect.poll(() => readConsent(api)).toMatchObject(expected);
            expect(await page.evaluate(() => localStorage.getItem('oyon.defaultConsent'))).toBe(optIn ? '1' : '0');
            expect(await page.evaluate(() => localStorage.getItem('oyon.consentVersion'))).toBe(optIn ? 'oyon-consent-v1' : null);
            if (!optIn) await expect(page.getByText(/You previously agreed to camera-based emotion capture/i)).toHaveCount(0);
            await page.reload();
            await expect(page.getByRole('button', { name: /settings and profile menu/i })).toBeVisible({ timeout: 20_000 });
            await expect(welcome).toHaveCount(0);
            expect(await readConsent(api)).toMatchObject(expected);
        } finally {
            await context.close();
            await api.dispose();
        }
    }

    test('a fresh learner starts unchecked and Start persists no camera consent across reload', async ({ browser, baseURL }) => {
        await verifyChoice(browser, baseURL);
    });

    test('a fresh learner never inherits another person’s browser consent and Start persists no consent', async ({ browser, baseURL }) => {
        await verifyChoice(browser, baseURL, { staleBrowserConsent: true });
    });

    test('a learner’s explicit opt-in persists only the camera contract across reload', async ({ browser, baseURL }) => {
        await verifyChoice(browser, baseURL, { optIn: true });
    });
});
