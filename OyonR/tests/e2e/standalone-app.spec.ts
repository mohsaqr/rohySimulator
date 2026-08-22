import { test, expect } from '@playwright/test';
import {
  installSyntheticCamera,
  allCameraTracksEnded,
  readStoredWindows,
  seedStoredWindows,
  makeWindow,
} from './helpers';
import { OYON_VERSION } from '../../src/version.js';

/*
 * Standalone app shell (:5174) — the journeys a researcher actually runs.
 *
 * Test 1 captures REAL windows: synthetic face → MediaPipe → ONNX →
 * aggregation → IndexedDB, including identity stamping and a stop/start
 * restart (each capture = its own session). Slow (~1 min) by nature: the
 * aggregate window is 10 s.
 *
 * Test 2 seeds deterministic multi-session / multi-user data through the
 * localStorage read leg and exercises the Scope popover + dashboards without
 * waiting on capture.
 */

const APP = process.env.OYON_E2E_APP_URL ?? 'http://127.0.0.1:5174';

test.beforeEach(async ({ page }) => {
  // Never let an unexpected third-party modal hang the browser journey.
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('capture journey: identity stamped, windows persisted, restart = new session', async ({ page }) => {
  await installSyntheticCamera(page);
  await page.goto(`${APP}/live`);

  // Set the participant identity through the Session provenance popover.
  await page.getByRole('button', { name: 'Session', exact: true }).click();
  await page.getByLabel('User ID').fill('e2e-user');
  await page.getByRole('button', { name: 'Apply' }).click();

  const dock = page.getByRole('complementary', { name: 'Camera dock' });
  await dock.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dock.getByText('running')).toBeVisible({ timeout: 60_000 });

  // First aggregate window lands after ~10 s.
  await expect
    .poll(async () => (await readStoredWindows(page)).count, { timeout: 45_000 })
    .toBeGreaterThan(0);

  const first = await readStoredWindows(page);
  expect(first.users).toContain('e2e-user');
  expect(first.sessions.length).toBe(1);
  expect(String(first.last?.dominant_emotion ?? '')).not.toBe('');

  // Stop releases the camera (every minted track must end).
  await dock.getByRole('button', { name: 'Stop' }).click();
  await expect(dock.getByText('stopped')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => allCameraTracksEnded(page), { timeout: 15_000 }).toBe(true);

  // Restart: capture works again and produces a NEW session id.
  await dock.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dock.getByText('running')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await readStoredWindows(page)).sessions.length, { timeout: 45_000 })
    .toBe(2);

  await dock.getByRole('button', { name: 'Stop' }).click();
  await expect(dock.getByText('stopped')).toBeVisible({ timeout: 20_000 });
});

test('Scope popover filters dashboards by user and session over seeded data', async ({ page }) => {
  await page.goto(`${APP}/live`);
  const now = Date.now();
  await seedStoredWindows(page, [
    makeWindow({ session: 's1', user: 'alice', emotion: 'happy', endMs: now - 50_000 }),
    makeWindow({ session: 's1', user: 'alice', emotion: 'neutral', endMs: now - 40_000 }),
    makeWindow({ session: 's1', user: 'alice', emotion: 'happy', endMs: now - 30_000 }),
    makeWindow({ session: 's2', user: 'bob', emotion: 'sad', endMs: now - 20_000 }),
    makeWindow({ session: 's2', user: 'bob', emotion: 'sad', endMs: now - 10_000 }),
  ]);
  await page.reload();

  await page.getByRole('link', { name: 'Analytics' }).click();

  // All five windows visible under the default 'All' scope.
  const scope = page.getByRole('button', { name: 'Scope and filters' });
  await expect(scope).toContainText('5 windows');
  await scope.click();

  // Current/Past is intentionally absent when no live capture session exists.
  await expect(page.getByRole('group', { name: 'Window scope' })).toHaveCount(0);

  // Narrow to user alice → 3 of 5.
  await page.getByRole('button', { name: /^Users/ }).click();
  await page.getByRole('checkbox').first().check();
  await expect(scope).toContainText('3 / 5 windows');

  // Reset, then narrow to session s2 → 2 of 5.
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(scope).toContainText('5 windows');
  await page.getByRole('button', { name: /^Sessions/ }).click();
  const s2Option = page.locator('label', { hasText: 's2' }).first();
  await s2Option.getByRole('checkbox').check();
  await expect(scope).toContainText('2 / 5 windows');

  // The sequence dashboard renders its TNA panels from the filtered set.
  // The route id remains /analyze/sequence.
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('link', { name: 'Dynamics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transition network' })).toBeVisible();

  // Sessions page lists both seeded sessions and exports a JSON bundle.
  await page.getByRole('link', { name: 'Sessions' }).click();
  await expect(page.getByText('s1', { exact: false }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export bundle for/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
});

test('About identifies the pinned release, LACARM ecosystem, and Carm license', async ({ page }) => {
  await page.goto(`${APP}/about`);

  await expect(page.getByRole('heading', { name: 'About Oyon' })).toBeVisible();
  await expect(page.getByText('LACARM ecosystem', { exact: true })).toBeVisible();
  await expect(page.getByText(`v${OYON_VERSION}`, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Carm Research License v1.4' }),
  ).toBeVisible();
  await expect(page.locator('pre').first()).toContainText(
    'Copyright (c) 2025–2026 Professor Mohammed Saqr, PhD',
  );
  await expect(page.locator('pre').first()).toContainText(
    'PAID LICENSE REQUIRED',
  );
});

test('About embeds full third-party license texts, including the GPL', async ({ page }) => {
  await page.goto(`${APP}/about`);

  // The copyleft engine must be findable and flagged — an integrator shipping
  // Oyon into a proprietary host needs to see this without reading NOTICE.md.
  const webgazer = page.locator('details', { hasText: 'WebGazer.js' }).first();
  await expect(webgazer).toBeVisible();
  await expect(webgazer).toContainText('GPL-3.0-or-later');
  await expect(webgazer).toContainText('copyleft');

  // WebGazer's own notice says "You should have received a copy of the GNU
  // General Public License along with this program" — so the FULL text has to
  // be here, not just the notice, or that sentence is false.
  await webgazer.locator('summary').click();
  await expect(webgazer.locator('pre')).toContainText('GNU GENERAL PUBLIC LICENSE');
  await expect(webgazer.locator('pre')).toContainText('TERMS AND CONDITIONS');

  for (const name of [
    'ONNX Runtime Web',
    'MediaPipe',
    'Silero VAD',
    'WebEyeTrack',
  ]) {
    await expect(page.locator('details', { hasText: name }).first()).toBeVisible();
  }

  // Vendored first-party code has no separate licence panel — the Carm licence
  // above covers it — but it must still be NAMED, or shipping it and shipping
  // nothing look identical to a reader.
  await expect(page.getByText('Vendored Carm ecosystem code:')).toBeVisible();
  await expect(page.getByText('standalone/vendor/ladyna')).toBeVisible();
});
