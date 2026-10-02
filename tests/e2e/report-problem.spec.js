// Report a problem, end to end (owner's design, 2026-10-02), in Chromium against a LOCAL, scratch Prova.
//
// The user menu (the gear) → Report a problem… → the dialog shows exactly what is sent → Sent — thank you ·
// AR-n → My reports: Received. Then Prova trusts the installation and a tester closes the report: the
// trigger gets its amber dot, "My reports · 1 new", Closed with the reason, and the dot goes once seen.
//
// This spec starts its OWN rohy (tests/utils/startTestServer.js, a temp DB) pointed at its own Prova (the
// Prova checkout beside rohy — the one scripts/clone-prova.sh places for the reporter — on port 0 with a
// temp data dir). It never reaches the live Prova. Skips when no Prova checkout with the intake API exists.
// Needs `npm run build:e2e` first, like every UI spec.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVA = process.env.PROVA_DIR || path.resolve(ROOT, '..', 'prova');
const HAS_PROVA = fs.existsSync(path.join(PROVA, 'server', 'api', 'intake.mjs'));
const PASSWORD = 'ReportE2e!9x';
const SHOTS = path.join(ROOT, 'tmp', 'report-problem');

test.describe('Report a problem', () => {
    test.skip(!HAS_PROVA, `no Prova checkout with the intake API at ${PROVA} (set PROVA_DIR)`);
    test.describe.configure({ mode: 'serial', timeout: 120_000 });

    let prova; let provaDb; let provaData; let adminToken; let rohy; let token;
    const provaApi = async (method, urlPath, body) => {
        const r = await fetch(`${prova.url}/api/v1${urlPath}`, { method, headers: { Authorization: `Bearer ${adminToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json().catch(() => null) };
    };

    test.beforeAll(async () => {
        fs.mkdirSync(SHOTS, { recursive: true });
        const load = (rel) => import(pathToFileURL(path.join(PROVA, rel)).href);
        const { startServer } = await load('server/main.mjs');
        const { openDb, tx } = await load('server/db.mjs');
        const { createAccount, createToken, hashPassword } = await load('server/auth.mjs');
        const { validateProfile } = await load('server/lib/products.mjs');
        const { insertProduct } = await load('server/api/products.mjs');
        provaData = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-report-prova-'));
        prova = await startServer({ port: 0, bind: '127.0.0.1', dataDir: provaData, cvsUrl: 'http://127.0.0.1:9' });
        provaDb = openDb(provaData);
        const hash = await hashPassword(PASSWORD);
        adminToken = tx(provaDb, () => {
            insertProduct(provaDb, { account: null, token: null }, validateProfile({ id: 'rohy', name: 'Rohy', kind: 'web-app', platforms: ['chrome'], build_source: { type: 'choose' }, importers: ['manual'] }));
            const admin = createAccount(provaDb, { name: 'mohammed', isAdmin: true, passwordHash: hash });
            return createToken(provaDb, { accountId: admin.id, name: 'e2e', scopes: ['results:read', 'results:write', 'defects:write', 'catalog:write', 'admin'], products: ['*'] }).secret;
        });

        rohy = await startTestServer({ seed: false, env: {
            ROHY_PROVA_URL: prova.url, ROHY_REPORT_HOST: 'rohy.test', ROHY_REPORT_KEY_FILE: path.join(provaData, 'rohy-report-key.json'),
            ROHY_DISABLE_GENERAL_RATE_LIMIT: '1', ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
        } });
        const db = await new Promise((resolve, reject) => { const d = new (sqlite3.verbose().Database)(rohy.dbPath, (e) => (e ? reject(e) : resolve(d))); });
        const pwHash = await bcrypt.hash(PASSWORD, 4);
        await new Promise((resolve, reject) => db.run(`INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('beyza', 'Beyza', 'beyza@example.com', ?, 'student', 1, 'active')`, [pwHash], (e) => (e ? reject(e) : resolve())));
        await new Promise((r) => db.close(r));
        const login = await fetch(`${rohy.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beyza', password: PASSWORD }) });
        token = (await login.json()).token;
        expect(token).toBeTruthy();
        // Past the first-run screens, as tests/e2e/global-setup.js does for the seeded student.
        const prefs = await fetch(`${rohy.baseUrl}/api/users/preferences`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ onboarding_settings: { first_run_done: 1, oyon_consent: false } }) });
        expect(prefs.ok).toBe(true);
    });

    test.afterAll(async () => {
        await rohy?.close();
        provaDb?.close();
        await prova?.close();
        if (provaData) fs.rmSync(provaData, { recursive: true, force: true });
    });

    async function signedIn(browser) {
        const context = await browser.newContext({ baseURL: rohy.baseUrl, viewport: { width: 1280, height: 860 } });
        await context.addInitScript((t) => {
            try {
                window.localStorage.setItem('token', t);
                window.localStorage.setItem('rohy.onboarding.student.v1', 'done');
            } catch { /* ignore */ }
        }, token);
        const page = await context.newPage();
        await page.goto('/');
        return { context, page };
    }
    const accept = async (page) => {
        // The terms gate may ask first, on a fresh install.
        const agree = page.getByRole('button', { name: /accept|agree/i });
        if (await agree.isVisible({ timeout: 3000 }).catch(() => false)) await agree.click();
    };

    let reportId = null;

    test('the gear menu → Report a problem… → Sent — thank you · AR-n; Prova has it from the signed-in user', async ({ browser }) => {
        const { context, page } = await signedIn(browser);
        await accept(page);
        const trigger = page.getByRole('button', { name: 'Settings and profile menu' });
        await trigger.waitFor({ timeout: 30_000 });
        await trigger.click();
        await expect(page.getByTestId('menu-report-problem')).toBeVisible();
        await expect(page.getByTestId('menu-my-reports')).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, 'rohy-menu.png') });
        await page.getByTestId('menu-report-problem').click();
        await page.waitForSelector('[data-prova-dialog="report"]');
        await page.fill('textarea[name="what_happened"]', 'The monitor froze after I ordered a CBC');
        await page.fill('textarea[name="expected"]', 'The monitor keeps updating.');
        await page.click('[data-prova-sent-with] summary');
        await expect(page.locator('[data-prova-sent-with]')).toContainText('beyza');
        await expect(page.locator('[data-prova-sent-with]')).toContainText('no document content');
        await expect(page.locator('.prova-note')).toContainText('Goes to the Rohy developers');
        await page.screenshot({ path: path.join(SHOTS, 'rohy-dialog.png') });
        await page.click('[data-prova-send]');
        await page.waitForSelector('[data-prova-sent]');
        reportId = await page.getAttribute('[data-prova-sent]', 'data-prova-sent');
        expect(reportId).toMatch(/^AR-\d+$/);
        await page.screenshot({ path: path.join(SHOTS, 'rohy-sent.png') });
        const row = provaDb.prepare('SELECT ir.*, i.label, i.host, i.state FROM intake_report ir JOIN installation i ON i.id = ir.installation_id WHERE ir.id = ?').get(Number(reportId.slice(3)));
        expect(row.reporter_stated).toBe('beyza');
        expect(row.label).toBe('Rohy');
        expect(row.host).toBe('rohy.test');
        expect(row.state).toBe('unverified');
        expect(row.expected).toBe('The monitor keeps updating.');
        await page.click('[data-prova-open-mine]');
        await expect(page.locator(`[data-prova-item="${reportId}"]`)).toContainText('Received');
        await context.close();
    });

    test('news: the dot, "1 new", Closed with the reason; seen clears it', async ({ browser }) => {
        const installation = provaDb.prepare("SELECT id FROM installation WHERE label = 'Rohy'").get();
        expect((await provaApi('POST', `/installations/${installation.id}/trust`, {})).status).toBe(200);
        const appReport = provaDb.prepare('SELECT app_report_id FROM intake_report WHERE id = ?').get(Number(reportId.slice(3))).app_report_id;
        const list = await provaApi('GET', '/app-reports?product=rohy');
        expect(list.json.reports.find((r) => r.id === appReport).reported_by.line).toBe('beyza · via Rohy · rohy.test');
        expect((await provaApi('POST', `/app-reports/${appReport}/dismiss`, { reason: 'Expected: the monitor pauses while results are drawn' })).status).toBe(200);
        const { context, page } = await signedIn(browser);
        await accept(page);
        await expect(page.getByTestId('report-news-dot')).toBeVisible({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Settings and profile menu' }).click();
        await expect(page.getByTestId('my-reports-new')).toHaveText('1 new');
        await page.screenshot({ path: path.join(SHOTS, 'rohy-news-menu.png') });
        await page.getByTestId('menu-my-reports').click();
        const item = page.locator(`[data-prova-item="${reportId}"]`);
        await expect(item).toContainText('Closed');
        await expect(item).toContainText('Expected: the monitor pauses while results are drawn');
        await expect(page.getByTestId('report-news-dot')).toHaveCount(0);
        await page.screenshot({ path: path.join(SHOTS, 'rohy-mine.png') });
        await context.close();
    });
});
