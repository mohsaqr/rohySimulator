// Playwright globalSetup — mint admin + student tokens once at the start
// of the e2e run, write them to a file the fixtures read.
//
// Why: the server's auth rate limit is 10 logins per 15 minutes per IP
// (server/routes.js:38). With 12 spec files each calling loginAs() per
// test, the combined run exceeds it within the first few specs and the
// rest cascade-fail with HTTP 429. Pre-minting once sidesteps it.
//
// The fixtures (auth.js, seed.js) check for this file first; if absent
// they fall back to live login. That keeps in-isolation spec runs
// (`npx playwright test foo.spec.js`) working even without globalSetup.

import { request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_FILE = path.join(__dirname, '.auth', 'tokens.json');

const CREDS = {
    admin:   { username: 'admin',   password: 'admin123' },
    student: { username: 'student', password: 'student123' },
};

async function login(baseURL, role) {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const res = await ctx.post('/api/auth/login', { data: CREDS[role] });
        if (!res.ok()) throw new Error(`globalSetup login(${role}) → ${res.status()}: ${await res.text()}`);
        const body = await res.json();
        return { token: body.token, user: body.user };
    } finally { await ctx.dispose(); }
}

export default async function globalSetup(config) {
    const baseURL = config.projects[0]?.use?.baseURL || 'http://127.0.0.1:4811';
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });

    // Wait briefly for the server to come up — the webServer block races
    // globalSetup occasionally on slower machines.
    let lastErr = null;
    for (let i = 0; i < 30; i++) {
        try {
            const admin = await login(baseURL, 'admin');
            const student = await login(baseURL, 'student');
            const tokens = { admin, student, baseURL, mintedAt: new Date().toISOString() };
            fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

            // First-run gates (shipped v2.7.1, after Playwright left CI):
            // on a fresh e2e DB the admin gets the Platform-setup wizard and
            // students get the welcome page — both render ABOVE the app and
            // occlude everything the specs assert on. Complete both here so
            // tests exercise the normal app; the wizard flows themselves can
            // be tested by explicitly resetting the flags in a spec.
            // Bearer requests skip CSRF, so plain PUTs with the minted
            // tokens are enough.
            const ctx = await pwRequest.newContext({ baseURL });
            try {
                const setupRes = await ctx.put('/api/platform-settings/setup', {
                    headers: { Authorization: `Bearer ${admin.token}` },
                    data: { completed: true },
                });
                if (!setupRes.ok()) throw new Error(`platform setup complete → ${setupRes.status()}: ${await setupRes.text()}`);
                // Both seeded accounts also ANSWER the Oyon consent question
                // (no). An account that has never answered is asked by a modal
                // card on its next page (OyonConsentUpdate, beta.73), which
                // would cover every screen these specs assert on. "No" keeps
                // their previous behaviour — capture off — and the Oyon specs
                // record their own consent where they need it.
                const prefRes = await ctx.put('/api/users/preferences', {
                    headers: { Authorization: `Bearer ${student.token}` },
                    // Same shape StudentFirstRun writes: first_run_done is a
                    // VERSION number compared with >=, not a boolean.
                    data: { onboarding_settings: { first_run_done: 1, oyon_consent: false } },
                });
                if (!prefRes.ok()) throw new Error(`student first-run complete → ${prefRes.status()}: ${await prefRes.text()}`);
                const adminPrefRes = await ctx.put('/api/users/preferences', {
                    headers: { Authorization: `Bearer ${admin.token}` },
                    data: { onboarding_settings: { oyon_consent: false } },
                });
                if (!adminPrefRes.ok()) throw new Error(`admin oyon answer → ${adminPrefRes.status()}: ${await adminPrefRes.text()}`);
            } finally { await ctx.dispose(); }

            console.log(`[globalSetup] minted tokens + completed first-run gates at ${TOKEN_FILE}`);
            return;
        } catch (err) {
            lastErr = err;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`globalSetup: could not mint tokens after 15s: ${lastErr?.message || lastErr}`);
}
