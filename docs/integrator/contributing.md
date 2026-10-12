# Contributing & tests

What you must satisfy before a change lands. This is the developer-facing
companion to the [docs style guide](/reference/glossary) for prose; the
rules below are about code.

## ESM only

The repo is `"type": "module"`. Use `import` / `export` everywhere. The few
`.cjs` files (e.g. `scripts/seed-acute-cases.cjs`) are intentional
CommonJS for scripts that need it — don't add new ones without a reason.

## Vitest is split into two projects

`vitest.config.js` defines two named projects with different environments:

| Project | Environment | Picks up |
|---|---|---|
| `client` | `jsdom` (can mount React) | `src/**/*.test.{js,jsx}`, `tests/client/**/*.test.{js,jsx}` |
| `server` | `node` (sqlite file / spawns Express) | `tests/server/**/*.test.{js,jsx}` |

Running a single test **requires `--project`** so the right environment
loads:

```bash
npx vitest run src/utils/voiceResolver.test.js --project=client
npx vitest run tests/server/auth-routes.test.js --project=server
npx vitest run -t "voice resolver"            # filter by test name
```

Whole-suite commands:

```bash
npm test              # both projects
npm run test:client   # client only
npm run test:server   # server only
npm run test:ci       # JUnit XML + v8 coverage (ratchet gates apply)
npm run bench         # vitest bench mode (bench/**, runs in the node project)
```

A server test that boots a real Express via `startTestServer()` in
`beforeAll` gets a 30s `hookTimeout` (parallel sqlite-migration boots are
slow on CI) — don't lower it to mask a genuinely stuck hook.

## The coverage ratchet is real — raise, never lower

`npm run test:ci` enforces v8 coverage floors. The current floors:

```text
statements: 45
branches:   39
functions:  37
lines:      47
```

The rule: **raise these as tests land, never lower them.** If you remove
tested code and the percentage drops, add tests — do not edit the
thresholds down. The single documented exception was a one-time downward
adjustment on 2026-05-12 (a lint cleanup deleted ~150 lines of
loaded-but-dead boilerplate that v8 had counted as "covered"); the climb
back up is by adding tests. Treat any new downward edit as a red flag in
review.

To see current actuals, run `npm run test:ci` and read the **All files**
row of the v8 coverage table. Touching coverage-counted code without tests
should fail the gate.

## Lint: zero errors

```bash
npm run lint            # ESLint flat config (eslint.config.js)
```

Zero-error policy. There are 7 pre-existing tracked warnings — don't add
more, and don't "fix" them by widening rule disables.

### Addresses carry the base path

A production build is served under `/rohy/`, so a hand-written root address
in client code works at `/` and 404s on a real install. ESLint rejects, in
`src/**/*.{js,jsx}` (tests and `src/config/api.js` excepted), a string or
template literal that starts with `/api/`, `/uploads/`, `/oyon/`,
`/standalone/`, `/avatars/` or `/docs/` unless it is passed straight to
`apiUrl()` or `baseUrl()`. Build addresses with those two helpers from
`src/config/api.js`, or call `apiFetch`, which does. A relative
`./uploads/…` resolves under the base and is allowed.

## Browser tests

Playwright needs a build first, and the two suites need different builds:

| Suite | Build | Run | Served at |
|---|---|---|---|
| Main e2e (`tests/e2e/`, `playwright.config.js`) | `npm run build:e2e` | `npm run test:e2e` | `/` |
| Base path (`tests/basepath/`, `playwright.basepath.config.js`) | `npm run build:basepath` | `npm run test:basepath` | `/rohy/`, behind `tests/basepath/proxy.mjs` |

```bash
npm run test:e2e:install      # once: Chromium for Playwright
npm run build:e2e && npm run test:e2e
npm run build:basepath && npm run test:basepath
```

The base-path run puts a proxy in front of the server that strips `/rohy`
and answers 404 for every other path, as an install behind Caddy does. A
learner walks every room of a case with a pathology slide; the slide must
load from `/rohy/api/plugins/…`, no request may leave `/rohy/`, and no app,
Oyon or plugin file may fail. CI runs it as the job **Playwright under a base
path**. Its reporters are `list` and `html`, so it does not post to Prova.

The `tests/e2e/gate-*.spec.js` files (`gate-core`, `gate-screen`,
`gate-rooms`, `gate-exam`, `gate-alarms`, `gate-debrief`, `gate-oncall`)
automate core cases of the release gate in Prova. Each test asserts every
clause of its case's expected text and is listed under that case's `covers:`
in `prova/rohy-cases.yaml`; see [`prova/README.md`](https://github.com/mohsaqr/rohySimulator/blob/main/prova/README.md).

## Build sanity

```bash
npm run build           # docs site, then vite build --base=/rohy/ → dist/ → frontend/
```

`dynajs` (a `file:` sibling dependency) must be built before `npm run build`
here. The other `file:` dependency, `oyon`, is the in-repo `OyonR/`
workspace.

## Before you commit (checklist)

1. **Touched server SQL or a migration?** Confirm `migrations/MANIFEST.md`
   has a row for any new migration and the type (`additive` /
   `destructive`) is honest. A migration without a manifest row makes
   `bin/rohy-update` fail closed. Default to **additive-only**.
2. **Touched response shapes carrying secrets/PII?** Register the field in
   `server/redaction.js` — see [Architecture seams](/integrator/architecture).
3. **Touched voice resolution, lipsync morphs, or the discussant voice
   path?** The 2026-05-06 regression lock is non-negotiable — run the e2e
   suite (`npm run test:e2e`).
4. **Added a notification / alarm / toast / banner?** It must go through
   `src/notifications/`, not a parallel path — register a producer + a
   routing rule.
5. **Touched coverage-counted code?** Run `npm run test:ci` and confirm the
   ratchet still passes.
6. **Lint** is clean (`npm run lint`).

## Never commit session artifacts

`HANDOFF.md`, `LEARNINGS.md`, `CHANGES.md`, `CLAUDE.md`, `AGENT-NOTE-*.md`
are local-only working files — never `git add` them. Likewise the VitePress
build output (`docs/.vitepress/cache|dist|.temp` are git-ignored). Commit
messages carry **no `Co-Authored-By: Claude` line**, per project policy.
