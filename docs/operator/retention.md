# Retention & purges

How time-bounded log data ages out of Rohy: the sweep script, the
environment windows it honours, and the separate per-tenant Oyon
retention path.

::: tip Reference
`retention-sweep.js` invocation and the `ROHY_RETENTION_*` env vars are
single-sourced in [CLI & ops](/reference/cli/) and
[Config & env](/reference/config/). Terms are locked in the
[Glossary](/reference/glossary).
:::

---

## What gets swept

`scripts/retention-sweep.js` deletes rows older than the retention
window from these time-bounded tables:

| Table | Timestamp column |
|---|---|
| `event_log` | `timestamp` |
| `learning_events` | `timestamp` |
| `interactions` | `timestamp` |
| `system_audit_log` | `timestamp` |
| `alarm_events` | `triggered_at` |
| `llm_request_log` | `request_timestamp` |

All deletes plus the Oyon sweep (below) run inside **one transaction**,
and the script writes a single `system_audit_log` row recording the
per-table counts, the per-tenant Oyon counts, and the resolved window.
If anything fails the whole transaction rolls back — a partial sweep
never happens.

It prints a JSON summary on success:

```bash
node scripts/retention-sweep.js
```

```json
{
  "retention_seconds": 7776000,
  "retention_days": 90,
  "deleted": { "event_log": 0, "learning_events": 0 }
}
```

---

## Run it on a schedule

The sweep is **not** automatic — install a cron job. Daily at 03:00:

```text
0 3 * * * cd /opt/repos/rohy && /usr/bin/node scripts/retention-sweep.js >> /var/log/rohy/retention-sweep.log 2>&1
```

Confirm `/var/log/rohy/` exists and is writable by the cron user. This
line is part of the production checklist in
[Deploy & harden](/operator/deploy#retention).

---

## How the window is resolved

The script picks the retention window from the first source that is set,
in this order:

1. `ROHY_RETENTION_SECONDS`
2. `RETENTION_SECONDS`
3. `ROHY_RETENTION_DAYS` (× 86400)
4. `RETENTION_DAYS` (× 86400)
5. **Platform Settings** — the `retention_days` (then `log_retention_days`)
   row in `platform_settings`
6. **Default: 90 days** if none of the above resolve

So the normal operator control is **Platform Settings → Retention** in
the admin UI; the env vars are an override for when you want the same
window pinned in `/etc/rohy/env` regardless of DB state. A value of `0`
is honoured (everything past "now" is swept) — set it deliberately, not
by accident.

---

## Per-tenant Oyon retention

Oyon emotion records (`oyon_emotion_records`) do **not** use the global
window above. Their retention is **per tenant**, read from
`oyon_settings.retention_days` for each tenant, and applied by the
shared `sweepOyonRetention()` helper. The sweep script invokes that
helper inside the same transaction so the audit row covers both the
global deletes and the Oyon per-tenant deletes.

Set it in the UI under **Settings → Oyon** for the tenant. A tenant with
no `retention_days` configured keeps its Oyon records until you set one
— Oyon data is not caught by the 90-day global default.

---

## Verifying a sweep

After a scheduled run, the result is queryable from the audit log
(newest first):

- The `system_audit_log` row has `action = 'retention_sweep'`,
  `username = 'retention-sweep'`, the per-table `deleted` counts and the
  `oyon_per_tenant` breakdown in `new_value`, and the resolved
  `retention_seconds` / `retention_days` in `metadata`.
- Tail the cron log: `tail -n 20 /var/log/rohy/retention-sweep.log`.

A run that deletes 0 rows is normal and healthy — it means nothing has
aged past the window yet.

---

## Related

- [Deploy & harden](/operator/deploy#retention) — where the cron line sits in the prod checklist
- [Observability](/operator/observability) — the audit-log and NDJSON surfaces the sweep writes to
- [Backup & restore](/operator/backup-restore) — snapshots are pruned by a separate, backup-specific policy
