import { test, expect } from '@playwright/test';
import {
  installSyntheticCamera,
  allCameraTracksEnded,
  readStoredWindows,
  seedStoredWindows,
  makeWindow,
} from './helpers';

/*
 * Standalone app shell (:5174) — the journeys a researcher actually runs.
 *
 * Test 1 captures REAL windows: synthetic face → MediaPipe → ONNX →
 * aggregation → IndexedDB, including identity stamping and a stop/start
 * restart (each capture = its own session). Slow (~1 min) by nature: the
 * aggregate window is 10 s.
 *
 * Test 2 seeds deterministic multi-session / multi-user data through the
 * localStorage read leg and exercises the FilterBar + dashboards without
 * waiting on capture.
 */

const APP = 'http://127.0.0.1:5174';

test.beforeEach(async ({ page }) => {
  // WebGazer (the app's default gaze engine) alert()s on plain-HTTP pages;
  // never let a modal hang the run.
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('capture journey: identity stamped, windows persisted, restart = new session', async ({ page }) => {
  await installSyntheticCamera(page);
  await page.goto(`${APP}/live`);

  // Set the participant identity through the TopBar pill.
  await page.getByRole('button', { name: /^Participant/ }).click();
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

test('FilterBar scopes dashboards by user and session over seeded data', async ({ page }) => {
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

  await page.getByRole('link', { name: 'Analyze' }).click();

  // All five windows visible under the default 'All' scope.
  await expect(page.getByText('5 / 5 windows')).toBeVisible();

  // 'Current' is disabled — no live capture session exists.
  await expect(
    page.getByRole('group', { name: 'Window scope' }).getByRole('button', { name: 'Current' }),
  ).toBeDisabled();

  // Narrow to user alice → 3 of 5.
  await page.getByRole('button', { name: /^Users/ }).click();
  await page.getByRole('checkbox').first().check();
  await expect(page.getByText('3 / 5 windows')).toBeVisible();

  // Reset, then narrow to session s2 → 2 of 5.
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByText('5 / 5 windows')).toBeVisible();
  await page.getByRole('button', { name: /^Sessions/ }).click();
  const s2Option = page.locator('label', { hasText: 's2' }).first();
  await s2Option.getByRole('checkbox').check();
  await expect(page.getByText('2 / 5 windows')).toBeVisible();

  // The sequence dashboard renders its TNA panels from the filtered set.
  // (Tab relabeled "Emotion dynamics"; route id stays /analyze/sequence.)
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('tab', { name: 'Emotion dynamics' }).click();
  await expect(page.getByRole('heading', { name: 'Transition network' })).toBeVisible();

  // Sessions page lists both seeded sessions and exports a JSON bundle.
  await page.getByRole('link', { name: 'Sessions' }).click();
  await expect(page.getByText('s1', { exact: false }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export bundle for/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
});
