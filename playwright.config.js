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
//   A build must have run at least once before `npm run test:e2e`, otherwise
//   the server returns a console error for `/` (the static middleware
//   short-circuits when frontend/ is empty). We do NOT auto-build inside
//   playwright.config.js — that would mask "did you forget to build?"
//   regressions and add 10–30 s to every e2e run.
//
//   Use `npm run build:e2e`, NOT `npm run build`.
//   `npm run build` is pinned to `--base=/rohy/` for the path-prefix deploy,
//   but this config serves the SPA from `/`. A bundle built with the /rohy/
//   base and served at / 404s every asset, so index.html loads, #root stays
//   empty and EVERY UI spec fails with "element(s) not found" — a failure that
//   reads like a broken app rather than a wrong base path. docs/DEPLOY.md:162
//   states the same rule for deployments: "Do not mix".
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

// Prova (test management, https://prova.lacarm.com) reporting.
//
// Prova ships the reporter — we never write another one. It is added only when
// that file is actually present, because it lives in a SIBLING checkout that a
// given machine may not have; without the file Playwright would fail to load
// the config, which would break `npm run test:e2e` for everyone who has not
// cloned Prova. With the file but without PROVA_URL + PROVA_TOKEN the reporter
// itself does nothing, so local runs stay silent and never touch the server.
//
// One Prova run per Playwright project; the project's browser becomes the
// platform (chromium → chrome). The check key a human reads in Prova is
//   rohy:<project>::<file relative to testDir> › <describe…> › <title>
// so test titles ARE the public interface here — prova/rohy-cases.yaml pins
// several of them in its `covers:` patterns. Renaming a test breaks that link.
const PROVA_REPORTER = process.env.PROVA_REPORTER
    || path.resolve(__dirname, '../prova/reporters/playwright.mjs');
const provaReporter = fs.existsSync(PROVA_REPORTER)
    ? [[PROVA_REPORTER, { product: 'rohy' }]]
    : [];

// Opt-in projects. Playwright runs EVERY defined project unless `--project`
// narrows it, and has no notion of a project that is off by default — so the
// projects that must never ride along with a bare `npx playwright test` (the
// CI gate run) are only defined when asked for:
//
//   ROHY_PW_PROJECTS=monkey      the seeded monkey walker (tests/monkey/)
//   ROHY_PW_PROJECTS=quarantine  the tests tagged @quarantine (below)
//   ROHY_PW_PROJECTS=all         every opt-in project — use it for
//                                `--list` when dumping check keys for Prova
//
// An env var, not an argv sniff: Playwright's workers load this config too,
// with their own argv, and a project missing from a worker's config fails the
// run. Env is inherited by the workers.
const OPT_IN = new Set((process.env.ROHY_PW_PROJECTS || '').split(',').map((s) => s.trim()).filter(Boolean));
const optedIn = (name) => OPT_IN.has(name) || OPT_IN.has('all');
const REPORT_SUFFIX = OPT_IN.size > 0 ? `-${[...OPT_IN].sort().join('-')}` : '';

const monkeyProject = {
    // A random walk inside a live case (tests/monkey/walker.spec.js). Its own
    // testDir, so the e2e projects never collect it; MONKEY_MINUTES sets how
    // long each case is walked, MONKEY_SEED replays a failed walk.
    name: 'monkey',
    testDir: './tests/monkey',
    testMatch: /\.spec\.js$/,
    // Never retried: a walk that fails and then passes is a finding, and a
    // retry would record it as a pass (the retry replays the seed, not the
    // timing that broke it).
    retries: 0,
    use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        // Real Chrome lets a page write the clipboard from a click on a secure
        // origin; headless Chromium refuses unless granted, and the vendored
        // Radoyon report's "Copy as text" (navigator.clipboard.writeText with
        // no catch) then throws an unhandled rejection the walker reports.
        // Granted so the walk matches a real browser. The missing catch is an
        // upstream Radoyon defect, recorded in LEARNINGS.md 2026-09-23.
        permissions: ['clipboard-write'],
    },
};

// Flake quarantine. A test whose title carries `@quarantine` is taken out of
// the gate: the default projects skip it (grepInvert), and it runs only in the
// opt-in `quarantine` project, which CI runs with continue-on-error and
// PROVA_LABEL=quarantine, so its results are still recorded. The rules — a
// PROVA-DEFECT link and a QUARANTINED date no older than 30 days on the two
// lines above — are enforced by scripts/check-quarantine.mjs in the lint job.
const QUARANTINE = /@quarantine/;

const quarantineProject = {
    name: 'quarantine',
    grep: QUARANTINE,
    // Desktop Chrome, no microphone: a quarantined voice spec would need the
    // chromium-voice project's fake-device flags added here.
    use: { ...devices['Desktop Chrome'] },
};

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
    // Per run kind, like the reports below: Playwright empties outputDir at
    // the start of a run, and the gate run's traces must survive the monkey's.
    outputDir: `test-results${REPORT_SUFFIX}`,
    reporter: [
        ['list'],
        // An opt-in run (the monkey, the quarantine) writes its own report,
        // so CI running it after the gate run does not overwrite the gate's.
        ['html', { open: 'never', outputFolder: `playwright-report${REPORT_SUFFIX}` }],
        ['junit', { outputFile: `test-results.e2e${REPORT_SUFFIX}.junit.xml` }],
        ...provaReporter,
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
            // The voice specs need a microphone, which only their own project has.
            testIgnore: /oyon-(voice|analytics-journey)\.spec\.js/,
            grepInvert: QUARANTINE,
        },
        {
            // Oyon voice capture, end to end. Plain headless Chromium refuses
            // getUserMedia (NotSupportedError, measured); Chromium's fake-device
            // flags grant a real audio track and auto-accept the permission
            // prompt. Kept to its own project so no other spec runs with a
            // microphone. Prova records it as its own run (check keys
            // `rohy:chromium-voice::…`), on the same `chrome` platform.
            name: 'chromium-voice',
            testMatch: /oyon-(voice|analytics-journey)\.spec\.js/,
            grepInvert: QUARANTINE,
            use: {
                ...devices['Desktop Chrome'],
                permissions: ['microphone'],
                launchOptions: {
                    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
                },
            },
        },
        ...(optedIn('monkey') ? [monkeyProject] : []),
        ...(optedIn('quarantine') ? [quarantineProject] : []),
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
            // The auth limiter caps 10 logins / 15 min / IP. globalSetup
            // pre-mints two tokens, but specs that create-and-login fresh
            // users (tenant, rbac) plus any back-to-back local runs blow
            // the cap and cascade-429. Same switch CI's audit server uses;
            // never set in production.
            ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
            // The general 600 req/min/IP limiter has the same problem at
            // suite scale: one SPA mount is ~40-50 API calls, and the full
            // suite peaks past the cap from a single runner IP (measured
            // 771/min), 429-ing unrelated specs. Same contract: test
            // harness only, never production.
            ROHY_DISABLE_GENERAL_RATE_LIMIT: '1',
            // Keep the operator's piper/llm config out of e2e — tests that
            // need TTS or LLM will mock at the network layer.
            PIPER_DISABLED: '1',
            // Oyon on, so the battery covers the signal capture learners actually
            // get (typing today, voice next). Without it /addons/oyon/* is the
            // disabled stub and every capture path is untestable. Typing needs no
            // models; the camera widget degrades to an error pill in headless
            // chromium, which has no camera — it must not break other specs.
            OYON_ENABLED: '1',
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
