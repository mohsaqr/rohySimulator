# Data retention

Rohy distinguishes **soft-delete** (a row hidden from reads but still on
disk) from **physical purge** (a row `DELETE`d permanently). Time-bounded
log tables are physically purged on a schedule; user-authored domain rows
are soft-deleted and only physically removed by the retention process.

## Soft-delete vs physical purge

Migration `0005_retention.sql` ("Stage E7 soft-delete + retention
readiness") added a `deleted_at DATETIME` column to user-authored / domain
tables — including `users`, `cases`, `sessions`, `interactions`,
`clinical_notes`, `agent_templates`, `scenarios`, `medications`,
`case_investigations`, `lab_definitions` — with indexes on each
`deleted_at`. A soft-deleted row has `deleted_at` set; reads filter
`deleted_at IS NULL`, so it disappears from the UI and API without being
destroyed.

The same migration rebuilt `users` so a purge can set `email` (and other
PII) to `NULL` while preserving the anonymized ownership-anchor row — so a
purged user's sessions still have a valid (now anonymized) owner rather
than dangling. Authentication treats a soft-deleted user as inactive: a
non-`NULL` `deleted_at` causes **403** on every request (see
[RBAC &amp; auth model](/security/rbac)).

## Retention windows

The retention window is resolved by `scripts/retention-sweep.js` with this
precedence (first match wins):

1. `ROHY_RETENTION_SECONDS`
2. `RETENTION_SECONDS`
3. `ROHY_RETENTION_DAYS` (× 86400)
4. `RETENTION_DAYS` (× 86400)
5. Platform Settings — `retention_days`, falling back to
   `log_retention_days`
6. **Default: 90 days**

A negative or non-finite resolved value is rejected; `0` is allowed (purge
everything past "now"). These environment variables are documented in the
[config reference](/reference/config/) (`RETENTION_DAYS`,
`RETENTION_SECONDS`, `ROHY_RETENTION_DAYS`, `ROHY_RETENTION_SECONDS`).

## The purge sweep

`node scripts/retention-sweep.js` runs one transaction that
physically deletes rows older than the cutoff from the time-bounded tables:

| Table | Time column |
|---|---|
| `event_log` | `timestamp` |
| `learning_events` | `timestamp` |
| `interactions` | `timestamp` |
| `system_audit_log` | `timestamp` |
| `alarm_events` | `triggered_at` |
| `llm_request_log` | `request_timestamp` |

Inside the **same transaction**, it runs the per-tenant Oyon sweep (below),
then writes a `retention_sweep` row into `system_audit_log` recording the
per-table deleted counts and the resolved retention window. Because that
audit row is written before `COMMIT`, the audit entry covers both the
global and Oyon deletes atomically, and it feeds the
[hash chain](/security/audit-chain) like any other entry.

Run it on a cron — the documented pattern is daily at 03:00:

```cron
0 3 * * * cd /opt/repos/rohy && /usr/bin/node scripts/retention-sweep.js >> /var/log/rohy/retention-sweep.log 2>&1
```

::: danger
The sweep is a **physical `DELETE`**. Deleted log and audit rows are gone —
there is no soft-delete tombstone for the time-bounded tables, only the
single summary audit row. Set the retention window deliberately and keep
off-site backups (see the [Hardening checklist](/security/hardening))
before installing the cron. A short `RETENTION_DAYS` will also truncate the
`system_audit_log` itself.
:::

## Per-tenant Oyon retention

Oyon emotion records have their **own** retention window per tenant, not
the global one. `sweepOyonRetention()` reads `oyon_settings.retention_days`
for every tenant with a positive value and deletes
`oyon_emotion_records WHERE tenant_id = ? AND window_start <
datetime('now', '-<days> days')` for each. The deleted counts per tenant
are folded into the same audit row described above. Per-tenant Oyon
retention is configured in Settings → Oyon; see
[Oyon &amp; EU AI Act](/security/oyon-ai-act) for the privacy posture of that
data.

## Verifying retention posture

`bash scripts/audit-retention.sh` exercises the retention contract against
a running server. Run it as part of deploy verification (see the
[Hardening checklist](/security/hardening)).
