# Migration policy and manifest

This file is the canonical record of:
1. **The policy** — what's safe to ship in a migration, what isn't.
2. **The manifest** — per-migration metadata that the update tool reads
   (specifically: is this migration *additive* or *destructive*?).

Both `bin/rohy-update apply` and human reviewers consult this file. Keep it
up to date — if it lies, the operator's automated rollback story breaks.

---

## Policy

### Default: additive-only

Every new migration must be **additive** unless explicitly justified. Additive
means: previous-version code can still run against the new schema. Concretely:

✅ **Always allowed (mark as `additive`):**
- `CREATE TABLE` for a new table
- `ALTER TABLE ... ADD COLUMN` (with a default or NULL allowed)
- `CREATE INDEX`, `CREATE UNIQUE INDEX`, partial indexes
- `CREATE TRIGGER` that doesn't change semantics for existing reads/writes
- Default-value changes that don't affect existing rows
- Table rebuild that *preserves all column names + types* (SQLite's only way
  to widen a column type, drop NOT NULL, etc.). The operation is mechanically
  destructive but semantically additive — old code reads the same shape.

❌ **Forbidden in a single release (mark as `destructive`):**
- `DROP TABLE`
- `DROP COLUMN` (or table rebuild that omits a column)
- `RENAME COLUMN` to a different name (rename-then-restart breaks code)
- Type narrowing (TEXT → INTEGER, removing CHECK constraints loosely
  satisfied today)
- Adding a NOT NULL column without a default
- Adding a unique index on a column that already has duplicates

### How to ship a destructive change anyway

A destructive change must span **at least three releases**. The pattern:

| Release | Change |
|---------|--------|
| N | Add the new column / table / index. Start dual-writing. Reads still hit the old. |
| N+1 | Backfill old data into new shape. Switch reads to the new. Keep dual-writing. |
| N+2 | Stop writing the old. Mark old column as deprecated in this manifest. |
| N+3 (≥ 30 days later) | Actually drop the old column / table. Mark the migration `destructive` here. |

At every step, the **previous release** can still operate against the schema
without crashing. Rollback is always safe up to N+2; rollback past N+3 requires
restoring a pre-N+3 backup.

### What `bin/rohy-update apply` does with this file

Before applying any migration:

1. Reads this manifest.
2. For each pending migration (one not yet recorded in the local DB's
   `schema_migrations` table), checks the row's `Type` column.
3. If `additive`: applies after a transactional dry-run.
4. If `destructive`: refuses to proceed unless `--allow-destructive` is passed
   AND the operator types the migration filename to confirm.
5. Records the applied set in `/var/lib/rohy/rollback/<sha>.json` so
   `rohy-update rollback` can detect "this version's migrations included
   destructive ops, refuse to auto-rollback without operator OK."

If a migration is missing from this manifest, the tool treats it as
`unknown` and refuses to apply — fail closed, not open. So **adding a
migration also requires adding a row here**.

---

## Manifest

| ID | File | Type | Notes |
|----|------|------|-------|
| 0001 | `0001_initial.sql` | additive | Initial schema bootstrap. |
| 0002 | `0002_alarm_config_user_cascade.sql` | additive | Foreign key cascade addition. |
| 0003 | `0003_role_hierarchy.sql` | additive | New role rows + index. |
| 0004 | `0004_tenants.sql` | additive | Multi-tenant introduction. |
| 0005 | `0005_retention.sql` | additive | Retention policy table. |
| 0006 | `0006_tts_pitch_semitones.sql` | additive | New column with default. |
| 0007 | `0007_drug_lab_catalogue.sql` | additive | Catalogue table seed. |
| 0008 | `0008_audit_hash_chain.sql` | additive | Hash chain columns. |
| 0009 | `0009_client_logs.sql` | additive | New table. |
| 0010 | `0010_usage_budget.sql` | additive | Budget tracking columns. |
| 0011 | `0011_oyon_addon.sql` | additive | Oyon emotion-record tables. |
| 0012 | `0012_oyon_settings_runtime.sql` | additive | Runtime config columns. |
| 0013 | `0013_oyon_settings_default_interval.sql` | additive | Default change only. |
| 0014 | `0014_oyon_records_nullable_user.sql` | additive | Table rebuild — preserves all columns; widens NOT NULL to NULL. Old code still reads the same shape. |
| 0015 | `0015_oyon_settings_safer_default.sql` | additive | Default change only. |
| 0016 | `0016_oyon_records_unique_record_id.sql` | additive | Partial unique index. |
| 0017 | `0017_oyon_records_window_metadata.sql` | additive | New columns with defaults. |
| 0018 | `0018_learning_events_vitals.sql` | additive | New columns. |

**To add a new migration**: append a row above. ID + filename match the SQL
file. Set `Type` per the policy. `Notes` is freeform — what changed and why
in one sentence.

**To mark a migration destructive**: change its `Type` and add a `Notes` line
explaining the multi-release path that led here (which previous release
introduced the new shape, which release backfilled, etc.).
