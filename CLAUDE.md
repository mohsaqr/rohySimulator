# CLAUDE.md — rohySimulator

Project-specific guidance for Claude Code and human contributors. The parent
`Documents/Github/CLAUDE.md` covers the surrounding multi-project workspace;
this file only covers what is unique to rohySimulator.

## Testing

Phase 8 status: ~242 server tests + ~290 client tests + ~71 Playwright e2e
tests passing across all tiers. The pyramid below is what every contributor
(human or AI) should know in 60 seconds.

### Pyramid map

| Tier | Files | Run with | Cost |
|---|---|---|---|
| Unit (utils, services, hooks) | `src/**/*.test.{js,jsx}`, `tests/server/**/*.test.js` | `npm test` | < 10s |
| Component (RTL) | `src/components/**/*.test.jsx` | `npm run test:client` | < 30s |
| E2E (Playwright) | `tests/e2e/**/*.spec.js` | `npm run test:e2e` | ~2 min |
| Audio fidelity | `tests/server/audio/**` | `npm run test:server` (skipped without API keys) | < 5s |
| Benchmarks | `bench/**/*.bench.js` | `npm run bench` | ~30s+ |

Project split lives in `vitest.config.js`:
- `client` project — jsdom, picks up `src/**/*.test.{js,jsx}` and `tests/client/**`.
- `server` project — node, picks up `tests/server/**` and `bench/**` (bench
  files are gated to the `vitest bench` runner only, never `vitest run`).

`npm run test:ci` runs both projects with coverage + JUnit reporters; this is
what CI invokes.

### How to add a test

Three concrete starting points — copy the closest one:

- **Unit (pure function).** See `src/utils/sentenceSplit.test.js`. No
  providers, no DOM, no network — import the function, assert the output.
- **Server route.** See `tests/server/tts-route.test.js`. Uses
  `startTestServer()` + supertest to spawn a real Express instance against
  a throwaway sqlite DB.
- **Component.** See `src/components/debug/DiagnosticBar.test.jsx`. Uses
  `renderWithProviders()` so the component sees the same context stack
  `App.jsx` mounts.

New behaviour ⇒ new test in the matching tier. Bug fix ⇒ a regression-lock
test that fails against the un-fixed code, then passes after the fix
(Phase 1 added five of these for the 2026-05-06 voice work; follow that
pattern).

### Helpers available

All under `tests/utils/`:

- `seedDb.js` — opens a temp sqlite file, runs every migration in
  `migrations/`, optionally seeds a minimal admin + agent templates. Use
  in any server test that needs a real DB.
- `startTestServer.js` — boots `server/server.js` on a random high port
  against an isolated sqlite path, returns `{ baseUrl, close }`.
- `renderWithProviders.jsx` — RTL wrapper that mounts the same provider
  stack (`AuthProvider`, `ToastProvider`, `VoiceProvider`,
  `NotificationProvider`) `App.jsx` uses; each can be opted out per test.
- `mockTtsServer.js` — msw handlers that intercept `/api/tts` (both
  buffered and `?stream=1` modes) and return deterministic silent WAV /
  PCM frames; records request payloads for assertion.

### CI matrix

`.github/workflows/ci.yml` defines four post-lint jobs that fan out from
the same `lint` gate (so they run in parallel, not serially):

- `build` — `npm run build`.
- `test` (Vitest) — `npm run test:ci`. Runs both `client` and `server`
  vitest projects together with coverage + JUnit; uploads `coverage/`
  and `test-results.junit.xml` as artifacts.
- `e2e` (Playwright) — `npm run test:e2e` against a freshly built SPA.
  Uploads the Playwright HTML report.
- `audit` — HTTP audit scripts (separate from this testing pyramid).

The Vitest job is a single workflow step, so its `client` + `server`
sub-projects run in-process via Vitest's project orchestrator rather than
as separate GitHub jobs. The e2e job runs in parallel with Vitest, and
each individual e2e spec runs serially inside that job (Playwright
default).

### Commit / PR conventions

- Every changed source file should keep its companion test green. If you
  touch `src/foo.js`, run `npm test -- foo` before committing.
- New behaviour ⇒ new test (same tier as the code).
- Bug fix ⇒ regression-lock test that demonstrably fails against the
  un-fixed code. Add a `// Regression lock: <one-line summary>` comment
  at the top of the `it()` block so future readers know not to delete it.
- Don't merge with `test.skip` added unless it carries the contract
  comment described below.

### Skipped tests policy

`test.skip` is allowed only when a source-level structural assertion (a
type guard, a runtime invariant, a separate test, etc.) covers the same
contract. When skipping, leave a comment of the form:

```js
// CONTRACT: <what is enforced elsewhere and where>
test.skip('foo behaves correctly when bar', () => { ... });
```

The Phase 5 e2e suite has 14 documented skips that follow this rule —
read `tests/e2e/README.md` for examples before adding new ones.

### What NOT to test

- **Framework code.** Don't test that React rerenders on state change or
  that Express routes a path. Test only the project's own wrappers
  around them.
- **Third-party APIs that need a real key.** Gate any test that calls
  Google TTS / OpenAI / Anthropic / etc. behind an env flag (e.g.
  `GOOGLE_TTS_KEY`) so PR runs don't fail without secrets. The audio
  fidelity tier already does this — model new external-API tests after
  `tests/server/audio/google-reference.test.js`.
- **Generated frontend bundles.** `frontend/`, `dist/`, `kits/`, and
  `medkit-app/` are excluded from every vitest project (see
  `sharedExclude` in `vitest.config.js`).

### Tier-specific READMEs

- `tests/README.md` — vitest setup, jsdom config, msw fixtures.
- `tests/e2e/README.md` — Playwright setup, the 14 documented skips,
  how to run a single spec headed.
- `bench/README.md` — bench harness, how to interpret kokoro-js
  throughput numbers.
