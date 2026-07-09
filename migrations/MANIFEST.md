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
- `DELETE FROM <table>` of existing rows by predicate, *unless* the predicate is
  provably zero-row in every operator DB (e.g. matches a known-stale schema slot
  that no operator ever populated). Pattern-based row deletes against
  user-authored tables (`cases`, `agent_templates`, etc.) are always
  destructive even if the author "knows" no operator has those rows —
  knowing requires guarding the predicate with `WHERE NOT EXISTS (SELECT 1
  FROM <referencing-table> WHERE …)`, not asserting.
- `UPDATE <table> SET …` that overwrites existing user data (as opposed
  to default-changes that touch NULLs or known-stale values). When in
  doubt, add a `WHERE` clause that only matches rows whose value is the
  stale sentinel.

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
| 0019 | `0019_oyon_lower_min_valid_frames.sql` | additive | Default change only — backfills legacy 6 → 3 so analytics stop dropping windows on normal blinks. |
| 0020 | `0020_clear_orus_patient_template_default.sql` | additive | Data fixup — removes the stale `en-US-Chirp3-HD-Orus` `case_voice` override from `is_default=1` patient templates. Targeted: only matches that exact value, so admin-picked voices are preserved. Idempotent (zero-row no-op on already-clean installs). |
| 0021 | `0021_learning_events_room.sql` | additive | New `room` column on learning_events + partial index. Pairs with the RoomNavigator: every event carries the active in-session room ('chat', 'examination', 'lab', 'radiology', 'consultant'). Pre-migration rows + pre-room events stay NULL. |
| 0022 | `0022_voice_surface_collapse.sql` | destructive | Reclassified from `additive` (2026-05-14 audit): the migration deletes rows from `platform_settings` and `cases` and overwrites `cases.config` / `agent_templates.config` for shipped cases. Predicate-based DELETE on user-authored tables without an FK guard is destructive per the policy above, even when the author believes "no operator has those rows." Operators on a version that already applied this migration are unaffected (data is gone); operators upgrading past it now go through the `--allow-destructive` gate. Concretely: (a) Deletes zombie `voice_*`/`piper_voice_*`/`default_voice_*` settings rows from platform_settings. (b) Strips `tts_provider`/`tts_rate`/`tts_pitch` from `cases.config.voice` and `tts_provider` from `agent_templates.config.voice`. (c) Clears non-Kokoro `case_voice` values. (d) Overwrites Kokoro voices on shipped cases 1–6. (e) Removes ~55 test-fixture cases by name pattern with no `WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE case_id = cases.id)` guard. |
| 0023 | `0023_clamp_turnaround_to_5min.sql` | additive | Data-only normalisation. Clamps `case_investigations.turnaround_minutes` to the 1–5 minute band the sim uses after the turnaround cleanup (kills 30 / 60 / 240 / 2880 / 10080 minute waits seeded before the clamp). Schema unchanged — old code can still read these rows; only the column values move. Authors who deliberately need a longer wait can re-set via the case wizard. |
| 0024 | `0024_agent_arrives_at.sql` | additive | New nullable `arrives_at` column on `agent_session_state`. Anchors the paged → present timer on the server clock so the wait survives refreshes / room hops; pairs with the 1–3 minute clamp in the page handler. Old code that doesn't read this column keeps working — null on every row at migration time. |
| 0025 | `0025_cohorts.sql` | additive | Two new tables for teacher-owned cohorts: `cohorts` (teacher-owned class with optional join_code) + `cohort_members` (student membership). Partial unique indexes (live join_code, live cohort_id+user_id) plus owner/tenant/lookup indexes. Strictly additive — nothing on existing tables changes; pre-migration code never touches these tables. No endpoints/UI yet (Phase 2 = schema only). |
| 0026 | `0026_base_class_backfill.sql` | additive | Data backfill — per tenant with sessions, seeds one "Base Class" cohort (owned by that tenant's lowest-id admin, else educator) and enrolls every distinct user with a live session, so pre-feature activity is visible in the teacher dashboard out of the box. Only INSERTs into cohorts/cohort_members; no schema change; NOT EXISTS guards + 0025 partial-uniques make it re-run-safe. Tenants with sessions but no admin/educator are skipped (NOT NULL owner FK). |
| 0027 | `0027_cohort_entity.sql` | additive | Fleshes out the cohort entity. Adds 4 nullable `cohorts` columns (`description TEXT`, `starts_at DATETIME`, `ends_at DATETIME`, `settings JSON`), adds `cohort_members.member_role TEXT NOT NULL DEFAULT 'student'` (DEFAULT classifies the ~10 Base Class rows as students with no data step; allowed set 'student'\|'teacher' enforced at app layer since SQLite can't ALTER-add a CHECK) + partial role index, and creates the new `cohort_cases` table (cohort↔case assignment, soft-delete, partial-unique on live (cohort_id,case_id) + cohort_id/case_id lookup indexes). Strictly additive: every column add is nullable or defaulted and the table is new — nothing dropped/renamed/narrowed; pre-migration code keeps working since it never selects these columns or touches the new table. |
| 0028 | `0028_oyon_records_gaze_engagement.sql` | additive | Oyon v2: two nullable JSON columns on `oyon_emotion_records` — `gaze_json` (zone shares, AOI dwell, centroid stats; aggregates only, never a raw point stream) and `engagement_json` (eye-openness/blink/on-task aggregates). The v1 ingest silently dropped these window blocks; the v2 Analyze dashboards need them server-side. Nullable ADD COLUMNs only — pre-migration code never selects them. |
| 0029 | `0029_oyon_records_room.sql` | additive | Oyon v2: nullable `room TEXT` on `oyon_emotion_records` — the simulator room active when the window was captured (stamped client-side by the capture widget). Feeds the per-room gaze breakdown in Settings → Oyon Learning Analytics → Gaze. Single nullable ADD COLUMN. |
| 0030 | `0030_cohort_case_windows.sql` | additive | Adds per-assignment date windows (`cohort_cases.available_from/until`, nullable = open) and enrollment lifecycle (`cohort_members.status` TEXT NOT NULL DEFAULT 'active', `enrolled_from/until` nullable) for enforced, date-scoped, class-centric case access, plus two partial live indexes for the enforcement JOIN. Strictly additive: every add is nullable or defaulted, nothing dropped/renamed/narrowed. Existing rows get open windows + `active` status, and the enforcement that reads these columns is gated behind the platform flag `enforce_cohort_case_access` (default OFF) — so applying this migration changes no behaviour until an admin opts in. `status` allowed set 'active'\|'completed'\|'dropped' enforced at the app layer (SQLite can't ALTER-add a CHECK). |
| 0032 | `0032_lessons.sql` | additive | Lessons (lectures + sections + progress) and surveys, bound to cohorts. Eight new tables (`lessons`, `lesson_sections`, `lesson_progress`, `surveys`, `cohort_surveys`, `survey_questions`, `survey_responses`, `survey_answers`) for the ported LAILA/chatoyon lesson authoring + survey feature. INTEGER PK autoincrement; INTEGER `cohort_id`/`tenant_id`/user FKs, non-cascading (soft-delete via `deleted_at`, matching 0025). Strictly additive: brand-new tables only, nothing existing altered. The source's `chatbot` section type is omitted (deferred). |
| 0031 | `0031_basic_course_default.sql` | additive | Data backfill — per tenant with a staff user, seeds one "Basic course" default class (owned by the tenant's lowest-id admin, else educator), assigns the tenant default case (`cases.is_default=1`) to it with open windows, and enrols every non-deleted user. This is the safety net for enforced case access: with the flag on, every user still has ≥ 1 case (the default) so nobody is locked out. Only INSERTs into cohorts/cohort_cases/cohort_members; no schema change; NOT EXISTS guards + 0025/0027 partial-uniques make it re-run-safe. Tenants with no admin/educator are skipped (NOT NULL owner FK). New users are enrolled post-migration by `ensureBasicCourseMembership()` on register/login. |

| 0033 | `0033_cohort_auto_enroll.sql` | additive | New defaulted `cohorts.auto_enroll INTEGER NOT NULL DEFAULT 0` flag + a data step setting it to 1 on the existing "Basic course" rows. Cohorts with `auto_enroll = 1` are the ones every tenant user is enrolled into on register/login (`ensureAutoEnrollMemberships`), replacing the hardcoded name match so the per-case dedicated courses (boot seed) get the same treatment. Existing teacher-made cohorts keep 0 = pre-migration behaviour; old code never reads the column. |

**To add a new migration**: append a row above. ID + filename match the SQL
file. Set `Type` per the policy. `Notes` is freeform — what changed and why
in one sentence.

**To mark a migration destructive**: change its `Type` and add a `Notes` line
explaining the multi-release path that led here (which previous release
introduced the new shape, which release backfilled, etc.).
