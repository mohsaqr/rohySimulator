import { test, expect, type Page } from '@playwright/test';
import { installSyntheticCamera, allCameraTracksEnded } from './helpers';

/*
 * <oyon-app chrome="capture"> — the capture pill's language and accessibility
 * contract (v3.3.3), in a real browser against the BUILT element bundle.
 *
 *   - `lang` / `labels` re-render the pill text; unknown lang → English; bad
 *     labels JSON never breaks the element;
 *   - every control has an accessible name, icons are hidden from AT, the
 *     headline is a polite live region, unavailable controls are
 *     aria-disabled yet focusable;
 *   - keyboard focus draws the pill's own high-contrast ring;
 *   - switching `lang` MID-CAPTURE re-renders text without restarting the
 *     camera, the runtime or the session (Rohy keeps language out of its
 *     mount effect precisely so a language switch cannot tear capture down).
 *
 * The host page is synthesised on the root dev server's origin so the bundle
 * loads same-origin and no other real-runtime <oyon-app> competes for the
 * camera (examples/embed-host.html mounts a full-chrome one).
 */

const ROOT = process.env.OYON_E2E_ROOT_URL ?? 'http://127.0.0.1:5173';
const PILL_PAGE = `${ROOT}/__e2e__/pill-host.html`;

const HOST_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>pill host</title></head>
  <body style="background:#ffffff">
    <button id="before">host control before the pill</button>
    <div id="slot"></div>
    <script type="module" src="/standalone/app/dist-element/oyon-app.element.js"></script>
  </body>
</html>`;

async function openPillHost(page: Page, attrs: Record<string, string>): Promise<void> {
  await page.route(PILL_PAGE, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: HOST_HTML }),
  );
  await page.goto(PILL_PAGE);
  await page.waitForFunction(() => Boolean(customElements.get('oyon-app')));
  // Created the way Rohy creates it: attributes set BEFORE appendChild.
  await page.evaluate((a) => {
    const el = document.createElement('oyon-app');
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    const w = window as typeof window & { __statuses?: string[]; __warnings?: string[] };
    w.__statuses = [];
    el.addEventListener('oyon:status', (e) => {
      w.__statuses!.push(String((e as CustomEvent<{ state: string }>).detail.state));
    });
    document.getElementById('slot')!.appendChild(el);
  }, attrs);
}

const pill = (page: Page) => page.locator('oyon-app').getByRole('group');
const setAttr = (page: Page, name: string, value: string) =>
  page.evaluate(([n, v]) => document.querySelector('oyon-app')!.setAttribute(n, v), [name, value]);

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('pill speaks the host language, falls back safely and accepts label overrides', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openPillHost(page, { chrome: 'capture', lang: 'de-DE' });

  const group = pill(page);
  await expect(group).toHaveAttribute('aria-label', 'Oyon-Emotionserfassung');
  await expect(group).toHaveAttribute('lang', 'de');
  const status = page.locator('oyon-app').getByRole('status');
  await expect(status).toHaveText('Bereit');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(group.getByRole('button', { name: 'Erfassung starten', exact: true })).toBeVisible();

  // Live switch to another table.
  await setAttr(page, 'lang', 'fr');
  await expect(status).toHaveText('Prêt');
  await expect(group.getByRole('button', { name: 'Démarrer la capture', exact: true })).toBeVisible();

  // Kazakh (Cyrillic) is served too.
  await setAttr(page, 'lang', 'kk-KZ');
  await expect(status).toHaveText('Дайын');

  // Unknown language → English, with a warning, never an error.
  await setAttr(page, 'lang', 'xx-YY');
  await expect(status).toHaveText('Ready');
  await expect(group).toHaveAttribute('lang', 'en');
  await expect.poll(() => warnings.some((w) => w.includes('lang="xx-YY"'))).toBe(true);

  // Host overrides win over the table; unknown keys are dropped.
  await setAttr(page, 'lang', 'sv');
  await setAttr(page, 'labels', JSON.stringify({ ready: 'Klar att börja', bogus: 'x' }));
  await expect(status).toHaveText('Klar att börja');
  await expect(group.getByRole('button', { name: 'Starta registrering', exact: true })).toBeVisible();
  await expect.poll(() => warnings.some((w) => w.includes('unknown `labels` key "bogus"'))).toBe(true);

  // Malformed JSON falls back to the built-in table without throwing.
  await setAttr(page, 'labels', '{not json');
  await expect(status).toHaveText('Redo');
  expect(pageErrors).toEqual([]);
});

test('every pill control is named, icons are hidden, unavailable controls stay reachable, focus is visible', async ({ page }) => {
  await openPillHost(page, { chrome: 'capture', lang: 'en' });
  const group = pill(page);
  await expect(page.locator('oyon-app').getByRole('status')).toHaveText('Ready');

  const buttons = group.getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(2); // Start + analytics while idle
  for (let i = 0; i < count; i += 1) {
    const b = buttons.nth(i);
    const label = await b.getAttribute('aria-label');
    expect(label?.trim(), `button ${i} has an accessible name`).toBeTruthy();
    expect(await b.getAttribute('title'), `button ${i} keeps its tooltip`).toBeTruthy();
    const svgs = b.locator('svg');
    for (let j = 0; j < (await svgs.count()); j += 1) {
      await expect(svgs.nth(j)).toHaveAttribute('aria-hidden', 'true');
    }
  }

  // ↗ before any session: unavailable, announced as such, still focusable.
  const analytics = group.getByRole('button', {
    name: 'Start capture before opening session analytics',
  });
  await expect(analytics).toHaveAttribute('aria-disabled', 'true');
  await expect(analytics).toBeDisabled(); // Playwright honours aria-disabled
  expect(await analytics.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);

  // Keyboard: Tab from the host button lands on the pill's Start control and
  // draws the pill ring (light cyan outline + dark halo), not the global blue.
  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  const start = group.getByRole('button', { name: 'Start capture', exact: true });
  await expect(start).toBeFocused();
  const ring = await start.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
    };
  });
  expect(ring.focusVisible).toBe(true);
  expect(ring.outlineStyle).toBe('solid');
  expect(ring.outlineWidth).toBe('2px');
  expect(ring.outlineColor).toBe('rgb(165, 243, 252)');
  expect(ring.outlineOffset).toBe('2px');
  expect(ring.boxShadow).toContain('6px');

  // The aria-disabled analytics control is next in the tab order.
  await page.keyboard.press('Tab');
  await expect(analytics).toBeFocused();
  // Activating it does nothing (no host event without a session).
  await page.evaluate(() => {
    const w = window as typeof window & { __opened?: boolean };
    w.__opened = false;
    document.querySelector('oyon-app')!.addEventListener('oyon:open-analytics', () => {
      w.__opened = true;
    });
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as typeof window & { __opened?: boolean }).__opened)).toBe(false);
});

test('switching lang mid-capture re-renders text without restarting the camera, runtime or session', async ({ page }) => {
  await installSyntheticCamera(page);
  await openPillHost(page, {
    chrome: 'capture',
    lang: 'de',
    'session-id': 'e2e-pill-session',
    'gaze-engine': 'mediapipe',
  });
  const group = pill(page);
  const status = page.locator('oyon-app').getByRole('status');

  await group.getByRole('button', { name: 'Erfassung starten', exact: true }).click();
  // Live: the stable SR status is "Erfassung läuft" (the visible emotion
  // word is aria-hidden), and Pause/Stop are offered in German.
  await expect(status).toHaveText(/Erfassung läuft/, { timeout: 60_000 });
  await expect(group.getByRole('button', { name: 'Erfassung beenden', exact: true })).toBeVisible();

  const before = await page.evaluate(() => {
    const el = document.querySelector('oyon-app') as HTMLElement & {
      bridge: { getState(): { controls: unknown } };
    };
    const w = window as typeof window & {
      __oyonStreams?: MediaStream[];
      __controlsBefore?: unknown;
      __statuses?: string[];
    };
    w.__controlsBefore = el.bridge.getState().controls;
    return {
      streams: w.__oyonStreams?.length ?? 0,
      statuses: w.__statuses?.length ?? 0,
      hasControls: w.__controlsBefore != null,
    };
  });
  expect(before.streams).toBe(1);
  expect(before.hasControls).toBe(true);

  // The language switch, plus a labels change, mid-capture.
  await setAttr(page, 'lang', 'sv');
  await setAttr(page, 'labels', JSON.stringify({ stopCapture: 'Avsluta mätningen' }));
  await expect(status).toHaveText(/Registrering pågår/);
  await expect(group.getByRole('button', { name: 'Avsluta mätningen', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Pausa registreringen', exact: true })).toBeVisible();
  await page.waitForTimeout(1_500);

  const after = await page.evaluate(() => {
    const el = document.querySelector('oyon-app') as HTMLElement & {
      bridge: { getState(): { controls: unknown } };
    };
    const w = window as typeof window & {
      __oyonStreams?: MediaStream[];
      __controlsBefore?: unknown;
      __statuses?: string[];
    };
    const streams = w.__oyonStreams ?? [];
    return {
      streams: streams.length,
      allLive: streams.every((s) => s.getTracks().every((t) => t.readyState === 'live')),
      sameControls: el.bridge.getState().controls === w.__controlsBefore,
      statusesSince: (w.__statuses ?? []).slice(),
    };
  });
  // No new getUserMedia call, the camera track never ended, and the
  // runtime's registered controls are the SAME object (RuntimeProvider was
  // not remounted, the runtime not recreated).
  expect(after.streams).toBe(before.streams);
  expect(after.allLive).toBe(true);
  expect(after.sameControls).toBe(true);
  const newStatuses = after.statusesSince.slice(before.statuses);
  expect(newStatuses.filter((s) => s !== 'running'),
    `no lifecycle transition after the lang switch (saw ${JSON.stringify(newStatuses)})`).toEqual([]);

  // Stop still works in the new language and releases the camera.
  await group.getByRole('button', { name: 'Avsluta mätningen', exact: true }).click();
  await expect(status).toHaveText('Redo', { timeout: 20_000 });
  await expect.poll(() => allCameraTracksEnded(page), { timeout: 15_000 }).toBe(true);
});
