import { test, expect, type Page } from '@playwright/test';
import { makeWindow, seedStoredWindows } from './helpers';

/*
 * Host scopes (:5173, examples/document-editor-host.html) — the promises of
 * docs/HOST_SCOPES.md asserted in a real browser, on a host that is not a
 * chat application: a plain document editor with a contenteditable.
 *
 *   - three calls (capture, store, view) take typing from the editor to the
 *     typing dashboard, with no camera and no text crossing the boundary;
 *   - feed isolation: while setRecords() is set nothing from the local store
 *     is drawn, and after setRecords(null) nothing that was fed is readable
 *     in IndexedDB or localStorage;
 *   - scope boundary: a session embed fed three people draws one session; a
 *     group embed with no feed draws nothing and says why;
 *   - the group view lists one row per person.
 */

const HOST_PAGE = `${process.env.OYON_E2E_ROOT_URL ?? 'http://127.0.0.1:5173'}/examples/document-editor-host.html`;
const FED_MARKER = 'fed-marker';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

/** Build typing-v3 episodes for several people in the page, with the real aggregator. */
async function fedRecords(page: Page, people: Array<{ user: string; session: string; graphemes: number }>) {
  return page.evaluate(async ({ people, marker }) => {
    const { TypingAggregator } = await import('/src/aggregation/TypingAggregator.js');
    const { createTypingEditReporter } = await import('/src/capture/TypingEditReporter.js');
    const signalWindows: Array<Record<string, unknown>> = [];
    const signalEvents: Array<Record<string, unknown>> = [];
    const windows: Array<Record<string, unknown>> = [];
    people.forEach((person, personIndex) => {
      let t = 0;
      let sequence = 0;
      const wall = () => Date.parse('2026-03-02T10:00:00.000Z') + personIndex * 3_600_000 + t;
      const identity = {
        session_id: person.session,
        user_id: person.user,
        user_label: `${marker} ${person.user}`,
        group_id: 'seminar-a',
        context_id: 'document-1',
      };
      const reporter = createTypingEditReporter({
        aggregator: new TypingAggregator({
          now: wall,
          onEvent: (event: Record<string, unknown>) =>
            signalEvents.push({
              ...event,
              ...identity,
              event_id: `${person.user}-${sequence}`,
              capture_id: `cap-${person.user}`,
              sequence_index: sequence++,
              state_vocabulary: 'typing-states-v1',
            }),
        }),
        targetId: 'notebook',
        now: () => t,
        wallClockNow: wall,
        onWindow: (window: Record<string, unknown>) =>
          signalWindows.push({ ...window, ...identity, window_id: `win-${person.user}` }),
      });
      reporter.start({ graphemes: 0, words: 0 });
      for (let i = 1; i <= person.graphemes; i += 1) {
        t += 150;
        reporter.reportEdit({
          inputType: 'insertText',
          graphemesBefore: i - 1,
          graphemesAfter: i,
          wordsBefore: Math.floor((i - 1) / 5),
          wordsAfter: Math.floor(i / 5),
          caretOffset: i,
          boundaryContext: 'word_boundary',
        });
      }
      t += 500;
      reporter.submit();
      windows.push({
        ...identity,
        window_start: new Date(wall() - 10_000).toISOString(),
        window_end: new Date(wall()).toISOString(),
        dominant_emotion: 'neutral',
        probabilities: { neutral: 1 },
        confidence: 1,
        valid_frames: 10,
      });
    });
    return { windows, signalWindows, signalEvents };
  }, { people, marker: FED_MARKER });
}

const THREE_PEOPLE = [
  { user: 'writer-1', session: 'notebook-session-1', graphemes: 40 },
  { user: 'writer-2', session: 'notebook-session-2', graphemes: 20 },
  { user: 'writer-3', session: 'notebook-session-3', graphemes: 20 },
];

async function feed(page: Page, records: unknown) {
  await page.evaluate((fed) => {
    (document.getElementById('viewer') as HTMLElement & { setRecords(r: unknown): void }).setRecords(fed);
  }, records);
}

test('three calls on a document editor: capture, store, view', async ({ page }) => {
  await page.goto(HOST_PAGE);
  const viewer = page.locator('oyon-app');
  await expect(viewer).toBeVisible();

  const secret = 'Quokkas nap at noon. They wake hungry.';
  await page.locator('#editor').click();
  await page.locator('#editor').pressSequentially(secret, { delay: 15 });
  await page.locator('#save').click();

  // View: the dashboard opens on its Overview, listing the session it was fed.
  await expect(viewer.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(viewer.getByRole('cell', { name: 'notebook-session-1' })).toBeVisible();
  // …and the typing dashboard drew the saved episode, at person scope.
  await viewer.getByRole('tab', { name: 'Typing' }).click();
  await expect(viewer.getByText('Typing episodes')).toBeVisible();
  await expect(viewer.getByText('1 total · 1 submitted · 0 abandoned')).toBeVisible();
  await expect(viewer.getByText('Person', { exact: true })).toBeVisible();
  await expect(viewer.getByText('Writer One', { exact: true })).toBeVisible();
  await expect(viewer.getByText('Sessions and days')).toBeVisible();
  await expect(page.locator('#counts')).toContainText('records shown');

  // Store: what the host holds is a typing-v3 window with identity, and the
  // writing itself is nowhere in it.
  const stored = await page.evaluate(() => (window as unknown as { __notebook: { stored: unknown } }).__notebook.stored);
  const { signalWindows, signalEvents } = stored as {
    signalWindows: Array<Record<string, any>>;
    signalEvents: Array<Record<string, any>>;
  };
  expect(signalWindows).toHaveLength(1);
  expect(signalWindows[0].feature_profile).toBe('typing-v3');
  expect(signalWindows[0].typing.committed_graphemes).toBe(secret.length);
  expect(signalWindows[0].target).toEqual({ kind: 'document_editor', id: 'notebook' });
  expect(signalWindows[0]).toMatchObject({
    session_id: 'notebook-session-1',
    user_id: 'writer-1',
    user_label: 'Writer One',
    group_id: 'seminar-a',
    context_id: 'document-1',
  });
  expect(signalEvents.length).toBeGreaterThan(secret.length);
  const serialized = JSON.stringify(stored);
  for (const word of ['Quokkas', 'noon', 'hungry']) expect(serialized).not.toContain(word);

  // The close control reports to the host and does nothing else.
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#status')).toHaveText('Analytics closed.');
});

test('feed isolation: the local store is not drawn, and the feed leaves no copy behind', async ({ page }) => {
  await page.goto(HOST_PAGE);
  // Three windows already in this browser's local store, same session.
  const local = [0, 1, 2].map((i) =>
    makeWindow({
      session: 'notebook-session-1',
      user: 'writer-1',
      emotion: 'happy',
      endMs: Date.parse('2026-03-01T09:00:00.000Z') + i * 10_000,
    }),
  );
  await seedStoredWindows(page, local);
  await page.reload();
  const viewer = page.locator('oyon-app');
  await page.evaluate(() => {
    const el = document.getElementById('viewer')!;
    el.setAttribute('scope', 'session');
    el.setAttribute('page', '/analyze/logs');
  });
  // No feed: a session embed draws its local windows, as in 3.5.
  await expect(viewer.getByText('3 windows')).toBeVisible();

  // Feed ONE person's records: only they are drawn.
  const fed = await fedRecords(page, [THREE_PEOPLE[0]]);
  await feed(page, fed);
  await expect(viewer.getByText(/1 session · 1 person · \d+ records/)).toBeVisible();
  await expect(viewer.getByText('3 windows')).toHaveCount(0);

  // Clear the feed: back to the local store, untouched.
  await feed(page, null);
  await expect(viewer.getByText('3 windows')).toBeVisible();

  const leftovers = await page.evaluate(async (marker) => {
    const found: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)!;
      if ((localStorage.getItem(key) ?? '').includes(marker)) found.push(`localStorage:${key}`);
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)!;
      if ((sessionStorage.getItem(key) ?? '').includes(marker)) found.push(`sessionStorage:${key}`);
    }
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of [...db.objectStoreNames]) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (JSON.stringify(rows).includes(marker)) found.push(`indexedDB:${info.name}/${storeName}`);
      }
      db.close();
    }
    return {
      found,
      localWindows: JSON.parse(localStorage.getItem('oyon-app-windows') ?? '[]').length,
    };
  }, FED_MARKER);
  expect(leftovers.found, 'nothing that was fed may remain in browser storage').toEqual([]);
  expect(leftovers.localWindows, 'the local store is exactly what it was').toBe(3);
});

test('scope boundary: session draws one session; group without a feed says why', async ({ page }) => {
  await page.goto(HOST_PAGE);
  const viewer = page.locator('oyon-app');
  await page.evaluate(() => {
    const el = document.getElementById('viewer')!;
    el.setAttribute('scope', 'session');
    el.setAttribute('page', '/analyze/typing');
  });

  const fed = await fedRecords(page, THREE_PEOPLE);
  await feed(page, fed);
  // Fed three people; this embed is bound to notebook-session-1.
  await expect(viewer.getByText(/1 session · 1 person · \d+ records/)).toBeVisible();
  await expect(viewer.getByText('1 total · 1 submitted · 0 abandoned')).toBeVisible();
  await expect(viewer.getByText(`${FED_MARKER} writer-2`)).toHaveCount(0);

  // A refused record is reported, not fatal.
  const report = await page.evaluate((good) => new Promise((resolve) => {
    const el = document.getElementById('viewer') as HTMLElement & { setRecords(r: unknown): void };
    el.addEventListener('oyon:records', (event) => resolve((event as CustomEvent).detail), { once: true });
    el.setRecords({ ...(good as object), signalEvents: [{ modality: 'typing', state: 'teleport', sequence_index: 0 }] });
  }), fed);
  expect(report).toMatchObject({
    accepted: { windows: 3, signalWindows: 3, signalEvents: 0 },
    refused: { total: 1, signalEvents: 1 },
    reasons: [{ kind: 'signalEvents', index: 0 }],
  });

  // Group scope with NO feed: nothing drawn, and the view says why.
  await feed(page, null);
  await page.evaluate(() => document.getElementById('viewer')!.setAttribute('scope', 'group'));
  await expect(viewer.getByText('No group records yet')).toBeVisible();
  await expect(viewer.getByText(/does not read this browser/)).toBeVisible();
  await expect(viewer.getByText('No records from the host')).toBeVisible();
});

test('group scope: one row per person and a two-person comparison', async ({ page }) => {
  await page.goto(HOST_PAGE);
  const viewer = page.locator('oyon-app');
  await page.evaluate(() => document.getElementById('viewer')!.setAttribute('scope', 'group'));
  await feed(page, await fedRecords(page, THREE_PEOPLE));

  // The Overview lists every person and every session, across all signals.
  await page.evaluate(() => document.getElementById('viewer')!.setAttribute('page', '/overview'));
  await viewer.getByRole('button', { name: /^View by/ }).click();
  await viewer.getByRole('option', { name: /^Sessions/ }).click();
  for (const person of THREE_PEOPLE) {
    await expect(viewer.getByRole('cell', { name: person.session, exact: true })).toBeVisible();
  }
  await viewer.getByRole('button', { name: /^View by/ }).click();
  await viewer.getByRole('option', { name: /^People/ }).click();
  await expect(viewer.getByRole('checkbox', { name: /^Show only person/ })).toHaveCount(3);
  await page.evaluate(() => document.getElementById('viewer')!.setAttribute('page', '/analyze/typing'));

  await expect(viewer.getByText(/3 sessions · 3 people · \d+ records/)).toBeVisible();
  const people = viewer.locator('#typ-people');
  for (const person of THREE_PEOPLE) {
    await expect(people.getByRole('cell', { name: `${FED_MARKER} ${person.user}`, exact: true })).toBeVisible();
  }
  // writer-1 committed 40 of the group's 80 graphemes.
  await expect(people.getByRole('row', { name: new RegExp(`${FED_MARKER} writer-1`) })).toContainText('50%');
  await expect(people.getByText('Compare two people')).toBeVisible();

  // The Person drop-down in the top bar narrows the whole dashboard.
  await viewer.getByRole('button', { name: 'Person: All' }).click();
  await viewer.getByRole('option', { name: new RegExp(`${FED_MARKER} writer-2`) }).click();
  await expect(viewer.getByText(/1 session · 1 person · \d+ records/)).toBeVisible();
  await viewer.getByRole('option', { name: /^All people/ }).click();
  await expect(viewer.getByText(/3 sessions · 3 people · \d+ records/)).toBeVisible();
});
