# Rohy's test battery in Prova

Rohy is registered in [Prova](https://prova.lacarm.com) as the product **`rohy`** (web app;
platforms chrome, edge, firefox, safari; required environment field `device`; build read from
`GET /api/health` → `version`). The battery has two halves that meet on the same case ids:

| Half | Lives in | Reaches Prova by |
|---|---|---|
| Manual — what only a person can judge | `prova/rohy-cases.yaml` | catalogue import |
| Automated — what a machine can judge | `tests/e2e/**` | Prova's Playwright reporter |

`rohy-cases.yaml` is the manual half. Where a case is also covered by automation it lists the
automated check keys under `covers:`, which is what makes Prova's coverage matrix show a case as
covered by a person, by a machine, or by both.

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
npx playwright test --list --reporter=./prova/dump-check-keys.mjs   # writes prova/check-keys.txt
node prova/check-coverage-links.mjs                                 # exits 1 on an orphan
```

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
| Features | 44 (18 core, 21 extended, 5 optional) |
| Cases | 92 (69 manual, 12 both, 11 automated) |
| Cases needing a human pass | 81 |
| …of those, gate-blocking (core) | 40 |
| Coverage patterns into `tests/e2e` | 32, all verified to match a real test |

## Running the battery

Never point it at production data. Use a disposable instance or an account whose data may be
deleted. On a fresh install the seeded accounts are `admin` / `admin123` and `student` /
`student123`, and the seeded cases are an English STEMI case plus natively authored German, Spanish
and Italian ones.

Test the **`advanced`** channel build — that tag, not `main`, is what production serves.
