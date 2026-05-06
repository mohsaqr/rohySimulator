# End-to-end tests (Playwright)

This directory contains the Playwright-driven end-to-end suite for
rohySimulator. Whereas Vitest covers unit + component logic in isolation
(jsdom for client, node for server), Playwright drives a real Chromium
against a real Express server backed by a throwaway sqlite database.

## Layered test pyramid

| Layer        | Runner   | Where           | What it covers                                |
| ------------ | -------- | --------------- | --------------------------------------------- |
| Unit         | Vitest   | `tests/server`, co-located `.test.js` | Pure functions, services, helpers |
| Component    | Vitest   | `src/**/*.test.jsx` | React components in jsdom, no real network |
| **E2E**      | **Playwright** | **`tests/e2e/`** | **Real browser → real server → real sqlite** |

If a regression is reproducible at the unit or component layer, prefer to
test it there. Reach for e2e when the bug only shows up across the
client/server boundary, in real auth flows, or with real navigation.

## Running

```bash
# First time on a machine: install Chromium browser binary.
npm run test:e2e:install

# Run the full suite (headless Chromium, list + html + junit reporters).
npm run test:e2e

# Run with the Playwright UI (great for debugging).
npm run test:e2e:ui

# Run a single spec.
npx playwright test tests/e2e/canary.spec.js
```

`npm run test:e2e` requires that `frontend/` contains the built SPA
(`server/server.js` serves the static files from there).

**Important — build with `base=/` for e2e**:

The default `npm run build` script bakes in `--base=/rohy/` because the
production deployment sits behind a reverse proxy that strips that
prefix. The e2e harness talks directly to Express on port 4811, so
asset paths need to be at `/` instead. Run:

```bash
npx vite build --base=/ && rm -rf frontend && mkdir -p frontend && cp -r dist/* frontend/
```

once before invoking `test:e2e`. If you forget, the SPA shell will load
but every JS chunk will 404 and Playwright will time out on the first
visible-element assertion. The CI job does this automatically.

After a run, an HTML report lands in `playwright-report/` and a junit
file in `test-results.e2e.junit.xml`. Both are gitignored.

## Adding a spec

Use `canary.spec.js` as the template. Every spec should:

1. Import the fixtures barrel:
   ```js
   import { test, expect } from './fixtures/index.js';
   ```
2. Pull either `adminPage` or `studentPage` (or both) from the fixtures
   destructuring, depending on the role you need:
   ```js
   test('admins can open settings', async ({ adminPage }) => {
       await adminPage.goto('/');
       // ...
   });
   ```
3. Use `apiAsAdmin(baseURL)` from `fixtures/seed.js` if you need to
   manipulate server state directly (e.g. seeding extra cases).

## Auth fixtures

`fixtures/auth.js` exposes two test-scoped fixtures:

- `adminPage`   — Page already logged in as `admin` / `admin123`.
- `studentPage` — Page already logged in as `student` / `student123`.

Both work by:

1. Calling `POST /api/auth/login` with the seeded credentials.
2. Injecting the returned JWT into the new browser context's
   `localStorage.token` via `addInitScript`, BEFORE any page navigation.
3. Yielding the page to your test. On teardown, the entire context is
   closed (cookies, storage, everything).

This avoids re-clicking the login form in every spec — login itself has
its own dedicated spec elsewhere in this directory.

If you need to assert on the authenticated user object, the fixture
attaches it as `page.__authUser` and the raw token as `page.__authToken`.

## DB isolation (and why workers=1 today)

`playwright.config.js` mints **one** temp sqlite file (in `os.tmpdir()`)
per `npm run test:e2e` invocation. Every spec hits the same DB. To keep
that safe:

- `fullyParallel: false`
- `workers: 1`

This is the smallest viable setup. It means specs that mutate global
state (e.g. tenant settings, platform_settings) MUST clean up after
themselves, and specs MUST NOT assume row counts.

When this becomes a bottleneck, the upgrade path is:

1. Pre-mint N temp DBs (one per worker) in `globalSetup`.
2. Spawn N server processes on consecutive ports.
3. Pass `PLAYWRIGHT_E2E_DB` per-worker.
4. Flip `fullyParallel: true`, `workers: N`.

Don't do that until at least one spec proves it's needed.

## Debugging a failing spec

Playwright captures rich artifacts on failure:

- **Trace**: open `playwright-report/index.html` and click the failed test
  → "Trace" tab. Lets you scrub through every action with a DOM snapshot
  at each step.
- **Screenshot**: full-page PNG at the moment of failure, attached in
  the report.
- **Video**: webm of the entire test, attached on failure.

You can also run with `--debug` for an interactive PWdebug session:

```bash
npx playwright test tests/e2e/canary.spec.js --debug
```

Or `--ui` for a clickable test runner that re-runs on save and shows
each step's snapshot:

```bash
npm run test:e2e:ui
```

## Ports

E2E pins port `4811`. The dev server (api `3000`, vite `5173`) and the
audit scripts (3900–4399 range) are all explicitly avoided so a developer
can have `npm run dev` running and `npm run test:e2e` in another shell
without collisions.
