# Rohy's test battery in Prova

Rohy is registered in [Prova](https://prova.lacarm.com) as the product **`rohy`** (web app;
platforms chrome, edge, firefox, safari; required environment field `device`; build read from
`GET /api/health` → `version`). The battery has two halves that meet on the same case ids:

| Half | Lives in | Reaches Prova by |
|---|---|---|
| Manual — what only a person can judge | `prova/rohy-cases.yaml` | catalogue import |
| Automated — what a machine can judge | `tests/e2e/**` | Prova's Playwright reporter, on every CI push |
| Deployed — what must hold of a live instance | `tests/smoke/**` | the same reporter, via `scripts/smoke-deployed.sh` |

The deployed smoke is the upgrade hook: `scripts/post-verify-rohy.sh` runs it after `tech-test.sh`,
so `bin/rohy-update apply` verifies and records every upgrade. Everything in `tests/smoke/` is
read-only and unauthenticated, which is what makes it safe to aim at production — the e2e suite is
not, and must never be.

`rohy-cases.yaml` is the manual half. Where a case is also covered by automation it lists the
automated check keys under `covers:`, which is what makes Prova's coverage matrix show a case as
covered by a person, by a machine, or by both.

Most automated core cases live in `tests/e2e/gate-*.spec.js` (`gate-core`, `gate-screen`,
`gate-rooms`, `gate-exam`, `gate-alarms`, `gate-debrief`, `gate-oncall`). A case becomes
`kind: automated` only when its test asserts every clause of its `expected` text; a case whose text
names something the app does not show stays manual until the text or the app changes.

The base-path run (`npm run build:basepath`, then `npm run test:basepath`; `tests/basepath/`) is
not part of the battery: `playwright.basepath.config.js` names only the `list` and `html`
reporters, so it posts nothing to Prova. CI runs it as its own job.

## Validate before importing

The import is transactional but it is not a dry run, so check the file first. `validate-catalog.mjs`
spins a throwaway Prova over a temp directory, registers the real `rohy` product profile and runs
Prova's **own** parser and validators — no reimplementation, nothing touching the live server:

```bash
node prova/validate-catalog.mjs prova/rohy-cases.yaml --apply
```

Always pass `--apply`. Field, tier, kind and case-id rules are checked when the plan is built, but
**`covers:` patterns are only validated when the plan is applied** — without `--apply` a malformed
coverage pattern passes here and fails against the real server.

It needs a checkout of the Prova repo beside this one; point `PROVA_REPO` elsewhere if yours is not
at `~/Documents/Github/prova`.

## Prove the two halves actually meet

A `covers:` pattern is validated for SYNTAX on import, but Prova cannot know
whether any check key matches it. A renamed test or a typo therefore imports
cleanly and covers nothing, while the case goes on looking automated. Check it:

```bash
ROHY_PW_PROJECTS=all npx playwright test --list --reporter=./prova/dump-check-keys.mjs   # writes prova/check-keys.txt
node prova/check-coverage-links.mjs                                                      # exits 1 on an orphan
```

`ROHY_PW_PROJECTS=all` matters: the monkey walker (`tests/monkey/`) is an opt-in Playwright project
that a bare `npx playwright test` never defines (see `playwright.config.js`), so without it the
listing leaves out the check keys the MONKEY.WALK cases cover and they show up as orphans. Its keys
read `rohy:monkey::../monkey/walker.spec.js › …` — the file is named relative to the e2e testDir.

The first command contacts nothing — it only enumerates the check keys this
suite *would* report. The second matches them against the catalogue using
Prova's own rule (exact key, or a prefix ending in one trailing `*`) and names
the case behind any pattern that matches nothing.

## Import

```bash
curl -X POST "$PROVA_URL/api/v1/catalog/import" \
  -H "Authorization: Bearer $PROVA_ADMIN_TOKEN" \
  -H 'Content-Type: application/yaml' \
  --data-binary @prova/rohy-cases.yaml
```

Import is idempotent: it creates what is new, updates what changed and leaves the rest alone. It is
also the only way to edit the catalogue in bulk — **cases are never deleted**, only retired
(`status: retired`), because a case id is the key that past results hang from.

## Rules the file must keep

Enforced by Prova (`server/lib/catalog.mjs`, `catalog-yaml.mjs`):

- feature id `AREA.NAME`, upper case, no underscores (`CASE.INTERVIEW`, not `CASE_INTERVIEW`)
- case id `<FEATURE>.NN`, **two digits minimum**, and an id never moves to another feature
- `kind` is `manual | automated | both` — **not** `auto`
- `tier` is `core | extended | optional`
- `covers` is `rohy:<suite>::<label>`, with `*` allowed **only as the final character**
- block-style YAML only; the reader rejects flow mappings like `{id: X, title: Y}`
- limits: title 300 chars, `expected` 2000, `steps` 20000 (rendered as markdown)

## What the tiers cost

The gate rule is `core_cases_on_platforms {tier: core, platforms: [chrome, edge, firefox, safari]}`,
so tier is a budget, not a label:

- a **core** case with `platforms: [any]` needs **one** passing human run to satisfy the gate
- a **core** case with an explicit browser list needs a human pass on **every** listed browser
- a case with `kind: both` needs a counting manual pass **and** a counting automated pass

Hence the policy in the file: `platforms: [any]` almost everywhere, explicit browser lists only where
the browser engine is itself the thing under test (audio playback, microphone), and those marked
`extended` so a four-browser sweep is a decision rather than a release block.

Current shape:

| | |
|---|---|
| Features | 59 (25 core, 29 extended, 5 optional) |
| Cases | 121 (42 manual, 10 both, 69 automated) |
| Cases needing a human pass | 52 |
| …of those, gate-blocking (core) | 8 |
| Coverage patterns | 105, all verified to match a real test |
| Automated checks mapped to a case | 183 of 220 |

## Running the battery

Never point it at production data. Use a disposable instance or an account whose data may be
deleted. On a fresh install the seeded accounts are `admin` / `admin123` and `student` /
`student123`, and the seeded cases are an English STEMI case plus natively authored German, Spanish
and Italian ones.

Test the build production serves: the **`current`** tag (`advanced` sits on the same commit).
