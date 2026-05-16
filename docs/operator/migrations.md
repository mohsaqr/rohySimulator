# Migrations runbook

How to inspect and apply schema migrations safely, what "additive" vs
"destructive" means in practice, and why the `migrations/MANIFEST.md`
contract is load-bearing for your rollback story.

::: tip Reference
`migrate.js` invocation and `rohy-update` flags are single-sourced in
[CLI & ops](/reference/cli/). *Additive migration*, *destructive
migration* and *forward-compatible* are defined in the
[Glossary](/reference/glossary).
:::

---

## How migrations run

Migrations are versioned SQL files in `migrations/` (`0001_initial.sql`,
`0002_...`, ...). The runner (`server/migrationRunner.js`) tracks applied
versions in the `schema_migrations` table by **version + checksum**.

Three things to know:

- **Auto-run on boot.** The server applies any pending migration on
  start-up. A normal upgrade never needs a manual migrate step — `npm
  run production` / `systemctl start rohy` does it.
- **Checksum-pinned.** If a file's contents change after it was applied,
  the runner aborts with `Migration checksum mismatch` rather than
  silently diverging. Never edit a migration that has shipped — add a
  new one.
- **Baseline stamping.** On a DB that already has the core tables but an
  empty `schema_migrations`, the runner stamps `0001` as applied instead
  of re-running it (pre-existing installs aren't re-bootstrapped).

---

## Inspect: status

The update tool surfaces pending migrations as part of its read-only
check:

```bash
sudo rohy-update check
```

The `━━ migrations ━━` block lists pending files and classifies them
from `migrations/MANIFEST.md` as **additive**, **destructive**, or
**unknown**.

---

## Dry-run

Before any real apply you can prove the pending set parses and would
apply cleanly **without touching the DB**:

```bash
node scripts/migrate.js --dry-run
```

`--dry-run` discovers pending migrations, prints what would run (and any
baseline stamp), and makes **zero** writes. `bin/rohy-update apply` runs
this automatically as step 6 — a dry-run failure aborts the apply
*before* the real migration, so the DB is untouched.

Apply for real (rarely needed by hand — the server does it on boot):

```bash
node scripts/migrate.js
```

`ROHY_DB=/path/to/database.sqlite` overrides the target DB if it isn't
at the default location.

---

## Additive vs destructive

The policy in `migrations/MANIFEST.md` classifies every migration. The
distinction is about **whether the previous release's code can still run
against the new schema**.

**Additive** (always allowed, marked `additive`):

- `CREATE TABLE` for a new table
- `ALTER TABLE ... ADD COLUMN` (with a default or NULL allowed)
- `CREATE INDEX` / `CREATE UNIQUE INDEX` / partial indexes
- `CREATE TRIGGER` that doesn't change existing read/write semantics
- Default-value changes that don't touch existing rows
- A table rebuild that **preserves all column names + types**
  (SQLite's only way to widen a column / drop NOT NULL) — mechanically
  destructive, semantically additive

**Destructive** (forbidden in a single release, marked `destructive`):

- `DROP TABLE`, `DROP COLUMN` (or a rebuild that omits a column)
- `RENAME COLUMN` to a different name
- Type narrowing, or removing a CHECK constraint
- Adding a NOT NULL column without a default
- Adding a unique index where duplicates already exist
- `DELETE` / `UPDATE` that destroys existing user data without a guard
  predicate (e.g. no `WHERE NOT EXISTS (SELECT 1 FROM <ref> WHERE ...)`)

A real example from the manifest: `0022_voice_surface_collapse.sql` was
reclassified from `additive` to `destructive` in the 2026-05-14 audit
because it does predicate-based `DELETE`s on user-authored tables
(`platform_settings`, `cases`) without an FK guard. Operators who
already applied it are unaffected; operators upgrading **past** it now
go through the `--allow-destructive` gate.

### How a destructive change ships anyway

It is split across **at least three releases** — expand and contract:

| Release | Change |
|---|---|
| N | Add the new column/table/index. Start dual-writing. Reads still hit the old. |
| N+1 | Backfill into the new shape. Switch reads to the new. Keep dual-writing. |
| N+2 | Stop writing the old. Mark old column deprecated in the manifest. |
| N+3 (>= 30 days later) | Actually drop the old. Mark the migration `destructive` here. |

At every step the **previous release** still runs without crashing.
Rollback is safe up to N+2; past N+3 you must restore a pre-N+3 backup
(see [Backup & restore](/operator/backup-restore)).

---

## The MANIFEST contract

`migrations/MANIFEST.md` is not documentation — it is a **policy file
the update tool reads**. Before applying, `bin/rohy-update`:

1. Reads the manifest at the **target** git sha.
2. For each pending migration, reads its `Type` column.
3. `additive` — applies after the transactional dry-run.
4. `destructive` — refuses unless `--allow-destructive` is passed **and**
   you type the migration filename to confirm.
5. `unknown` (migration not in the manifest) — **refuses to apply at
   all**. Fail closed, not open.

So **adding a migration also requires adding its manifest row in the same
commit**. A release that ships a migration without a manifest row will
make `rohy-update` refuse the whole upgrade with:

```text
one or more migrations not declared in migrations/MANIFEST.md. Refusing to apply.
```

That is a bug in the release, not in your install — don't hand-edit the
manifest to work around it; wait for a fix release.

---

## Applying when destructive migrations are pending

If `check` reports destructive migrations:

1. **Read the release notes.** Major bumps often require stepping
   through an intermediate version first — skipping one breaks the
   forward-compat invariant.
2. **Take an extra manual snapshot:**

   ```bash
   sudo scripts/rohy-backup.sh --label pre-destructive
   ```

3. **Apply with the explicit gate:**

   ```bash
   sudo rohy-update apply --allow-destructive
   ```

   You'll be prompted to type each destructive migration's filename.

::: danger Rollback is not automatic after a destructive apply
Once a destructive migration has run, old code can't read the new
schema, so `rohy-update rollback` will refuse. Recovery is a manual
`restore-backup` of the pre-destructive snapshot — which means losing
anything written since. This is exactly why step 2 above is mandatory.
:::

---

## Related

- [Updating](/operator/updating) — the full upgrade flow and the `--allow-destructive` gate
- [Update strategy](/operator/update-strategy) — why expand-and-contract was chosen
- [Backup & restore](/operator/backup-restore) — the snapshot you need before a destructive apply
- [Incident playbooks](/operator/incidents) — recovering from a failed migration
