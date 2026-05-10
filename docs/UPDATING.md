# Updating rohy

This is the operator manual for keeping a rohy install current. If you're
just looking at the strategy or how it was designed, see
[`UPDATE-STRATEGY.md`](UPDATE-STRATEGY.md). This document is the page you
read **before pressing the upgrade button**.

> **Audience:** anyone running a rohy install (your own lab, a teaching
> hospital, a research site). One operator per install. No fleet.

---

## TL;DR — three commands

```bash
sudo rohy-update check       # what would change?
sudo rohy-update apply       # apply it (auto-backup, auto-rollback on failure)
sudo rohy-update rollback    # undo the last apply
```

That's the entire happy path. Everything below is detail for when something
needs care.

---

## Before your first upgrade

You only need to do this once per install.

### 1. Confirm `rohy-update` is on your `$PATH`

If you installed via `deploy/bootstrap.sh`, `bin/rohy-update` is symlinked to
`/usr/local/bin/rohy-update`. Check:

```bash
which rohy-update
```

If empty, link it manually:

```bash
sudo ln -s /opt/repos/rohy/bin/rohy-update /usr/local/bin/rohy-update
```

### 2. Verify your config

`rohy-update` reads `/etc/rohy/update.conf` if it exists. The defaults in
`bin/rohy-update`'s header work for the standard `bootstrap.sh` install
layout. Override only what differs. Common case (LAN install with
self-signed cert):

```bash
sudo install -d /etc/rohy
sudo tee /etc/rohy/update.conf >/dev/null <<'EOF'
ROHY_VERIFY_URL=https://192.168.50.39:4001/rohy
ROHY_INSECURE=1
EOF
sudo chmod 644 /etc/rohy/update.conf
```

If `ROHY_VERIFY_URL` is empty, the post-deploy verifier is skipped — the
update succeeds as long as the service comes back up. Setting it gives you
the strongest signal that the new version actually works.

### 3. Take a manual baseline backup

Belt-and-braces — every `apply` snapshots automatically, but a manual
baseline gives you a known-good restore point before you start trusting the
automation:

```bash
sudo scripts/rohy-backup.sh --label baseline
sudo scripts/rohy-backup.sh --check          # verify it can be read
```

Backups live at `/var/backups/rohy/<timestamp>-<git-sha>-<label>/`.

---

## The upgrade procedure

### Step 1: `rohy-update check`

Always run this first. Read everything it prints.

```bash
$ sudo rohy-update check
━━ checking for updates ━━
  current : 56fe0d11a7b3 (branch: main)
  remote  : 3b579aa4c8e1 (origin/main)
  behind  : 4 commits

━━ changes summary ━━
  3b579aa deploy: turn Oyon ON by default in Docker path
  0b7d4ab tech-test: wait for upstream readiness before probing
  dabbf2d oyon: proactive camera enumeration
  ...

━━ migrations ━━
  pending:
    - 0019_some_new_migration.sql
  ✓ all migrations are additive — safe to apply

━━ to apply ━━
  sudo rohy-update apply
```

The check is **read-only**. Run it as often as you like. It does:
- `git fetch` to refresh refs.
- Compare local vs `origin/main`.
- List commits and pending migrations.
- Classify migrations from `migrations/MANIFEST.md`.
- Print whether destructive flags are involved.

Exit code 10 means "update available," 0 means "up to date." Useful in scripts.

### Step 2: `rohy-update apply`

```bash
sudo rohy-update apply
```

Walks through these steps, in this order. Any failure rolls back to where
you started.

| # | Step | What happens | Safe to abort? |
|---|------|-------------|---------------|
| 1 | Pre-flight | Checks disk space, lock, service health | yes (no changes yet) |
| 2 | Backup | DB snapshot + env copy + manifest written | yes |
| 3 | Stop service | Graceful SIGTERM, wait for clean shutdown | recoverable: `systemctl start rohy` |
| 4 | Checkout new code | `git checkout <new-sha>` in repo dir | recoverable: `rohy-update rollback` |
| 5 | npm ci + build | Install deps, build frontend | recoverable: `rohy-update rollback` |
| 6 | Migration dry-run | `node scripts/migrate.js --dry-run` | yes (no DB changes yet) |
| 7 | Start service | `systemctl start`, real migrations run on boot | recoverable via rollback |
| 8 | Verify | `tech-test.sh` against `ROHY_VERIFY_URL` | recoverable via rollback |
| 9 | Persist rollback recipe | Records what was applied for `rohy-update rollback` | done |

Total wall time: 30-120 seconds for a typical update, depending on
`npm ci` cache state and how much the build does.

**You will be asked to confirm.** If running unattended (cron, CI), pass
`--yes`. If destructive migrations are pending, `--allow-destructive` is
also required, and you'll be prompted to type the migration filename.

### Step 3: Verify in the browser

The automated verifier covers the API surface. The pill widget, camera
permission, login flow — those still need a human. Hard-refresh
`https://your-host/rohy/` in your browser, click around. If anything looks
broken, **don't wait** — `sudo rohy-update rollback` and report the issue.

---

## Rollback

### Automatic

If any step in `apply` fails, the tool **already rolled back** before
exiting non-zero. You'll see:

```
✗ post-deploy verify failed
! auto-rollback to 56fe0d11a7b3
✓ DB restored from /var/backups/rohy/20260510T120000Z-...
✓ env restored
✓ running (after 4s)
! rolled back to 56fe0d11a7b3 (was attempting update). See /var/log/rohy-update.log.
```

When you see this, the install is back where it started. The new code is
checked out (so `git status` looks new) but `git checkout <old-sha>` was
run before the service restart — you're on the old version.

### Manual (after a successful `apply`, you change your mind)

```bash
sudo rohy-update rollback
```

Reads `/var/lib/rohy/rollback/last`, restores the snapshot taken before the
last `apply`, checks out the old git sha, restarts. Confirms with you first.

**If the apply included destructive migrations**, `rollback` will refuse and
print an alternative procedure — you must restore manually because the old
code can't read the new schema. Use `rohy-update restore-backup
<snapshot>` and accept that you may have to re-do anything that happened
since the apply.

### Restoring an arbitrary snapshot

```bash
sudo rohy-update list-backups          # see what's available
sudo rohy-update restore-backup 20260510T120000Z-abc123-baseline
```

Restores DB. Optionally restores the env file too. Restarts service.

---

## Major version upgrades

Some releases will require a **multi-step upgrade path**. The release notes
will say so explicitly. The pattern, when destructive migrations are
involved:

> "If you are on v0.3.x or earlier, upgrade to v0.4.5 first, run for at
> least a week to confirm stability, then upgrade to v0.5+. Do not skip."

Why: destructive migrations are split across releases on purpose so that
**old code can always read the new schema** (see `migrations/MANIFEST.md`).
Skipping a release breaks that invariant.

The tool tries to enforce this via the `--allow-destructive` gate, but if
upstream forgets to mark a migration destructive, you might silently take
on incompatibility. **Always read the release notes for major version
bumps.**

---

## Off-site backups

Local snapshots in `/var/backups/rohy/` survive bad updates. They do NOT
survive disk failure, ransomware, or the building burning down. If your
install carries data you can't lose, set up an off-site copy.

Two simple recipes:

### Option A: rsync to another machine (cheapest)

```bash
sudo crontab -e
# weekly off-site backup, every Sunday 03:00:
0 3 * * 0 rsync -az --delete /var/backups/rohy/ backup@offsite-host:/srv/rohy-backups/
```

### Option B: rclone to S3 / B2 / Google Drive / etc.

```bash
# one-time setup (interactive, on the rohy host):
rclone config

# weekly:
0 3 * * 0 rclone sync /var/backups/rohy s3-backup:rohy-backups --transfers 4
```

`rclone` handles 30+ backends uniformly. For HIPAA-style compliance, prefer
a backend with at-rest encryption and audit logs.

---

## Troubleshooting

### "another rohy-update is running (lock /var/lock/rohy-update.lock held)"

A previous run didn't clean up. If you're sure none is running:

```bash
sudo ls -la /var/lock/rohy-update.lock     # check ownership
sudo rm /var/lock/rohy-update.lock
```

### "service did not start within 60s"

The new version's startup is failing. Check:

```bash
sudo journalctl -u rohy -n 100 --no-pager
```

Common causes:
- Migration failed at runtime (despite dry-run passing — rare; usually means
  DB had unexpected state).
- An env var introduced in the new release isn't set in `/etc/rohy/env`.
  Compare against `deploy/env.example`.
- A native dependency failed to install on this distro / arch.

`rohy-update apply` should have already auto-rolled back. If it didn't (e.g.
the rollback itself failed), see "Manual recovery" below.

### "post-deploy verify failed"

The service started but `tech-test.sh` found a regression. Look at:

```bash
sudo cat /var/log/rohy-update.log     # the full apply transcript
sudo journalctl -u rohy -n 100        # service-side errors
```

Most often: one specific endpoint is broken in the new release. The tool
auto-rolled back; you're on the old version. File a bug with the
`tech-test.sh` output included.

### "destructive migrations pending — refusing to apply"

Read the release notes for the target version. Likely you need to step
through an intermediate version first. If you're sure, re-run with
`--allow-destructive`. **Take an extra manual snapshot first**:

```bash
sudo scripts/rohy-backup.sh --label pre-destructive
```

Then:

```bash
sudo rohy-update apply --allow-destructive
```

You'll be prompted to type each destructive migration filename to confirm
you read it.

### "one or more migrations not declared in migrations/MANIFEST.md"

The release shipped a migration without a manifest entry. **Don't apply it.**
This is a bug in the release. Open an issue or wait for a fix release.

### Manual recovery (when even rollback fails)

If you see `MANUAL RECOVERY REQUIRED` in the apply output, the tool got
stuck in a bad intermediate state. Recovery procedure:

```bash
# 1. Stop the service (it may be running on broken code)
sudo systemctl stop rohy

# 2. Find your latest snapshot
sudo ls -1dt /var/backups/rohy/*/ | head -3

# 3. Restore DB
sudo cp /var/backups/rohy/<snapshot>/database.sqlite /opt/data/rohy/database.sqlite

# 4. Restore env if needed
sudo cp /var/backups/rohy/<snapshot>/env /etc/rohy/env
sudo chmod 600 /etc/rohy/env

# 5. Pick a known-good git sha (the from_sha in the latest rollback recipe)
sudo cat /var/lib/rohy/rollback/last
# Note the "from_sha" value, then:
sudo -u $(stat -c%U /opt/repos/rohy) git -C /opt/repos/rohy checkout <from_sha>

# 6. Reinstall + rebuild
cd /opt/repos/rohy
sudo -u $(stat -c%U .) npm ci
sudo -u $(stat -c%U .) npm run build

# 7. Start
sudo systemctl start rohy
```

If you reach this section, file a detailed bug report — the tool should
have handled it. Include `/var/log/rohy-update.log`.

---

## Security: verifying releases

> ⚠️ **v1 of `rohy-update` does NOT verify release signatures.** It pulls
> from a github remote configured in your local clone. If the remote is
> compromised, your install is compromised.

Until signed releases ship (planned — see `UPDATE-STRATEGY.md`, Phase D),
you can verify what you're about to install manually:

```bash
sudo rohy-update check                        # see the target sha
git -C /opt/repos/rohy log --oneline HEAD..origin/main \
  --stat                                       # see the diff
```

If anything looks suspicious — a commit you don't recognize from the
maintainer, an unexplained binary blob, a sudden `node_modules` change —
**don't apply**. Open an issue first.

---

## What the tool does NOT do

- ❌ Auto-update on a schedule. You decide when.
- ❌ Send any telemetry. The tool does not phone home.
- ❌ Modify your `/etc/rohy/env` (except restoring during rollback).
- ❌ Touch user-uploaded data outside `/opt/data/rohy/database.sqlite`.
- ❌ Update Node, Python, system packages. Those are your distro's job.
- ❌ Manage TLS certs.

---

## Filing bugs

Include this with every bug report:

```bash
sudo rohy-update --help                       # confirm version
git -C /opt/repos/rohy log -1 --oneline       # current sha
sudo cat /var/log/rohy-update.log | tail -200
sudo journalctl -u rohy -n 100 --no-pager
sudo rohy-update list-backups
```

Don't include the full DB or `/etc/rohy/env` (it contains secrets).

---

## Further reading

- [`UPDATE-STRATEGY.md`](UPDATE-STRATEGY.md) — design rationale, phases
  beyond v1, references.
- [`migrations/MANIFEST.md`](../migrations/MANIFEST.md) — migration policy
  + per-migration metadata.
- [`README.md`](../README.md) — install paths.
- [`HANDOFF.md`](../HANDOFF.md) — current development state.
