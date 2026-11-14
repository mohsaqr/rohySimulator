import { test, expect } from '@playwright/test';
import { installSyntheticCamera } from './helpers';

/*
 * Live heart-rate card (:5174) in a real browser.
 *
 * The synthetic camera face pulses its skin colour at 72 bpm, so the full
 * path runs: canvas → getUserMedia → MediaPipe face → ROI colour sampler →
 * rPPG estimator → Live card. Asserts the terse footer (no explanatory
 * sentences, no header status pill) and a reading near the injected rate.
 */

const APP = process.env.OYON_E2E_APP_URL ?? 'http://127.0.0.1:5174';
const PULSE_BPM = 72;

// Headless Chromium throttles frame callbacks for a non-visible page (the ROI
// sampler measured 1.9 Hz); rPPG needs ≥ 8 Hz, so disable the throttling.
test.use({
  // Installed Google Chrome in headless mode renders video frames like a
  // visible window; Playwright's headless shell delivered only ~2–3 Hz.
  channel: 'chrome',
  launchOptions: {
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  },
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('heart-rate card: terse footer, no header pill, reading near the injected pulse', async ({ page }) => {
  await installSyntheticCamera(page, { pulseBpm: PULSE_BPM });
  // Enable heart rate through the app's persisted settings (zustand merges
  // this partial state over the defaults).
  await page.addInitScript(() => {
    localStorage.setItem('oyon-app-settings', JSON.stringify({ state: { heart_rate_enabled: true }, version: 3 }));
  });
  await page.goto(`${APP}/live`);

  const dock = page.getByRole('complementary', { name: 'Camera dock' });
  await dock.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dock.getByText('running')).toBeVisible({ timeout: 60_000 });

  // The card is the one whose title is "Heart rate & breathing".
  const card = page.locator('div', { has: page.getByText('Heart rate & breathing', { exact: true }) })
    .filter({ hasText: 'bpm' }).last();

  // Footer appears once a reading exists (≥ 8 s of signal).
  const footer = page.getByText(/^\d+ s window · POS/);
  await expect(footer).toBeVisible({ timeout: 60_000 });

  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text).not.toContain('Heart rate is a frequency');
  expect(text).not.toContain('Integrated over');
  expect(text).not.toContain('anchor trails');
  // No status pill in the card header: the title is followed directly by the
  // reading. (The breathing line further down may legitimately say "acquiring".)
  expect(text.toLowerCase()).toMatch(/^heart rate & breathing \d{2,3}\s*bpm/);

  // The headline reading tracks the injected pulse (poll: it updates ~1 Hz).
  await expect.poll(async () => {
    const m = (await card.innerText()).match(/(\d{2,3})\s*bpm/);
    return m ? Math.abs(Number(m[1]) - PULSE_BPM) : Infinity;
  }, { timeout: 45_000 }).toBeLessThanOrEqual(6);

  await dock.getByRole('button', { name: 'Stop' }).click();
  await expect(dock.getByText('stopped')).toBeVisible({ timeout: 20_000 });
});
