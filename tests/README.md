# Tests

Phase 0 of the testing strategy lives here. The full plan is in
[`../TESTING_PLAN.md`](../TESTING_PLAN.md).

## Test pyramid

| Tier | Where it lives | Runner |
|---|---|---|
| Client unit / hook tests | `src/**/*.test.js{,x}` | vitest (jsdom) |
| Server unit tests | `tests/server/**/*.test.js` | vitest (node) |
| HTTP boundary smoke tests | `scripts/audit-*.sh` | bash + curl |
| End-to-end (Phase 5) | `tests/e2e/` | Playwright (not wired yet) |

The `tests/` directory itself only holds:

- `setup.js` — global jsdom setup (matchMedia / AudioContext / localStorage stubs, RTL cleanup).
- `utils/` — shared helpers used across suites.
- `client/` — opt-in directory if you want a client test that doesn't live next to the source file (most should — co-locate).
- `server/` — server-tier tests (DB, route, middleware).

## Commands

```bash
npm test                # one-shot run, default reporter
npm run test:watch      # interactive watch mode
npm run test:ui         # vitest UI in the browser
npm run test:client     # only the client (jsdom) project
npm run test:server     # only the server (node) project
npm run test:ci         # one-shot + JUnit XML + v8 coverage report
```

`test:ci` writes `test-results.junit.xml` at the repo root and a coverage
report under `coverage/`. CI uploads both as artifacts.

## Adding a client unit test

Co-locate it next to the source. The canary example is
[`src/utils/sentenceSplit.test.js`](../src/utils/sentenceSplit.test.js):

```js
import { describe, it, expect } from 'vitest';
import { thingUnderTest } from './thingUnderTest.js';

describe('thingUnderTest', () => {
    it('does the thing', () => {
        expect(thingUnderTest()).toBe(42);
    });
});
```

For tests that mount React components, use the provider wrapper:

```jsx
import { renderWithProviders } from '../../tests/utils/renderWithProviders.jsx';
import { screen } from '@testing-library/react';

renderWithProviders(<MyComponent />);
expect(screen.getByText('Hello')).toBeInTheDocument();
```

## Adding a server test

Server tests run in a node environment and live under `tests/server/`.

For pure unit tests of a server module, just import it. For tests that need
a real sqlite, use `createTestDb`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

let db;
beforeEach(async () => { db = await createTestDb({ seed: true }); });
afterEach(async () => { await db.cleanup(); });

it('users table exists after migrations', async () => {
    const row = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    expect(row).toBeTruthy();
});
```

For tests that hit a real HTTP endpoint, use `startTestServer`:

```js
import { startTestServer } from '../utils/startTestServer.js';

let srv;
beforeAll(async () => { srv = await startTestServer({ seed: true }); });
afterAll(async () => { await srv.close(); });

it('rejects unauthenticated admin calls', async () => {
    const res = await fetch(`${srv.baseUrl}/api/admin/database-stats`);
    expect(res.status).toBe(401);
});
```

`startTestServer` spawns the real `server/server.js` on a random high port
with `ROHY_DB` pointed at a fresh sqlite file. It mirrors the pattern in
`scripts/audit-observability.sh` so server tests have the same isolation
guarantees the audit suite already relies on.

## Mocking TTS

Client tests that exercise voice playback should intercept `/api/tts` with
the helpers in [`utils/mockTtsServer.js`](utils/mockTtsServer.js):

```js
import { setupServer } from 'msw/node';
import {
    ttsHandlers,
    getRecordedRequests,
    resetRecordedRequests,
} from '../../tests/utils/mockTtsServer.js';

const server = setupServer(...ttsHandlers());
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); resetRecordedRequests(); });
afterAll(() => server.close());

it('sends pitch in the body, not in playbackRate', async () => {
    // ...trigger the code under test...
    const calls = getRecordedRequests();
    expect(calls[0].body.pitch).toBe(5);
});
```

The non-streaming endpoint returns one second of silent WAV. The
streaming endpoint (`?stream=1`) returns a single PCM frame of silence.
Tests that need a richer response can override the handler with msw's
standard API.

## Coverage targets

Phase 0 does **not** enforce coverage thresholds. The targets documented
in `vitest.config.js` (commented out) are:

- Phase 2/3 baseline: 70% lines / 65% branches.
- Phase 4: raise to 80%.
- Phase 5+: raise to 85%.

When we wire enforcement, uncomment the `thresholds` block.

## Coverage gate (Phase 8)

PRs are checked by [Codecov](https://docs.codecov.com/) against `main`.
Configuration lives in [`../codecov.yml`](../codecov.yml). The gate is
deliberately **soft** for the first month so existing PRs don't break:

- **Project**: total coverage may drop by up to **1%** vs. `main` before
  the check fails. Target is `auto` (= whatever `main` currently sits at).
- **Patch**: of the lines a PR adds or modifies, **60%** must be covered.
  Threshold is 5%, so a PR landing at 55% on changed lines still passes.
- **Soft-fail upload**: `fail_ci_if_error: false` in `ci.yml` means a
  Codecov outage (or a missing `CODECOV_TOKEN` secret) won't block the PR.

The intent is to block PRs that delete tests or ship hundreds of new
source lines with zero tests — not to bikeshed every 0.1% slip. Phase 9
will raise patch target to 75% and project threshold to 0.5%.

**Setup required** (one-time, by a maintainer): add `CODECOV_TOKEN` to
the repo's Actions secrets (Settings -> Secrets and variables -> Actions).
The token comes from https://app.codecov.io/ after linking the repo.
Until the token is added, the upload step is a no-op — the gate becomes
active automatically once the secret exists.

The raw coverage report is also uploaded as a CI artifact
(`coverage-22.x`) on every run, so you can download
`coverage/index.html` to inspect line-by-line coverage without Codecov.
