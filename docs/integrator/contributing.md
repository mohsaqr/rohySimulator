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

## Build sanity

```bash
npm run build           # vite build --base=/rohy/ → dist/ → frontend/
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
