# Data model reference

> **Generated file — do not edit by hand.** Produced by `scripts/docs-gen/gen-data.mjs` from `server/db.js`, `migrations/0001_initial.sql` (the bootstrap schema) and all `migrations/*.sql`. Regenerate with `npm run docs:gen:data`.

**88 tables** in the durable data model.

> Note: `server/db.js` no longer holds inline `CREATE TABLE` DDL — it delegates to the migration runner. The canonical bootstrap schema is `migrations/0001_initial.sql`, treated here as the base schema. SQLite rebuild-scaffold tables (`*_new`/`*_old`) are intentionally excluded.

See [tables.md](./tables.md) for the per-table column reference.

## Cross-cutting conventions

These columns recur across many tables and carry platform-wide semantics (see `CLAUDE.md`):

| Convention | Column(s) | Meaning |
| --- | --- | --- |
| Soft-delete | `deleted_at` | Row is logically deleted when non-NULL. Most reads imply `deleted_at IS NULL`; physical purge is done by the retention sweep cron. |
| Tenant scoping | `tenant_id` | Multi-tenant isolation. Enforced by `requireSameTenant()` middleware, not ad-hoc `WHERE` clauses. |
| Audit / ownership | `created_by`, `created_at`, `updated_at` | Who authored the row and when; basis for ownership-based authz. |
| Snapshot binding | `*_snapshot` | Frozen copy taken at session start so later admin edits do not bleed into a live session. |

## Migration policy

Schema evolves only through versioned `migrations/*.sql`. Each migration is classified **additive** (previous-version code still runs) or **destructive** in `migrations/MANIFEST.md`, which `bin/rohy-update` reads to decide whether to auto-apply. Default is additive-only; destructive changes follow a multi-release dance.

Parsed **35 migration files** beyond the base schema (`0001_initial.sql`).

| Migration | Class | Note |
| --- | --- | --- |
| `0001_initial.sql` | additive | Initial schema bootstrap. |
| `0002_alarm_config_user_cascade.sql` | additive | Foreign key cascade addition. |
| `0003_role_hierarchy.sql` | additive | New role rows + index. |
| `0004_tenants.sql` | additive | Multi-tenant introduction. |
| `0005_retention.sql` | additive | Retention policy table. |
| `0006_tts_pitch_semitones.sql` | additive | New column with default. |
| `0007_drug_lab_catalogue.sql` | additive | Catalogue table seed. |
| `0008_audit_hash_chain.sql` | additive | Hash chain columns. |
| `0009_client_logs.sql` | additive | New table. |
| `0010_usage_budget.sql` | additive | Budget tracking columns. |
| `0011_oyon_addon.sql` | additive | Oyon emotion-record tables. |
| `0012_oyon_settings_runtime.sql` | additive | Runtime config columns. |
| `0013_oyon_settings_default_interval.sql` | additive | Default change only. |
| `0014_oyon_records_nullable_user.sql` | additive | Table rebuild — preserves all columns; widens NOT NULL to NULL. Old code still reads the same shape. |
| `0015_oyon_settings_safer_default.sql` | additive | Default change only. |
| `0016_oyon_records_unique_record_id.sql` | additive | Partial unique index. |
| `0017_oyon_records_window_metadata.sql` | additive | New columns with defaults. |
| `0018_learning_events_vitals.sql` | additive | New columns. |
| `0019_oyon_lower_min_valid_frames.sql` | additive | Default change only — backfills legacy 6 → 3 so analytics stop dropping windows on normal blinks. |
| `0020_clear_orus_patient_template_default.sql` | additive | Data fixup — removes the stale `en-US-Chirp3-HD-Orus` `case_voice` override from `is_default=1` patient templates. Targeted: only matches that exact value, so admin-picked voices are preserved. Idempotent (zero-row no-op on already-clean installs). |
| `0021_learning_events_room.sql` | additive | New `room` column on learning_events + partial index. Pairs with the RoomNavigator: every event carries the active in-session room ('chat', 'examination', 'lab', 'radiology', 'consultant'). Pre-migration rows + pre-room events stay NULL. |
| `0022_voice_surface_collapse.sql` | destructive | Reclassified from `additive` (2026-05-14 audit): the migration deletes rows from `platform_settings` and `cases` and overwrites `cases.config` / `agent_templates.config` for shipped cases. Predicate-based DELETE on user-authored tables without an FK guard is destructive per the policy above, even when the author believes "no operator has those rows." Operators on a version that already applied this migration are unaffected (data is gone); operators upgrading past it now go through the `--allow-destructive` gate. Concretely: (a) Deletes zombie `voice_*`/`piper_voice_*`/`default_voice_*` settings rows from platform_settings. (b) Strips `tts_provider`/`tts_rate`/`tts_pitch` from `cases.config.voice` and `tts_provider` from `agent_templates.config.voice`. (c) Clears non-Kokoro `case_voice` values. (d) Overwrites Kokoro voices on shipped cases 1–6. (e) Removes ~55 test-fixture cases by name pattern with no `WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE case_id = cases.id)` guard. |
| `0023_clamp_turnaround_to_5min.sql` | additive | Data-only normalisation. Clamps `case_investigations.turnaround_minutes` to the 1–5 minute band the sim uses after the turnaround cleanup (kills 30 / 60 / 240 / 2880 / 10080 minute waits seeded before the clamp). Schema unchanged — old code can still read these rows; only the column values move. Authors who deliberately need a longer wait can re-set via the case wizard. |
| `0024_agent_arrives_at.sql` | additive | New nullable `arrives_at` column on `agent_session_state`. Anchors the paged → present timer on the server clock so the wait survives refreshes / room hops; pairs with the 1–3 minute clamp in the page handler. Old code that doesn't read this column keeps working — null on every row at migration time. |
| `0025_cohorts.sql` | additive | Two new tables for teacher-owned cohorts: `cohorts` (teacher-owned class with optional join_code) + `cohort_members` (student membership). Partial unique indexes (live join_code, live cohort_id+user_id) plus owner/tenant/lookup indexes. Strictly additive — nothing on existing tables changes; pre-migration code never touches these tables. No endpoints/UI yet (Phase 2 = schema only). |
| `0026_base_class_backfill.sql` | additive | Data backfill — per tenant with sessions, seeds one "Base Class" cohort (owned by that tenant's lowest-id admin, else educator) and enrolls every distinct user with a live session, so pre-feature activity is visible in the teacher dashboard out of the box. Only INSERTs into cohorts/cohort_members; no schema change; NOT EXISTS guards + 0025 partial-uniques make it re-run-safe. Tenants with sessions but no admin/educator are skipped (NOT NULL owner FK). |
| `0027_cohort_entity.sql` | additive | Fleshes out the cohort entity. Adds 4 nullable `cohorts` columns (`description TEXT`, `starts_at DATETIME`, `ends_at DATETIME`, `settings JSON`), adds `cohort_members.member_role TEXT NOT NULL DEFAULT 'student'` (DEFAULT classifies the ~10 Base Class rows as students with no data step; allowed set 'student'\\|'teacher' enforced at app layer since SQLite can't ALTER-add a CHECK) + partial role index, and creates the new `cohort_cases` table (cohort↔case assignment, soft-delete, partial-unique on live (cohort_id,case_id) + cohort_id/case_id lookup indexes). Strictly additive: every column add is nullable or defaulted and the table is new — nothing dropped/renamed/narrowed; pre-migration code keeps working since it never selects these columns or touches the new table. |
| `0028_oyon_records_gaze_engagement.sql` | additive | Oyon v2: two nullable JSON columns on `oyon_emotion_records` — `gaze_json` (zone shares, AOI dwell, centroid stats; aggregates only, never a raw point stream) and `engagement_json` (eye-openness/blink/on-task aggregates). The v1 ingest silently dropped these window blocks; the v2 Analyze dashboards need them server-side. Nullable ADD COLUMNs only — pre-migration code never selects them. |
| `0029_oyon_records_room.sql` | additive | Oyon v2: nullable `room TEXT` on `oyon_emotion_records` — the simulator room active when the window was captured (stamped client-side by the capture widget). Feeds the per-room gaze breakdown in Settings → Oyon Learning Analytics → Gaze. Single nullable ADD COLUMN. |
| `0030_cohort_case_windows.sql` | additive | Adds per-assignment date windows (`cohort_cases.available_from/until`, nullable = open) and enrollment lifecycle (`cohort_members.status` TEXT NOT NULL DEFAULT 'active', `enrolled_from/until` nullable) for enforced, date-scoped, class-centric case access, plus two partial live indexes for the enforcement JOIN. Strictly additive: every add is nullable or defaulted, nothing dropped/renamed/narrowed. Existing rows get open windows + `active` status, and the enforcement that reads these columns is gated behind the platform flag `enforce_cohort_case_access` (default OFF) — so applying this migration changes no behaviour until an admin opts in. `status` allowed set 'active'\\|'completed'\\|'dropped' enforced at the app layer (SQLite can't ALTER-add a CHECK). |
| `0031_basic_course_default.sql` | additive | Data backfill — per tenant with a staff user, seeds one "Basic course" default class (owned by the tenant's lowest-id admin, else educator), assigns the tenant default case (`cases.is_default=1`) to it with open windows, and enrols every non-deleted user. This is the safety net for enforced case access: with the flag on, every user still has ≥ 1 case (the default) so nobody is locked out. Only INSERTs into cohorts/cohort_cases/cohort_members; no schema change; NOT EXISTS guards + 0025/0027 partial-uniques make it re-run-safe. Tenants with no admin/educator are skipped (NOT NULL owner FK). New users are enrolled post-migration by `ensureBasicCourseMembership()` on register/login. |
| `0032_lessons.sql` | additive | Lessons (lectures + sections + progress) and surveys, bound to cohorts. Eight new tables (`lessons`, `lesson_sections`, `lesson_progress`, `surveys`, `cohort_surveys`, `survey_questions`, `survey_responses`, `survey_answers`) for the ported LAILA/chatoyon lesson authoring + survey feature. INTEGER PK autoincrement; INTEGER `cohort_id`/`tenant_id`/user FKs, non-cascading (soft-delete via `deleted_at`, matching 0025). Strictly additive: brand-new tables only, nothing existing altered. The source's `chatbot` section type is omitted (deferred). |
| `0033_cohort_auto_enroll.sql` | additive | New defaulted `cohorts.auto_enroll INTEGER NOT NULL DEFAULT 0` flag + a data step setting it to 1 on the existing "Basic course" rows. Cohorts with `auto_enroll = 1` are the ones every tenant user is enrolled into on register/login (`ensureAutoEnrollMemberships`), replacing the hardcoded name match so the per-case dedicated courses (boot seed) get the same treatment. Existing teacher-made cohorts keep 0 = pre-migration behaviour; old code never reads the column. |
| `0034_voice2_provider_follows_voice.sql` | additive | Voice 2.0 settings retirement (data-only, no schema change, re-run-safe). Carries an unambiguous legacy `default_voice_kokoro_*` value into `tts_default_voice_en`, then DELETEs the retired rows: `tts_provider` (the engine is now derived per voice by exact catalogue membership — VOICE2_PLAN.md), the gendered `default_voice_&lt;provider&gt;_&lt;gender&gt;` family, and any recreated `voice_&lt;provider&gt;_&lt;gender&gt;` slot rows (gender-suffix GLOBs on purpose — a bare `voice_%` would hit `voice_mode_enabled`). Case/persona `case_voice` values untouched. The new keys (`tts_default_voice_&lt;lang&gt;`, `tts_provider_enabled_&lt;p&gt;`) are seeded idempotently by boot code, not here. |
| `0035_case_code.sql` | additive | Visible language-bearing case identifier: new nullable `cases.case_code TEXT` + partial unique index, backfilled as `&lt;LANG&gt;-&lt;zero-padded id&gt;` (numeric part = the untouched integer PK, so unique by construction). Also pins the now-immutable case language: `config.case_language` is normalized to a concrete registry code (absent/empty/unknown → `'en'`; a case never "follows the student's UI language" anymore). Malformed-JSON configs are left untouched and coded `EN-…`. Rows inserted after migrations (fresh-DB seeders) are stamped by the `ensureCaseCodes()` boot sweep. |
| `0036_user_onboarding_settings.sql` | additive | Per-user onboarding/first-run prefs: one nullable `user_preferences.onboarding_settings JSON` column (`first_run_done`, `voice_mode`, `oyon_consent`). NULL = never onboarded, so every existing user sees the new first-run screen once (deliberate — it surfaces the previously silent emotion-capture consent). Single nullable ADD COLUMN; pre-migration code never selects it. |

## Tables by concern

### Auth & users

`active_sessions`, `login_logs`, `user_preferences`, `users`

### Tenants

`tenants`

### Cases & scenarios

`case_versions`, `cases`, `clinical_pathways`, `diagnoses`, `patient_information`, `patient_record_documents`, `patient_record_events`, `scenario_events`, `scenario_templates`, `scenario_timeline_points`, `scenarios`

### Sessions

`clinical_notes`, `interactions`, `session_notes`, `session_settings`, `session_vitals`, `sessions`

### Investigations & labs

`body_map_coordinates`, `body_regions`, `case_investigations`, `custom_lab_group_items`, `custom_lab_groups`, `exam_techniques`, `investigation_orders`, `investigation_parameters`, `investigation_templates`, `investigation_views`, `lab_definitions`, `lab_panels`, `lab_reference_ranges`, `lab_tests`, `panel_tests`, `physical_exam_findings`, `region_default_findings`, `region_exam_types`, `region_special_tests`, `vital_sign_definitions`, `vital_sign_history`

### Treatments & medications

`active_treatments`, `case_treatments`, `custom_drug_group_items`, `custom_drug_groups`, `data_sources`, `medication_doses`, `medications`, `search_aliases`, `treatment_effects`, `treatment_orders`

### Agents

`agent_conversations`, `agent_session_state`, `agent_templates`, `case_agents`, `team_communications_log`

### Cohorts

`cohort_cases`, `cohort_members`, `cohorts`

### Analytics & events

`emotion_logs`, `event_log`, `export_records`, `learning_events`, `questionnaire_responses`

### LLM & TTS usage

`llm_model_pricing`, `llm_request_log`, `llm_usage`, `tts_usage`, `usage_budget`

### Oyon (emotion add-on)

`oyon_emotion_consents`, `oyon_emotion_records`, `oyon_settings`

### Alarms

`alarm_config`, `alarm_events`

### Observability & audit

`client_logs`, `settings_logs`, `system_audit_log`

### Platform & retention

`platform_settings`

### Other

`cohort_surveys`, `lesson_progress`, `lesson_sections`, `lessons`, `survey_answers`, `survey_questions`, `survey_responses`, `surveys`

---

_Regenerate: `npm run docs:gen:data`_
