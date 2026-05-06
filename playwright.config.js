// Playwright configuration for rohySimulator end-to-end tests.
//
// Why one webServer instead of an array?
//   server/server.js already serves the built `frontend/` tree as static
//   assets (see `app.use('/', express.static(...))` in server/server.js),
//   so the Express process is *both* the API and the SPA host. We therefore
//   only need to spawn a single process — no separate `vite preview`. This
//   matches option (b) in the Phase 5 brief and mirrors how the audit
//   scripts (scripts/audit-*.sh) talk to a single combined backend.
//
// Build prerequisite:
//   `npm run build` must have run at least once before `npm run test:e2e`,
//   otherwise the server returns a console error for `/` (the static
//   middleware short-circuits when frontend/ is empty). CI runs build
//   explicitly; locally, devs do the same. We do NOT auto-build inside
//   playwright.config.js — that would mask "did you forget to build?"
//   regressions and add 10–30 s to every e2e run.
//
// DB isolation:
//   Each `npm run test:e2e` invocation gets ONE temp sqlite DB shared by
//   every spec in that run. workers=1 + fullyParallel=false make this safe.
//   When future agents need per-worker isolation they should refactor this
//   block to mint a DB per worker (see PLAYWRIGHT_E2E_DB env passthrough).
//
// Port choice:
//   4811 is reserved here for e2e. The audit scripts live in 3900–4399 and
//   the dev server uses 3000 (api) + 5173 (vite). 4811 leaves the audit
//   range alone so audit + e2e can run in parallel from a single tree.

import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E2E_PORT = 4811;
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// One temp DB per `npm run test:e2e` invocation. Mirrors the pattern in
// tests/utils/seedDb.js (mkdtemp + sqlite file inside) but lives outside
// node_modules so we don't need to import the seedDb module from a config
// file (Playwright's config loader is plain ESM — top-level imports of
// project source can race the sqlite3 native binding on some hosts).
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-e2e-'));
const DB_PATH = path.join(DB_DIR, 'db.sqlite');

// Best-effort cleanup. Playwright doesn't expose a globalTeardown hook in
// the config object directly without a separate setup file, but the OS
// will reap /tmp/rohy-e2e-* eventually. We register signal handlers so
// Ctrl+C in a local run still cleans up.
function cleanup() {
    try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

export default defineConfig({
    testDir: './tests/e2e',
    globalSetup: './tests/e2e/global-setup.js',
    // Specs share the same DB (see header comment) — running them in
    // parallel would let one spec's seed data leak into another's
    // assertions. Until per-worker DB isolation lands, keep it serial.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results.e2e.junit.xml' }],
    ],
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        // Spawn the real Express boot path. Same binary the audit scripts
        // use, same binary `npm run server` uses — what we test is what
        // we ship.
        command: 'node server/server.js',
        url: BASE_URL,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            PORT: String(E2E_PORT),
            ROHY_DB: DB_PATH,
            JWT_SECRET: 'rohy-e2e-secret',
            NODE_ENV: 'test',
            // Keep the operator's piper/llm config out of e2e — tests that
            // need TTS or LLM will mock at the network layer.
            PIPER_DISABLED: '1',
            // server/services/kokoroTts.js statically imports `kokoro-js`
            // → `phonemizer`. Phonemizer hijacks process-level error
            // handlers and re-throws into uncaughtException, killing the
            // process. The preload script in tests/e2e/preload-server.cjs
            // patches `process.on` so phonemizer's `throw`-style listeners
            // are dropped while server.js' own handlers still register.
            // See the preload file for the full rationale.
            NODE_OPTIONS: `--unhandled-rejections=warn --require ${path.resolve(__dirname, 'tests/e2e/preload-server.cjs')}`,
        },
    },
});

export const E2E_BASE_URL = BASE_URL;
export const E2E_PORT_NUMBER = E2E_PORT;
