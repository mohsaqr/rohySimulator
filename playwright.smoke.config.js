// Playwright config for the DEPLOYED smoke battery.
//
//   scripts/smoke-deployed.sh https://rohy.lacarm.com
//
// This is the half of the battery that runs against a real, already-running
// instance — after `bin/rohy-update apply`, after a deploy, or on demand — and
// reports the result to Prova against the build that instance is actually
// serving. It is how an upgrade gets verified and recorded rather than just
// eyeballed.
//
// It is deliberately NOT the e2e suite:
//
//   - No `webServer`. The instance under test already exists; this config never
//     spawns a server and never mints a database.
//   - Every check is READ-ONLY and unauthenticated. It never logs in, never
//     writes, and never touches case or learner data. That is what makes it safe
//     to point at production — which the e2e suite is not, and must never be.
//   - The build is read from the TARGET's /api/health by scripts/smoke-deployed.sh,
//     which exports PROVA_BUILD_VERSION before invoking Playwright. Without that,
//     the Prova reporter would read the local package.json and label a remote
//     deployment with whatever version this working copy happens to be on.
//
// Suite name is `smoke`, so Prova check keys read
//   rohy:smoke::deployed.spec.js › deployed smoke › …
// and never collide with the e2e suite's `chromium` keys.

import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET = process.env.ROHY_SMOKE_URL;
if (!TARGET) {
    throw new Error(
        'ROHY_SMOKE_URL is not set — the deployed smoke needs the instance to test, '
        + 'e.g. ROHY_SMOKE_URL=https://rohy.lacarm.com. Use scripts/smoke-deployed.sh, '
        + 'which also reads the build from that instance.',
    );
}

// Same rule as the e2e config: Prova ships the reporter, we never write another,
// and it is attached only when the sibling checkout is present. Without
// PROVA_URL + PROVA_TOKEN the reporter does nothing, so a bare smoke run is
// simply a smoke run.
const PROVA_REPORTER = process.env.PROVA_REPORTER
    || path.resolve(__dirname, '../prova/reporters/playwright.mjs');
const provaReporter = fs.existsSync(PROVA_REPORTER)
    ? [[PROVA_REPORTER, { product: 'rohy' }]]
    : [];

export default defineConfig({
    testDir: './tests/smoke',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    // A deployed target is across a network; one retry absorbs a dropped
    // connection without hiding a real outage (a real outage fails twice).
    retries: 1,
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: [
        ['list'],
        ['junit', { outputFile: 'test-results.smoke.junit.xml' }],
        ...provaReporter,
    ],
    use: {
        // MUST end in a slash, and every path in tests/smoke/ MUST be relative.
        // The deploy hub verifies path-prefixed targets (https://host/rohy), and
        // `new URL('/api/health', 'https://host/rohy')` resolves to https://host/api/health —
        // the prefix is silently dropped and the smoke checks the wrong application.
        // With the trailing slash, `new URL('api/health', base)` keeps it.
        baseURL: TARGET.endsWith('/') ? TARGET : `${TARGET}/`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        // A self-signed certificate is normal for an internal deploy target;
        // the same allowance the deploy hub's verifier makes (ROHY_INSECURE).
        ignoreHTTPSErrors: process.env.ROHY_INSECURE !== '0',
    },
    projects: [
        {
            name: 'smoke',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
