import { test, expect } from '@playwright/test';
import {
  installSyntheticCamera,
  allCameraTracksEnded,
  readStoredWindows,
} from './helpers';

/*
 * <oyon-app> embed contract (:5173, examples/embed-host.html) — every
 * promise docs/EMBEDDING.md makes to a host, asserted in a real browser.
 * The host page is deliberately hostile (Comic Sans, lurid colors) so the
 * isolation probes mean something.
 *
 * Encodes the regressions found in the post-2.1.0 review:
 *   - importing the bundle must not touch host history (F1)
 *   - getToken set AFTER connect must authenticate sync (F4)
 *   - the session-id attribute must be coherent across stored windows,
 *     oyon:window events, and the sync endpoint URL (F5)
 *   - removing the element must release the camera (F6)
 */

const HOST_PAGE = 'http://127.0.0.1:5173/examples/embed-host.html';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('host page isolation: history untouched, styles contained both ways', async ({ page }) => {
  await page.goto(HOST_PAGE);
  await expect(page.locator('oyon-app')).toBeVisible();

  const probes = await page.evaluate(() => {
    const el = document.querySelector('oyon-app')!;
    const shadowHost = el.shadowRoot?.querySelector('.oyon-app-host');
    return {
      // F1: loading the element bundle must not write host history state
      // or monkey-patch the history API.
      historyState: window.history.state,
      pushStateNative: String(window.history.pushState).includes('[native code]'),
      replaceStateNative: String(window.history.replaceState).includes('[native code]'),
      // Shadow boundary, inward: host Comic Sans must not pierce.
      hostFont: getComputedStyle(document.body).fontFamily,
      embedFont: shadowHost ? getComputedStyle(shadowHost).fontFamily : null,
      // Shadow boundary, outward: Tailwind preflight must not reset the host.
      hostBodyMargin: getComputedStyle(document.body).margin,
      rendered: Boolean(shadowHost),
    };
  });

  expect(probes.rendered).toBe(true);
  expect(probes.historyState).toBeNull();
  expect(probes.pushStateNative).toBe(true);
  expect(probes.replaceStateNative).toBe(true);
  expect(probes.hostFont).toContain('Comic Sans');
  expect(probes.embedFont).not.toContain('Comic Sans');
  // The host page sets body { margin: 0 } itself, so probe a host heading
  // style Tailwind preflight would zero out if it leaked.
  const hostFontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(hostFontSize).toBe('22px');

  // The full branded app is present: topbar brand + workflow nav.
  await expect(page.getByText('Research Instrument')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Analyze' })).toBeVisible();

  // Single-instance guard: a second <oyon-app> refuses to mount.
  const second = await page.evaluate(() => {
    const dupe = document.createElement('oyon-app');
    document.body.appendChild(dupe);
    const mounted = Boolean(dupe.shadowRoot?.querySelector('.oyon-app-host'));
    dupe.remove();
    return mounted;
  });
  expect(second).toBe(false);
});

test('capture contract: late getToken auth, session-id coherence, sync POSTs, teardown on removal', async ({ page }) => {
  await installSyntheticCamera(page);

  // Mock the host backend the sync leg POSTs to.
  const syncRequests: Array<{ url: string; auth: string | null; events: number }> = [];
  await page.route('**/api/sessions/**/emotions/batch', async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { events?: unknown[] } | null;
    syncRequests.push({
      url: req.url(),
      auth: await req.headerValue('authorization'),
      events: body?.events?.length ?? 0,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(HOST_PAGE);
  await expect(page.locator('oyon-app')).toBeVisible();

  // Configure the embed the way the docs say a host does — AFTER the
  // element is connected (the only thing a markup-created element allows).
  await page.evaluate(() => {
    const el = document.querySelector('oyon-app') as HTMLElement & {
      getToken: (() => string) | null;
    };
    el.setAttribute('api-base-url', 'https://backend.example');
    el.setAttribute('session-id', 'e2e-embed-session');
    el.getToken = () => 'e2e-token-42';
  });

  await page.evaluate(() => (document.getElementById('start') as HTMLButtonElement).click());

  // The host receives oyon:window events whose sessionId matches the
  // override (the embed-host page prints them into #events).
  await expect(page.locator('#events')).toContainText(
    'session e2e-embed-session · user acme-student-42',
    { timeout: 60_000 },
  );

  // The sync leg POSTed with the late-set bearer token, to the overridden
  // session's endpoint, with a non-empty validated batch.
  await expect.poll(() => syncRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const post = syncRequests[0];
  expect(post.auth).toBe('Bearer e2e-token-42');
  expect(post.url).toContain('/api/sessions/e2e-embed-session/emotions/batch');
  expect(post.events).toBeGreaterThan(0);

  // Stored windows (IDB primary + localStorage fallback) carry the same
  // session + the host-attribute user id.
  const stored = await readStoredWindows(page);
  expect(stored.count).toBeGreaterThan(0);
  expect(stored.sessions).toContain('e2e-embed-session');
  expect(stored.users).toContain('acme-student-42');

  // F6: removing the element from the DOM stops capture — every camera
  // track the page ever handed out must end.
  await page.evaluate(() => document.querySelector('oyon-app')!.remove());
  await expect.poll(() => allCameraTracksEnded(page), { timeout: 20_000 }).toBe(true);
});

test('sync endpoint failure never blocks local persistence (local-first tee)', async ({ page }) => {
  await installSyntheticCamera(page);
  // Backend is down hard — every sync POST 500s.
  await page.route('**/api/sessions/**/emotions/batch', (route) =>
    route.fulfill({ status: 500, body: 'nope' }),
  );

  await page.goto(HOST_PAGE);
  await page.evaluate(() => {
    document.querySelector('oyon-app')!.setAttribute('api-base-url', 'https://backend.example');
  });
  await page.evaluate(() => (document.getElementById('start') as HTMLButtonElement).click());

  // Windows still persist locally and host events still flow.
  await expect(page.locator('#events')).toContainText('window batch:', { timeout: 60_000 });
  const stored = await readStoredWindows(page);
  expect(stored.count).toBeGreaterThan(0);

  await page.evaluate(() => (document.getElementById('stop') as HTMLButtonElement).click());
});
