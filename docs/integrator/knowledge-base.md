# Knowledge base

One queryable record of what this repository knows about itself: every commit,
every release, every triaged bug, every recorded learning, every migration, and
the documents that explain them — in a single SQLite file with full-text search
across all of it.

```bash
npm run kb:build                              # build (or rebuild) it
npm run kb -- search "audit chain"            # ranked search over everything
npm run kb -- file server/routes/orders-routes.js
```

## It is derived, and that is the design

Nothing in it is authored. Every row is parsed out of something already in the
repo:

| Source | Becomes |
|---|---|
| `git log` | `commit_log` — subject, body, files, and the `type(scope)` / `(vX.Y.Z)` this repo commits by |
| `CHANGELOG.md` | `release` and `change` — one row per release, one per bullet inside it |
| `reports/*triage*.md` | `bug` — one row per numbered finding, verdict preserved verbatim |
| `LEARNINGS.md` | `learning` — one row per bullet, not per day |
| `migrations/MANIFEST.md` | `migration` — id, file, additive/destructive, notes |
| `AGENT-NOTE-*.md`, `HANDOFF.md`, the assistant's memory dir | `insight` |
| `docs/**`, `reports/**` | `doc` — indexed whole |

`npm run kb:build` drops the file and re-derives it, deterministically. Two
consequences, both deliberate:

- **There is no second source of truth to keep in sync.** A knowledge base you
  have to remember to update is one that is quietly wrong. To record something,
  write it where it belongs — a commit message, a `CHANGELOG` entry, a
  `LEARNINGS` bullet — and rebuild.
- **The file is never committed.** Carm's equivalent (`data/knowledge.db`) was
  re-committed on every update and now accounts for **6.24 GB** of that repo's
  history, with its website copies adding another 2.6 GB — recorded in its own
  `AGENT-NOTE-git-bloat.md`. A regenerable artifact belongs in `.gitignore`.
  Ours rebuilds from scratch in about three seconds.

Provenance is a path, not a chain of custody: every derived row carries
`source_path`, and `source_line` wherever the parser can be precise, so any
claim traces back to the file it was read from.

## Commands

| | |
|---|---|
| `search <query>` | ranked full-text over every entity. `--kind commit\|release\|change\|bug\|learning\|insight\|migration\|doc`, `--limit` |
| `file <path>` | every commit, bug and learning about one file |
| `bugs` | `--status open\|fixed\|invalid\|deferred`, `--report`, `--module` |
| `stale` | open bugs with later work on the files they blamed |
| `learn` | `--since 2026-08`, `--module server:routes` |
| `commits` | `--scope auth`, `--type fix`, `--version`, `--since`, `--module` |
| `release [version]` | the release list, or one release in full |
| `migrations` | `--type additive\|destructive` |
| `modules` | where the work has gone |
| `show <kind> <id>` | one record in full |
| `stats` | overview and shape of the history |
| `sql "SELECT …"` | read-only escape hatch |

Search accepts FTS5 syntax: `"exact phrase"`, `term*`, `a OR b`, `a NOT b`.
Results are ranked with `bm25`, weighted so a hit in a title outranks one in a
body.

### The two that earn their keep

**`file`** answers "what do we know about this file" in one call — the commits
that touched it, the bugs that blamed it, the learnings that cite it. Bugs and
learnings are matched on basename, because prose cites `orders-routes.js:1745`
far more often than the full path.

**`stale`** exists because a triage report is a snapshot. It records what was
true the day it was written and is almost never edited when the fix ships, so
`bugs --status open` over-reports. `stale` lists each still-open bug beside the
later commits that touched exactly the files it blamed. It does **not** claim
anything is fixed — it cannot, and a confidently wrong record is worse than a
stale one. It is a prompt to re-triage.

## Modules

A path becomes a module by prefix, first match winning, via `MODULES` in
`scripts/knowledge/lib.mjs`. Adding a route or a component needs no edit there.
Anything unmatched becomes `other` — and `npm run kb -- modules` shows how much
lands there, so a growing `other` is the signal that the map needs a row.

## When a parser stops matching

That is the real failure mode, and it is silent: a source file's format drifts,
the parser returns fewer rows, and the build still reports success. Two guards:

- `npm run kb:build` **fails** if any source falls under a floor
  (`FLOORS` in `build.mjs`). The floors are deliberately far below current
  counts — they catch a parser that has stopped working, not ordinary change.
- `tests/server/knowledge-base.test.js` re-derives from the real sources and
  asserts each still yields what the file itself contains — for example, that
  the migration parser reads exactly as many rows as `MANIFEST.md` has.

Both exist because this happened during construction: `migrations/MANIFEST.md`
spaces its rows out with blank lines, strict markdown ends a table at the first
blank line, and the parser read 32 of 50 rows while reporting perfect success.
