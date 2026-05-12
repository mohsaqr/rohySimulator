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
             
            console.log(`[globalSetup] minted tokens at ${TOKEN_FILE}`);
            return;
        } catch (err) {
            lastErr = err;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`globalSetup: could not mint tokens after 15s: ${lastErr?.message || lastErr}`);
}
