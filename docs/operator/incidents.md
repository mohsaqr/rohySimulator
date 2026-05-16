# Incident playbooks

Short, do-this-now procedures for the four incidents an operator
actually hits. Each ends with how to confirm you're recovered.

::: tip Reference
Commands, flags and env vars referenced here are single-sourced in
[CLI & ops](/reference/cli/) and [Config & env](/reference/config/).
Terms are locked in the [Glossary](/reference/glossary).
:::

::: danger Snapshot before you mutate
Every recovery below that touches the DB can lose data. If the current
DB is salvageable at all, take a snapshot first:
`sudo scripts/rohy-backup.sh --label pre-incident`.
:::

---

## 1. Wedged local DB (won't open / SQLITE_BUSY / corrupt WAL)

**Symptom:** service won't start, journal shows SQLite open/lock/WAL
errors, or `PRAGMA integrity_check` fails.

```bash
# 1. Stop the service so nothing is touching the files
sudo systemctl stop rohy

# 2. Snapshot whatever is there (best effort — may fail if truly corrupt)
sudo scripts/rohy-backup.sh --label pre-incident || true

# 3. Try just clearing the side files (a stale WAL/SHM is the common case)
sudo rm -f /opt/data/rohy/database.sqlite-shm /opt/data/rohy/database.sqlite-wal

# 4. Start; SQLite replays/repairs on open
sudo systemctl start rohy
```

If it still won't open, the DB file itself is damaged — restore the
most recent good snapshot:

```bash
sudo rohy-update list-backups
sudo rohy-update restore-backup <snapshot-name>
```

For a **dev box** the documented reset is: stop the server, delete
`server/database.sqlite{,-shm,-wal}`, restart — migrations and seeders
re-run automatically. **Never** do this on a box with real data; that
is a data-loss reset, not a repair.

**Recovered when:** `sudo systemctl status rohy` is active and
`scripts/smoke.sh https://your-host/rohy` passes. Full drill in
[Backup & restore](/operator/backup-restore#restore-drill).

---

## 2. Failed update + rollback

**Symptom:** `rohy-update apply` exited non-zero.

In almost all cases **the tool already rolled back** — it restores the
snapshot, checks out the old sha, and restarts before exiting. Look for:

```text
! auto-rollback to <old-sha>
✓ DB restored from /var/backups/rohy/...
! rolled back to <old-sha> (was attempting update).
```

If you see that, you're already on the old version. Confirm:

```bash
sudo systemctl status rohy
git -C /opt/repos/rohy log -1 --oneline
```

If the apply got stuck mid-way (`MANUAL RECOVERY REQUIRED` in the
output, or the rollback itself failed), follow the manual recovery
sequence in
[Updating § Manual recovery](/operator/updating#manual-recovery-when-even-rollback-fails):
stop service → restore snapshot DB + env → `git checkout` the
`from_sha` from `/var/lib/rohy/rollback/last` → `npm ci && npm run
build` → start.

::: danger Destructive migration in the failed apply
If the failed apply included a **destructive** migration,
`rohy-update rollback` will refuse — old code can't read the new
schema. You must `restore-backup` the pre-apply snapshot and accept
losing anything written since. See
[Migrations runbook](/operator/migrations#applying-when-destructive-migrations-are-pending).
:::

**Recovered when:** service is active, `rohy-update check` shows the
sha you intended to be on, and the SPA loads + login works in a
browser. Then file a bug with `/var/log/rohy-update.log` attached.

---

## 3. TTS provider outage

**Symptom:** patient voice silent / 5xx from `/api/tts`; trainees
report no audio.

Rohy has four TTS providers (Google, OpenAI, Kokoro, Piper). An outage
is usually one provider, not the platform.

1. **Identify which.** Check the journal for the failing provider:

   ```bash
   sudo journalctl -u rohy -n 100 --no-pager | grep -i tts
   ```

2. **Fail over to a local provider.** In **Settings → Voice → Provider**
   switch from the cloud provider (Google/OpenAI) to **Kokoro** (in-process
   ONNX, no network) or **Piper** if installed. This takes effect for new
   utterances immediately — no restart.

3. **If it's a cloud key/quota problem**, the provider's own dashboard
   tells you (rate limit / billing). The simulator keeps running on the
   local provider in the meantime.

4. **Kokoro not warmed** (cold-start stutter on first request after a
   restart) is expected and self-heals — it warms at boot; give it a
   few seconds.

Note: changing the platform voice provider does **not** retroactively
change a running session bound to a per-case voice — that's the voice
precedence resolver behaving correctly, not a second outage.

**Recovered when:** a fresh session produces patient audio with the
selected provider and `journalctl` shows no new TTS errors.

---

## 4. High latency

**Symptom:** pages slow, trainees report lag.

1. **Find the slow queries.** They're already logged as `slow_query`
   warnings (default threshold 100 ms):

   ```bash
   sudo journalctl -u rohy --output=cat | grep '"event":"slow_query"' | tail -20
   ```

2. **Correlate a specific slow request.** Take the `request_id` from a
   user-reported error or a slow log line and pull everything it did:

   ```bash
   sudo journalctl -u rohy --output=cat | grep '"request_id":"<the-id>"'
   ```

   (Temporarily set `ROHY_LOG_LEVEL=debug` to get per-query SQL
   summaries, then put it back — debug is noisy.) See
   [Observability](/operator/observability) for the full field list.

3. **Check the obvious resource walls:**
   - Disk near full (`df -h`) — SQLite degrades hard when the FS is full,
     and the pre-flight needs 3× DB size free for the next upgrade.
   - Retention never ran — unbounded log tables make scans slow. Confirm
     the cron from [Retention & purges](/operator/retention) is installed
     and `tail` its log.
   - Edge: no WAF / rate-limiter — Express's limiter is per-process; a
     burst can saturate one box. Add an edge limiter.

4. **Scale decision.** Sustained load above what SQLite handles (~50+
   concurrent users) is the documented trigger to evaluate the
   Postgres-readiness path in
   [Deploy & harden § Postgres readiness](/operator/deploy#postgres-readiness).
   SQLite with WAL is fine well below that on modest hardware.

**Recovered when:** `slow_query` warnings drop back to baseline and page
latency is acceptable in a browser.

---

## Related

- [Backup & restore](/operator/backup-restore) — the restore drill the wedged-DB and failed-update playbooks lean on
- [Updating](/operator/updating) — auto/manual rollback detail
- [Migrations runbook](/operator/migrations) — destructive-migration recovery
- [Observability](/operator/observability) — request-id and slow-query mechanics
- [Retention & purges](/operator/retention) — the cron whose absence causes slow scans
