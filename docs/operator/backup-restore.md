# Backup & restore

How to take a consistent Rohy snapshot, verify it, restore it, and the
automatic snapshot every upgrade takes before it touches anything.

::: tip Reference
`rohy-update` subcommands and config vars are single-sourced in
[CLI & ops](/reference/cli/). *Snapshot*, *manifest* and *rollback
recipe* are defined in the [Glossary](/reference/glossary).
:::

::: danger Restore overwrites the live DB
Every restore path below replaces `/opt/data/rohy/database.sqlite`
with the snapshot's copy. Anything written since that snapshot is
lost. Take a fresh snapshot first if the current DB has data you
might still want.
:::

---

## How a snapshot is made

`scripts/rohy-backup.sh` does **not** `cp` the live SQLite file (that
risks a torn read while the server is writing). It runs:

```bash
sqlite3 "$ROHY_DB" "VACUUM INTO '<snapshot>/database.sqlite'"
```

`VACUUM INTO` produces a **defragmented, transactionally consistent**
copy even while the server is running — no downtime needed for a
backup. The snapshot directory then gets:

- `database.sqlite` — the consistent copy
- `manifest.json` — `created_at`, `git_sha`, `label`, `db_bytes`
- `migrations.lst` — the applied-migration list at snapshot time
- `env` — a copy of the systemd `EnvironmentFile` (contains secrets)

Right after writing the copy the script runs `PRAGMA integrity_check`
on the **snapshot** and refuses to keep it if that fails — a snapshot
that exists is a snapshot that verified.

---

## Take a snapshot

```bash
sudo scripts/rohy-backup.sh --label baseline
```

Snapshots land at
`/var/backups/rohy/<timestamp>-<git-sha>-<label>/`, where the three
placeholders are filled in per run. Use a meaningful label
(`pre-import`, `pre-destructive`, `baseline`) — it's how you'll find
the snapshot later.

Verify the most recent snapshot is readable without writing a new one:

```bash
sudo scripts/rohy-backup.sh --check
```

`--check` runs `PRAGMA integrity_check` against the latest snapshot's
DB and prints `ok` or the corruption report.

List local snapshots:

```bash
sudo scripts/rohy-backup.sh --list
# or, equivalently, via the update tool:
sudo rohy-update list-backups
```

---

## The automatic pre-upgrade snapshot

You usually do not run `rohy-backup.sh` by hand for upgrades.
`bin/rohy-update apply` calls it for you as **step 2** of the apply
sequence, before it stops the service or checks out new code:

```text
1 Pre-flight   (no changes yet)
2 Backup       ← rohy-backup.sh --label pre-apply-<target>
3 Stop service
...
```

It also records a **rollback recipe** at
`/var/lib/rohy/rollback/<sha>.json` pointing at that snapshot, so
`rohy-update rollback` knows exactly which one to restore. See the
[Updating manual](/operator/updating#rollback) for the rollback flow.

Retention is automatic on every write:

1. Snapshots created in the **last 24h** are always kept (paranoia gate).
2. The **last 10** snapshots by mtime are kept.
3. **Monthly** snapshots are kept for **12 months**.
4. Everything else is pruned.

---

## Restore drill

Practise this before you need it. On a non-production box, or during a
maintenance window:

### 1. Pick a snapshot

```bash
sudo rohy-update list-backups
```

Note the `NAME` column of the snapshot you want.

### 2. Restore it

The simplest path restores the most-recent pre-apply snapshot and the
git sha that went with it:

```bash
sudo rohy-update rollback
```

To restore an **arbitrary** snapshot (not just the last apply):

```bash
sudo rohy-update restore-backup <snapshot-name>
```

Replace `<snapshot-name>` with a name from `list-backups`. The tool
stops the service, copies the snapshot DB over `$ROHY_DB`, optionally
restores the env file (it asks), and restarts.

### 3. Verify

```bash
sudo systemctl status rohy
scripts/smoke.sh https://your-host/rohy
```

Then hard-refresh the SPA in a browser and log in. A restore that
passes `smoke.sh` but fails login is usually an env mismatch — confirm
the env file restored matches the running code.

### Fully manual restore (when the tool can't help)

If `rohy-update` itself is broken, restore by hand:

```bash
# 1. Stop the service
sudo systemctl stop rohy

# 2. Find the snapshot
sudo ls -1dt /var/backups/rohy/*/ | head -3

# 3. Copy it in (replace <snapshot>)
sudo cp /var/backups/rohy/<snapshot>/database.sqlite /opt/data/rohy/database.sqlite

# 4. Restore env if needed
sudo cp /var/backups/rohy/<snapshot>/env /etc/rohy/env
sudo chmod 600 /etc/rohy/env

# 5. Start
sudo systemctl start rohy
```

---

## Off-site copies

Local snapshots survive a bad upgrade. They do **not** survive disk
failure or ransomware. The two one-line cron recipes (rsync / rclone)
live in [Updating § Off-site backups](/operator/updating#off-site-backups).
Encrypt off-site copies if they leave your control — `gpg --symmetric`
on the tarball is enough; the snapshot's `env` file contains
`JWT_SECRET` and any API keys.

---

## Related

- [Updating](/operator/updating) — the upgrade flow that snapshots automatically
- [Migrations runbook](/operator/migrations) — why a destructive migration
  blocks auto-rollback and forces a manual restore
- [Incident playbooks](/operator/incidents) — wedged-DB and failed-update recovery
