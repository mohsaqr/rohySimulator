import { defineConfig } from '@playwright/test';

/*
 * E2E suite — real-browser regression coverage for the two delivery modes:
 *
 *   tests/e2e/standalone-app.spec.ts  → the React app shell (:5174)
 *   tests/e2e/embed-element.spec.ts   → <oyon-app> on a host page (:5173)
 *
 * Run with `npm run test:e2e` (builds the element bundle first via
 * globalSetup if missing). Capture tests use a synthetic canvas face
 * injected over getUserMedia (tests/e2e/helpers.ts) — no physical camera,
 * no fake-device flags. MediaPipe/ONNX assets load from the local
 * /standalone trees (app) or public CDNs (embed), so the first run needs
 * network access.
 *
 * Not part of `npm test` / prepublishOnly: this suite needs a Chromium
 * download (`npx playwright install chromium`) and live model assets.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Aggregate windows are 10 s; journeys capture several.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Repo-root server: serves examples/embed-host.html and the built
      // element at /standalone/app/dist-element/.
      command: 'npm run start',
      url: 'http://127.0.0.1:5173/examples/embed-host.html',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // The React app shell.
      command: 'npm --prefix standalone/app run dev -- --strictPort',
      url: 'http://127.0.0.1:5174/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
