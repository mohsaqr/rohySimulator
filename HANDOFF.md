# Session Handoff — 2026-05-05

## Stage E7 (Soft delete + retention policy) — IMPLEMENTED this session

Inventory pass:
- **Soft-delete**: `cases`, `sessions`, `agent_templates`, `scenarios`,
  `medications`, `case_investigations`, `lab_definitions`, and
  `clinical_notes`.
- **Hard-delete on purge**: `user_preferences`, `active_sessions`,
  `alarm_config`, `session_notes`, `questionnaire_responses`,
  `export_records`, `llm_usage`, and `tts_usage`.
- **Retain N days, then purge**: `event_log`, `learning_events`,
  `interactions`, `system_audit_log`, `alarm_events`, and
  `llm_request_log`.
- **Always retain/anonymized**: `users` as the tenant ownership anchor and
  `tenants`; immutable case-version history keeps `changed_by` pointing to
  the anonymized retained user row.

Implementation:
1. **Migration** — `migrations/0005_retention.sql` adds missing
   `deleted_at` columns to soft-delete tables, indexes all soft-delete
   columns, adds retention time indexes, rebuilds `users.email` as nullable
   for purge anonymization, and rebuilds `llm_request_log.user_id` as nullable
   for retained-log anonymization.
2. **Soft-delete reads** — cases, scenarios, case investigations, medications,
   and agent templates now filter `deleted_at IS NULL` on live reads. Deletes
   for scenarios, medications, case labs, and agent templates now set
   `deleted_at` instead of hard-deleting the parent row.
3. **Purge endpoint** — `POST /api/users/:id/purge` is admin-only and
   same-tenant only. `?dry-run=true` returns cascade counts without writes.
   The destructive path writes `purge_user` to `system_audit_log` before
   mutation, then soft-deletes user-authored domain rows, hard-deletes
   ephemeral rows, nulls user ids in retained time-bounded logs, and
   anonymizes/deactivates the retained `users` row as `deleted_user_<id>`.
4. **Retention sweep** — `scripts/retention-sweep.js` deletes old rows from
   time-bounded tables. Default retention is 90 days; override with
   `ROHY_RETENTION_SECONDS`, `RETENTION_SECONDS`, `ROHY_RETENTION_DAYS`,
   `RETENTION_DAYS`, or platform settings `retention_days` /
   `log_retention_days`. Cron pattern for deployment:
   `0 3 * * * cd /path/to/rohySimulator && ROHY_DB=/path/to/database.sqlite node scripts/retention-sweep.js >> /var/log/rohy-retention.log 2>&1`
   Do not install this cron from the repo; platform ops owns scheduling.
5. **Audit** — `scripts/audit-retention.sh` covers schema, case soft-delete,
   purge dry-run, purge execution, and retention sweep.

Verification completed locally: `node --check server/routes.js`,
`node --check scripts/retention-sweep.js`, `bash -n scripts/audit-retention.sh`
plus representative prior script syntax checks, fresh throwaway DB startup
through all migrations + seeders until the sandbox blocked listener binding,
`scripts/audit-migrations.sh` 4/4, `scripts/retention-sweep.js` no-op on a
throwaway DB, and `npx vite build` (large-chunk warning only). The sandbox
blocked binding a local test listener (`EPERM` on port 3997), and
`localhost:3000` was not listening, so HTTP end-to-end audit scripts could not
run here. A fresh orchestrator server restart is required to load the new route
and migration before running `scripts/audit-retention.sh`.

Deferred: purge GUI, data-export-on-purge, cross-tenant/super-admin erasure,
legal-hold flags, tenant deletion semantics, and Postgres portability of the
SQLite-specific retention SQL.

## Stage E6 (Multi-tenant readiness) — SHIPPED this session

Inventory pass:
- **Tenant-scoped**: `users`, `cases`, `sessions`, `interactions`,
  `login_logs`, `settings_logs`, `session_settings`, `event_log`,
  `alarm_events`, `alarm_config`, `case_investigations`,
  `investigation_orders`, `scenarios`, `learning_events`,
  `physical_exam_findings`, `patient_information`, `case_versions`,
  `system_audit_log`, `vital_sign_history`, `export_records`,
  `active_sessions`, `scenario_events`, `user_preferences`,
  `clinical_notes`, `llm_usage`, `llm_request_log`,
  `patient_record_events`, `patient_record_documents`, `agent_templates`,
  `case_agents`, `agent_conversations`, `agent_session_state`,
  `team_communications_log`, `treatment_orders`, `active_treatments`,
  `case_treatments`, `emotion_logs`, `questionnaire_responses`,
  `tts_usage`, `session_notes`, and `session_vitals`.
- **Global**: platform settings and shipped/master catalogs such as
  lab/radiology/master medication/investigation/diagnosis/vital/body-map
  catalogs, scenario templates/timelines, search aliases, pricing, and
  treatment effects.

Implementation:
1. **Migration** — `migrations/0004_tenants.sql` creates `tenants`, seeds
   `slug='default'`, adds `tenant_id INTEGER NOT NULL DEFAULT 1` to the
   tenant-scoped inventory, and adds tenant-prefixed hot-path indexes.
   Tenant delete semantics are application-RESTRICT/deferred because SQLite
   cannot add a non-null FK default via `ALTER TABLE`, and destructive tenant
   deletion needs the E7 retention decision.
2. **Middleware** — `authenticateToken` refreshes role/status/tenant from
   `users`, attaches `req.user.tenant_id`, and token generation includes the
   tenant. `resolveTenant(req)` and `requireSameTenant()` are exported from
   `server/middleware/auth.js`.
3. **Route scoping** — high-risk cases/sessions/users/interactions/learning
   events/investigation orders/alarms/settings logs/audit logs/active sessions
   paths now filter by `req.user.tenant_id`; inserts use the authenticated
   tenant and ignore body-supplied `tenant_id`.
4. **Tenant management shell** — `POST /api/tenants` creates a tenant and
   `POST /api/users/:id/tenant` is a minimal assignment hook. Both audit
   `oldValue.tenant_id`/`newValue.tenant_id`.
5. **Seed** — default admin/student continue to seed into tenant 1.
6. **Audit** — `scripts/audit-tenant.sh` verifies default tenant schema,
   two-tenant case/session/active-session isolation, mass-assignment
   resistance, and tenant audit rows.

Verification completed locally: `node --check server/routes.js`,
`node --check server/middleware/auth.js`, `bash -n scripts/audit-tenant.sh`,
fresh `ROHY_DB=/tmp/rohy-e6-fresh.sqlite` migration+seed initialization
through server startup, and `npx vite build` (large-chunk warning only).
The sandbox blocked binding a local test listener (`EPERM` on port 3999), so
`scripts/audit-tenant.sh` could only run its DB assertions here; end-to-end
HTTP validation still needs the orchestrator-managed API server.

Deferred: cross-tenant super-admin views, tenant deletion/retention semantics,
per-tenant rate limits/billing/LLM API keys, subdomain/header routing,
full user/resource tenant migration tooling, and tenant-local username/email
uniqueness.

## Stage E5 (Data classification + redaction policy) — SHIPPED this session

Inventory pass:
- **Secrets, never returned raw**: `users.password_hash`;
  `active_sessions.token_hash`; `agent_templates.llm_api_key`;
  `platform_settings.setting_key` values matching `*_api_key`, `*_secret`,
  or `*_token` such as `llm_api_key`, `google_tts_api_key`,
  `openai_tts_api_key`; JSON keys `apiKey`, `api_key`, `llm_api_key`,
  `password`, `secret`, `token` inside `sessions.llm_settings`,
  `sessions.monitor_settings`, `user_preferences.default_llm_settings`,
  `user_preferences.default_monitor_settings`,
  `user_preferences.notification_settings`, `session_settings.settings_snapshot`,
  `settings_logs.settings_json`, and `system_audit_log.old_value/new_value/metadata`.
- **PII, role/scope controlled**: `users.email`, `alternative_email`,
  `phone`, `address`, `name`, `education`, `grade`, plus response aliases
  `user_email` and `student_name`. Admin/educator/reviewer routes that are
  explicitly cross-user keep permitted PII; student cross-user reads remain
  denied or redact aliases if exposed by a scoped endpoint.
- **Internal, hidden from non-admin where exposed**: `users.role_rank`,
  creator/updater identifiers such as `created_by`, `updated_by`,
  scenario creator ids, and raw audit/settings payload internals. Admin audit
  readers can see metadata after recursive secret redaction.

Implementation:
1. **Central helper** — `server/redaction.js` owns
   `RESPONSE_REDACTION_POLICY`, `redactRow()`, `redactRows()`,
   `redactJsonColumn()`, `redactPlatformSettingRows()`, and
   `redactAuditPayload()`.
2. **Chosen integration** — per-route helpers, not a global `res.json`
   interceptor. This is deliberate: `POST /api/proxy/llm` streams SSE when
   `Accept: text/event-stream` and must not be intercepted.
3. **Known fixes migrated** — `GET /sessions/:id` and
   `GET /users/preferences` now call the helper; behavior remains
   `apiKey`/`api_key` -> `[redacted]`.
4. **Swept offenders** — applied redaction to session analytics, complete
   session/session-settings/settings-log exports, settings/audit log reads,
   active-session reads, dedicated and generic platform-setting reads,
   scenarios' internal creator ids, and agent-template `llm_api_key` reads.
5. **Audit boundary** — audit `oldValue`/`newValue`/`metadata` are redacted
   before persistence via the shared helper. Audit-log GET also redacts
   defensively on read.
6. **New script** — `scripts/audit-redaction.sh` covers 5+ endpoints:
   `/sessions/:id`, `/users/preferences`, `/users/:id`,
   `/analytics/sessions/:id`, `/agents/templates/:id`,
   `/platform-settings`, and `/admin/active-sessions`.

Policy for new endpoints: if a route returns rows touching the classes above,
declare the intended scope and call `redactRow()`/`redactRows()` at the response
boundary. JSON settings columns should go through `redactJsonColumn()` even
when the column name is innocuous.

Verification completed locally: `node --check server/redaction.js`,
`node --check server/routes.js`, `bash -n scripts/audit-redaction.sh`,
`bash -n` across all `scripts/audit-*.sh`, and `npx vite build` (large-chunk
warning only). End-to-end audit scripts require the managed API server; this
run did not restart `:3000`, and `localhost:3000` was not listening.

Deferred: column-level encryption at rest, request-side classification, GDPR
right-to-erasure, and broader failed-access telemetry.

## Stage E4 (Audit-log coverage) — SHIPPED this session

Mission inventory found previously uncovered sensitive mutations in:
user create/delete and admin reads; case availability/default/labs/treatments;
scenario create/update/delete/seed; alarm threshold writes; lab JSON catalog
add/update/delete/import/reload; master lab-test and medication writes;
platform-settings writes; notification/user preference writes; case-agent
assignment writes; and agent-template duplicate/update metadata gaps. Password
change, admin role/password change, case create/update/delete, case restore,
agent-template create/update/delete/reset, and force logout already had partial
coverage.

Key fixes:
1. **Central helpers** — `logAudit()` now accepts `targetType/targetId`
   aliases as well as `resourceType/resourceId`, warns on failed audit writes,
   and is wrapped by `auditSuccess(req, ...)` for request identity/IP/user-agent.
   Platform settings use `setAuditedPlatformSetting()` so every key write logs
   old/new values without repeating route boilerplate.
2. **Expanded write coverage** — added audit rows for case lifecycle adjuncts,
   case labs/treatments/agents, scenario lifecycle, alarm config, lab catalog,
   master lab/medication catalog, user/preferences/notification prefs, agent
   template lifecycle gaps, and platform settings.
3. **Read-side coverage** — admin cross-user reads now log representative
   sensitive access (`GET /users/:id`, cross-user
   `GET /learning-events/detailed/:sessionId`). Own-data reads do not log.
4. **Audit reader alias** — `GET /api/system-audit-log` is an admin-only alias
   for `/api/admin/audit-log`, preserving the existing admin requirement.
5. **New audit script** — `scripts/audit-auditlog.sh` performs representative
   admin mutations and verifies expected action rows plus populated
   `old_value`/`new_value` fields.

Audit boundary / explicit non-logging policy:
- GET reads of a user's own data do not log to avoid noise.
- Runtime learner telemetry such as chat messages, learning events, vitals,
  physical exam findings, alarm event creation, LLM usage, TTS usage, and
  patient-record events keep using their domain tables/logs.
- Failed authorization attempts are not audit-logged in E4 because
  `requireRole()` blocks before route handlers run. That can be centralized
  later if enterprise wants failed-access telemetry.
- API keys/secrets are redacted before platform-setting audit payloads.

Verification completed locally: `node --check server/routes.js`,
`bash -n scripts/audit-auditlog.sh`, and `npx vite build`.
`scripts/audit-auditlog.sh` was not run end-to-end because no API server was
listening on `localhost:3000` and this stage must not start/restart the
orchestrator-managed server.

## Stage E3 (RBAC role hierarchy) — SHIPPED this session

The binary admin/student model is now a five-rank hierarchy:
`guest(0) < student(1) < reviewer(2) < educator(3) < admin(4)`.

Key fixes:
1. **Role hierarchy migration** —
   `migrations/0003_role_hierarchy.sql:1` rebuilds `users` with the
   five-value role CHECK enum plus generated `role_rank`, maps legacy
   `user` rows to `student`, preserves passwords/profile columns, and
   recreates user indexes including `idx_users_role_rank`.
2. **Central enforcement** — `server/middleware/auth.js:39` owns
   `ROLE_RANKS`, role normalization, rank comparison, `requireRole()`,
   and the four convenience wrappers. `server/routes.js` now uses those
   helpers for conditional ownership/admin branches.
3. **Registration + admin user management** — self-registration defaults
   to `student`; only the first user can self-register as `admin`; admin
   user creation validates the enum; role grants above the actor's rank
   are rejected; role transitions continue to audit `oldValue.role` and
   `newValue.role`.
4. **Reviewer/educator split** — reviewer can read representative
   analytics/catalog surfaces but cannot write; educator can author
   cases/catalog content but remains blocked from `requireAdmin`
   platform/user/audit surfaces.
5. **RBAC audit** — `scripts/audit-rbac.sh:1` covers invalid roles,
   student IDOR denial, reviewer read-only access, educator non-admin
   authoring, admin-only gates, admin retained access, and self-escalation
   denial.

Verification target: prior 10 audit scripts (79/79),
`audit-rbac.sh`, `npx vite build`, existing-DB boot applying `0003`, and
fresh `ROHY_DB=/tmp/rohy-e3-fresh.sqlite` boot applying `0001`+`0002`+`0003`.

Deferred:
- **Per-resource permissions**: E3 intentionally stops at role hierarchy
  and centralized rank checks. Case/session/resource-specific grants
  remain a later enterprise stage.
- **Legacy `user` spelling**: accepted only as an in-code normalization
  alias for old tokens/data; the database enum and seed data now store
  `student`.

## Stage E2 (Migration framework) — SHIPPED this session

SQLite schema creation is now owned by versioned migrations instead of the
large ad-hoc `db.serialize()` bootstrap.

Key fixes:
1. **Migration runner** — `server/migrationRunner.js:53` discovers sorted
   SQL files, tracks `schema_migrations(version, name, applied_at,
   checksum)`, verifies checksums, runs pending files once, and supports
   dry-run printing without mutation.
2. **Boot integration** — `server/db.js:11` supports `ROHY_DB`;
   `server/db.js:987` runs migrations before the existing seed/default
   routines; `server/server.js:166` awaits `dbReady` before seeders and
   treats migration failures as startup-fatal.
3. **Baseline schema** — `migrations/0001_initial.sql:1` captures the
   pre-E2 schema. Existing fully-initialized DBs are baseline-stamped for
   `0001` only (`server/migrationRunner.js:105`), so retroactive rebuild
   migrations still apply.
4. **Retroactive FK rebuild** —
   `migrations/0002_alarm_config_user_cascade.sql:4` rebuilds
   `alarm_config` with `ON DELETE CASCADE` on `user_id`, copies rows, and
   recreates `idx_alarm_config_user_vital`.
5. **Manual + audit entry points** — `scripts/migrate.js:1` exposes
   `node scripts/migrate.js [--dry-run]`; `scripts/audit-migrations.sh:87`
   verifies migration table state, dry-run immutability, no-op reruns, and
   the alarm-config cascade.

Verification target: prior 9 audit scripts (75/75), `audit-migrations.sh`,
`npx vite build`, clean boot, and fresh-DB smoke.

Deferred:
- **E2.1 rollback commands**: migration tracking is forward-only for now;
  individual down migrations/rollback orchestration are intentionally out of
  scope for E2.
- **Seeder refactor**: default pricing, agents, treatment effects, and
  avatar defaults still live in `server/db.js`; moving them into seed
  modules remains separate cleanup.
- **E8 portability**: migrations are SQLite-specific and intentionally use
  SQLite rebuild/copy semantics.

## Stage E1 (Schema integrity sweep) — SHIPPED previous session

SQLite schema sweep completed across `server/db.js` and hard-delete
handlers in `server/routes.js`.

Key fixes:
1. **Hard user delete orphan risk** — `DELETE /users/:id` now removes
   user-owned dependents (`user_preferences`, `active_sessions`,
   `session_notes`, questionnaire/clinical/export/usage rows) and
   detaches nullable audit/history references before deleting the user.
2. **Hard medication delete orphan risk** — `DELETE
   /master/medications/:id` and `/all` now delete `medication_doses` and
   set medication FKs to NULL in `treatment_effects`,
   `treatment_orders`, and `case_treatments`.
3. **Fresh-schema FK intent** — obvious session/case/user child tables
   now declare `ON DELETE CASCADE` or `ON DELETE SET NULL` where the data
   semantics are clear. Existing DBs still need E2 migrations for true
   in-place FK rebuilds.
4. **Missing-index sweep** — added indexes only for columns already used
   in route WHERE/JOIN/delete paths: `investigation_orders.investigation_id`,
   `case_investigations(case_id, investigation_type)`, settings/session
   log parents, `event_log` parents, `alarm_config(user_id, vital_sign)`,
   `case_agents.agent_template_id`, and treatment medication FKs.
5. **New audit script** — `scripts/audit-schema.sh` covers lab orders,
   agent/case-agent cleanup, patient record events/documents, medication
   dependents, and user-owned dependents.

Verification target: `audit-schema.sh` plus the prior 8 audit scripts,
`npx vite build`, and a clean `node server/server.js` boot smoke.

Deferred:
- **E2 migration framework**: existing SQLite tables cannot have FK
  `ON DELETE` clauses altered in place. A safe rebuild/copy/drop
  migration system should own retroactive FK enforcement.
- **E7 retention policy**: historical audit/analytics rows are preserved
  or detached instead of globally cascaded on parent deletion. Retention
  and right-to-erasure semantics need a platform policy before broader
  deletes.

## All 9 stages complete

The staged audit roadmap is now complete. Summary:

| Stage | Severity | Status | Key fixes |
|---|---|---|---|
| 1 | HIGH | ✅ | Snapshot at session start, idempotent /end, vitals persistence |
| 2 | HIGH | ✅ | UPSERT POST/labs, bulk PUT/labs replace, DELETE cascade, /order-* idempotent |
| 3 | HIGH | ✅ | Ack IDOR + idempotency, cross-user config read fix, transient-state clear |
| Sweep | — | ✅ | orders/:id/view IDOR + idempotency (Stage-2 outlier) |
| 4 | MED | ✅ | Agent layer temp/max_tokens, system_prompt in snapshot, apiKey redaction |
| 5 | MED | ✅ | Scenario engine snapshot, override guard extended, auto-stop, frame validation |
| 6 | MED | ✅ | exam-findings idempotent, ManikinPanel snapshot-bound, delete confirms |
| 7 | LOW | ✅ | apiKey redaction in user-prefs, audit log on password/role, ScenarioRepo isAdmin |
| 8 | LOW | ✅ | Two IDOR fixes on learning-events read endpoints |
| 9 | LOW | ✅ | Closed — no body-avatar concept exists |

## Stage 8 (TNA analytics + event log) — SHIPPED this session

Two Explore agents reviewed TNA + body avatars. 0 false positives.

1. **GET /learning-events/detailed/:sessionId IDOR** (HIGH for a read
   endpoint) — pre-fix any user could dump another's event log + lab
   orders + chat messages.
2. **GET /learning-events/analytics/summary partial guard** — the
   `user_id` branch was ownership-checked; the `session_id` branch
   wasn't. Now both are guarded.

Verification: `audit-tna.sh` 6/6. All prior stages green.
**68/68 across all stages.** Browser smoke clean.

**Deferred (uncertain blast radius)**: TNA aggregation includes
in-progress sessions (Stage 1's status transition exists but TNA
doesn't filter). Including in-progress in dashboards may be intentional
for live monitoring; defer until a real complaint surfaces.

## Stage 9 (Body avatars) — CLOSED, no scope

Definitive answer: avatar rendering is head-only.
- `frontend/avatars/` has only `heads/` (no `bodies/`).
- `VOICE_AVATAR_TYPES = ['3d_head', 'none']` (`routes.js:7309`).
- `PatientAvatar` renders only head geometry.
- `BodyMap` is a 2D SVG silhouette for physical-exam region selection,
  not a 3D body avatar.
- Stage 0's persona/voice/avatar audit was head-only by design.

If a future feature adds full-body avatars, audit then.

## Stage 7 (Auth + user preferences) — SHIPPED previous session, COMMITTED

Two Explore agents reviewed auth + prefs. 0 false positives. Real
fixes shipped:

1. **GET /users/preferences leaked apiKey** (HIGH) — Stage 4 fixed
   the same shape on /sessions/:id but missed this twin endpoint.
   `SELECT *` echoed `default_llm_settings.apiKey` verbatim. Now
   redacted to `[redacted]` before responding.
2. **Password-change paths missing audit log** (HIGH) — both
   `PUT /user/password` (self-service) and `PUT /users/:id` (admin)
   now call `logAudit()` on success. Admin-side captures `oldValue.role`
   so escalation events are auditable.
3. **ScenarioRepository.isAdmin always false** (LOW) — was reading
   `localStorage.user` (never populated by login). Switched to
   `useAuth()`. Admins now see the admin UI in scenario repository.

Stage-4 follow-on **resolved as false alarm**: the "user-layer LLM
resolver wiring deferred" was incorrect. User prefs ARE read at
session-start (line 1164) and merged into sessions.llm_settings. Runtime
doesn't need to re-read them.

Verification: `audit-auth.sh` 3/3. All prior stages green.
**62/62 across all stages.** Browser smoke clean.

**Not bugs / intentional**: "first user becomes admin" registration;
no forgot-password endpoint (no email integration).

## Stage 6 (Physical exam + body map) — SHIPPED previous session, COMMITTED

Three Explore agents reviewed the physical-exam subsystem. 0 false
positives. Real fixes shipped:

1. **POST /sessions/:id/exam-findings idempotency** (MED) — keyed on
   `(session_id, body_region, exam_type)`. Pre-fix retries doubled the
   row and the counter.
2. **ManikinPanel snapshot binding** (HIGH, Stage-1 follow-on) — App
   now owns a `caseSnapshot` state and passes it down. Snapshot binding
   is now a structural property at three call sites (chat, scenario,
   physical exam).
3. **ClinicalRecordsEditor delete confirms** (cheap MED) —
   medications / procedures / notes now confirm before deleting if the
   row has any data. Last unprotected destructive surface in the case
   wizard.

Verification: `audit-physexam.sh` 6/6. All prior stages green.
**59/59 across all stages.** Browser smoke clean.

**Deferred (architectural)**:
- Two parallel physical-exam schemas (`clinicalRecords.physicalExam`
  free-text vs `config.physical_exam` region×exam grid). Bidirectional
  reconciliation needs schema unification and dual-write logic.
- Server-side enforcement of `aiAccess.physicalExam` toggle (same
  shape as the `memory_access` server enforcement deferred from
  Stage 4).

## Stage 5 (Scenario engine runtime) — SHIPPED previous session, COMMITTED

Three Explore agents reviewed the scenario engine state machine,
persistence/snapshot interactions, and admin/runtime UX. **1 false
positive** (FP rate ~8%). Real fixes shipped:

1. **Snapshot binding for the scenario engine** (HIGH, Stage-1
   follow-on) — `PatientMonitor` now mirrors the Stage-4 chat fix:
   fetches `/api/sessions/:id` once on mount and uses
   `case_snapshot.scenario` for the timeline source. Pre-fix the engine
   read `caseData.scenario` (live React state).
2. **Override guard extended beyond rhythm** (HIGH) — every key the
   scenario can mutate (params, conditions, discrete switches) is now
   stripped against `overriddenVitalsRef` before apply. Pre-fix only
   `rhythm` was guarded; learner manual edits to HR/SpO2/etc were
   clobbered every beat.
3. **Auto-stop on scenario complete** (MED) — engine schedules
   `setScenarioPlaying(false)` via `setTimeout(..., 0)` once `nextTime`
   passes the last frame by 2s. Pre-fix the engine held the last frame
   forever; `scenarioTime` ticked toward infinity.
4. **Scenario picker confirm** (HIGH UX) — repository import path now
   confirms before clobbering an existing case scenario. Stage 2 added
   the same guard for the in-wizard picker; this was the outlier.
5. **Server-side timeline frame validation** (MED) — POST/PUT
   `/scenarios` reject malformed frames (negative time, non-numeric
   params, non-object frames). Pre-fix the runtime interpolator hit
   `NaN` or unknown rhythm strings.
6. **Aria-label on play/pause button** (cheap MED, a11y).

Verification: `audit-scenario.sh` 7/7. `audit-llm.sh` 7/7.
`audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17.
`audit-sessions.sh` 9/9. **53/53 across all stages.** Browser smoke on
`:5173`: simulator mounts, no error-boundary fires.

**Deferred (architectural / speculative)**:
- Beat-skipping under load (`setInterval` drift, no `performance.now()`
  rebase) — speculative.
- Scenario-disable mid-run banner (admin removes scenario from case
  config; engine no-ops cleanly but no UX cue).
- Server-side timeline scaling (`scaleScenarioTimeline` runs only
  client-side; concurrent admin edits could drift).
- PUT /scenarios idempotency marker (`already_updated:true`) — minor.
- Master/copy distinction UI label on imported scenarios.

## Stage 4 (LLM precedence chain) — SHIPPED previous session, COMMITTED

Three Explore agents reviewed the platform → case → agent → session →
user resolver. **0 false positives** (FP rate 30 → 18 → 11 → 0 → 0%).
Real fixes shipped:

1. **Agent `temperature` + `max_tokens` silently dropped** (HIGH) —
   `agent_templates` had no columns for these; resolver SELECT only
   pulled provider/model/api_key/endpoint. Admins setting them in any
   prior UI were quietly ignored. Added the two columns + resolver path
   uses `agent ?? session ?? platform` (nullish coalescing because `0`
   is a valid temperature). PUT/POST endpoints accept the new fields.
2. **Chat persona drifted with live admin edits** (HIGH, Stage-1
   follow-on) — `case_snapshot` captured config+scenario+name only, not
   `system_prompt`. ChatInterface's `buildPatientSystemPrompt` read live
   `activeCase.system_prompt`. Now snapshot includes it; ChatInterface
   fetches `/api/sessions/:id` once on mount and freezes the result.
3. **GET /sessions/:id echoed `apiKey`** (MED) — the `llm_settings`
   column carries `user_preferences.default_llm_settings` merged at
   session start, which can include an apiKey. `SELECT s.*` returned it
   verbatim. Now redacted to `[redacted]` before responding.
4. **AgentPersonaEditor: temperature + max_tokens UI** (cheap MED) — new
   Temperature + Max-tokens fields with "(platform default)" placeholder
   and helper text explaining precedence.

Verification: `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13.
`audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. Browser smoke
on `:5173`: simulator workspace mounts, no error-boundary fires.

**Deferred (architectural)**:
- **Server-side `memory_access` enforcement**: the matrix is enforced
  client-side only (ChatInterface conditionally appends sections). A
  learner could bypass by crafting requests; the threat model is weak
  in an educational platform but it's still a defensive-design gap.
- **User-layer LLM resolver**: UserProfilePanel saves
  `user_preferences.default_llm_settings` but no resolver consults it at
  runtime. Either remove the UI or wire the resolver. Stage 7 (Auth +
  user prefs) should pick this up.
- **Case-layer LLM config**: case_agents only overrides name/system_prompt,
  not LLM. Would need new schema + UI. Defer until needed.

## Stage 3 (Alarms + Notifications) — SHIPPED previous session, COMMITTED

Three Explore agents reviewed alarms (backend, central dispatcher, five
surfaces). 11 findings, **0 false positives** on triage (FP rate has
dropped each stage: 30 → 18 → 11 → 0%). Real fixes shipped:

1. **PUT `/alarms/:id/acknowledge` IDOR + idempotency** (HIGH) — pre-fix
   any authenticated user could ack any alarm by ID, AND every retry
   re-stamped `acknowledged_at`. Now JOINs to `sessions.user_id`,
   allows owner or admin only, and only stamps if `acknowledged_at IS
   NULL` (returns original timestamp + `already_acknowledged:true` on
   re-call).
2. **GET `/alarms/config/:userId` cross-user read** (HIGH) — pre-fix any
   authenticated user could read another user's alarm thresholds. Now
   403 unless self or admin.
3. **Acks/snoozes leaked across cases within the same user** (HIGH) —
   `NotificationProvider` was keyed only on `user.id`, with localStorage
   `acked` set persisted by user. Loading case B inherited case A's
   `alarm:hr_high` ack, silently silencing brand-new alarms in case B.
   Fix: new `clearTransient(reason)` API; `AuthenticatedApp` calls it on
   every `sessionId` change. Prefs and history stay user-scoped.
4. **BannerSurface aria-live** (MED, cheap) — `role="alert"` + assertive
   for any CRITICAL banner, otherwise `status` + polite. Toast already
   did this; banner didn't.

Verification: `bash scripts/audit-alarms.sh` — **13/13 passing**.
`bash scripts/audit-investigations.sh` 14/14 (no Stage-2 regression).
`bash scripts/audit-sessions.sh` 9/9 (no Stage-1 regression). Browser
smoke on `:5173`: simulator workspace mounts, no error-boundary fires.

**Intentional design (not bugs)**: Toast `dismiss()` vs Banner `ack()`
asymmetry; Banner critical has no Dismiss button (acknowledge IS the
dismiss); latch resolves on ack but not snooze (snooze is time-bounded).

**Deferred** (architectural):
- Alarm thresholds are not snapshot-bound at session start. Mid-session
  admin threshold edits bleed into in-progress sessions, inconsistent
  with Stage 1's case_snapshot decision. To fix, add `alarm_thresholds`
  to `sessions.case_snapshot` or store them in a sibling JSON column.
  Adds breaking complexity to `useAlarms` and the editor; deferred.
- `/api/alarms/log` not idempotent on `(session, vital, ts, value)` —
  speculative; deferred unless a real duplicate-row report surfaces.

## Stage 2 (Investigations: Lab + Radiology) — SHIPPED previous session, COMMITTED

Three Explore agents reviewed labs/radiology end-to-end (DB+server,
admin editors, runtime). 9 findings, **1 false positive** (~11% rate —
the pattern keeps getting more reliable as audits stack). Real findings
shipped:

1. **`ConfigPanel` lab-save accumulated DB rows** (HIGH) — the comment
   said "First, delete existing labs" but the next 15 lines only POSTed.
   Every save grew the table. Fix: new `PUT /api/cases/:id/labs` bulk-
   replace endpoint (atomic transaction: drop dependent
   `investigation_orders`, drop old `case_investigations` rows for that
   case, reinsert the new array). ConfigPanel calls it once per save.
2. **`POST /api/cases/:id/labs` is now an UPSERT** (HIGH) — keyed on
   `(case_id, test_name, investigation_type='lab')`. Admin lab edits in
   the wizard (or single-row admin POSTs) overwrite the existing row
   instead of duplicating it.
3. **`DELETE /api/cases/:id/labs/:labId` cascades** (HIGH, Stage-1's
   deferred L6) — also deletes dependent `investigation_orders` rows.
   SQLite can't add `ON DELETE CASCADE` retroactively so cleanup is
   application-layer. Reports `orphan_orders_removed:N`.
4. **`POST /api/sessions/:id/order-labs` idempotent** (HIGH) — checks
   `(session_id, investigation_id)` before INSERT. Returns
   `skipped_duplicates:N`.
5. **`POST /api/sessions/:id/order-radiology` idempotent** (HIGH) — keyed
   on `(session_id, ci.test_name)` via JOIN, because each radiology order
   re-INSERTs a fresh `case_investigations` row by design. UNIQUE on
   investigation_orders wouldn't catch radiology dupes.
6. **Editor bulk-delete confirmations** (MED) — `LabInvestigationEditor`
   `Delete Selected` and `RadiologyEditor` per-row Trash now confirm
   before destroying user-entered findings/images.

Verification: `bash scripts/audit-investigations.sh` — **14/14 passing**,
repeatable. `bash scripts/audit-sessions.sh` still 9/9 (no Stage-1
regression). Browser smoke on `:5173`: simulator workspace mounts, Lab
+ Radiology buttons render, no React error-boundary fires.

Deferred (architectural, out of scope for this audit):
- Radiology DB master catalog (currently config-JSON only — asymmetric
  to labs by design).
- Master-lab-edit propagation to per-case copies (admin rename in
  `lab_tests` master doesn't update existing `case_investigations`).
- Lab numeric server-side clamps — "valid" depends on the unit; needs
  per-test policy. Stage 1 added vitals clamps because vitals have
  universal physiological bounds; labs don't.

## Stage 1 (Sessions + lifecycle) — SHIPPED previous session, COMMITTED

Earlier work resolved the deferred snapshot question. Three Explore
agents reviewed the subsystem; 17 findings, 3 false positives (~18%).
Architectural decisions taken via `AskUserQuestion`:

1. **Snapshot at session start** — `cases.config` + `cases.scenario` are
   captured into `sessions.case_snapshot` at POST /sessions; five reader
   sites refactored to prefer the snapshot. Admin edits during a running
   session no longer bleed into the simulator.
2. **Multi-tab: detect + warn** — `storage` event listener in App.jsx
   surfaces a fixed-overlay banner when another tab writes to
   `rohy_active_session`. Last-write-wins still applies; the banner just
   makes it visible.
3. **Vitals: persist on meaningful change** — same deadband thresholds the
   EventLogger uses for telemetry now also POST to
   `/sessions/:id/vitals`. On session restore, the latest persisted row
   seeds `params` + `rhythm` so the monitor resumes from where the learner
   left off, not the case baseline.

Other HIGH/MEDIUM fixes shipped: `/end` idempotency (was overwriting
`end_time` on every re-call), `sessions.status` finally transitions to
`'completed'`, `handleLoadCase` ends the prior session server-side
instead of orphaning it, `handleCloseDiscussion` clears the discussion
history key, expired sessions are now ended server-side (no zombie
rows), chat history localStorage now carries `sessionId` so restoring
the same case in a new session doesn't replay the prior conversation.

Verification: `bash scripts/audit-sessions.sh` — 9/9 passing.

## Remaining audits — staged roadmap

Four wiring audits have shipped this branch (commits below). Full plan
kept at `~/.claude-claudef/plans/now-we-want-a-tranquil-valiant.md` — the
outline below is the executive view.

**Each stage is its own session and its own commit.** Don't batch.

| # | Stage | Severity | Effort | Why |
|---|---|---|---|---|
| ~~1~~ | ~~Sessions + lifecycle~~ | ~~HIGH~~ | ✅ DONE | Snapshot decision: snapshot at start. Multi-tab: detect+warn. Vitals: persist on change. /end idempotent. |
| ~~2~~ | ~~Investigations (Lab + Radiology)~~ | ~~HIGH~~ | ✅ DONE | UPSERT POST/labs, bulk PUT/labs replace, DELETE cascade, /order-labs+/order-radiology idempotent, editor delete confirms. L6 resolved. |
| ~~3~~ | ~~Alarms + Notifications~~ | ~~HIGH~~ | ✅ DONE | Ack endpoint IDOR + idempotency, /alarms/config cross-user read fix, transient state cleared on session change, BannerSurface aria-live. Threshold snapshot deferred. |
| ~~4~~ | ~~LLM precedence chain~~ | ~~MED~~ | ✅ DONE | Agent layer temperature/max_tokens added (was silently dropped). case_snapshot includes system_prompt; ChatInterface frozen-snapshot. apiKey redacted in GET /sessions/:id. Memory_access server enforcement + user-layer resolver deferred. |
| ~~5~~ | ~~Scenario engine (runtime)~~ | ~~MED~~ | ✅ DONE | Snapshot binding for engine, override guard extended to all mutable fields, auto-stop on complete, scenario-picker confirm, server-side timeline validation. Beat-drift + mid-run banner deferred. |
| ~~6~~ | ~~Physical exam + body map~~ | ~~MED~~ | ✅ DONE | exam-findings idempotent, ManikinPanel snapshot-bound, ClinicalRecordsEditor delete confirms. Two-schema reconciliation deferred (architectural). |
| ~~7~~ | ~~Auth + user preferences~~ | ~~LOW~~ | ✅ DONE | apiKey redacted in GET /users/preferences (Stage-4 twin endpoint), audit log on password/role change, ScenarioRepository isAdmin fix. Stage-4 user-layer LLM deferral was a false alarm — already wired correctly. |
| ~~8~~ | ~~TNA analytics + event log~~ | ~~LOW~~ | ✅ DONE | Two IDOR fixes on `/learning-events/detailed/:sessionId` and `/learning-events/analytics/summary?session_id=X`. In-progress-session filter in dashboards deferred (uncertain blast radius). |
| ~~9~~ | ~~Body avatars~~ | ~~LOW~~ | ✅ CLOSED | No separate body-avatar concept exists. Avatars are head-only. |

**Sequencing**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Stop after Stage 3 if
the user signals "good enough" — the high-blast-radius work is done at
that point. Stages 4–6 are tighter, more bounded. Stages 7–9 are
budget-permitting.

### Universal audit pattern (carry forward from prior three audits)
1. **Explore (parallel, 2–3 agents)** mapping DB → server → frontend → runtime.
2. **Triage** — verify every claim before fixing. FP rate has dropped each stage: 30 → 18 → 11 → 0%.
3. **Decision points** through `AskUserQuestion` for anything architectural.
4. **Fix HIGH always; cheap MEDIUM (≤15 min) opportunistically**; defer expensive MEDIUM and all LOW.
5. **Pattern sweep** — after each stage, scan the rest of the codebase for the SHAPE of any HIGH bug just fixed. Subsystem-scoped agents miss outliers; a 3-line grep across all routes finds them. Stage-3 named the IDOR shape, and one sweep surfaced PUT `/orders/:id/view` (missed in Stage 2). Always do this before declaring a stage done.
6. **Verification** — re-runnable `scripts/audit-<area>.sh` where contract is stable; otherwise manual smoke-list. Plus a Playwright UI smoke (login → render simulator → no error boundary) per Stage-1 lesson.
7. **Document** — append CHANGES, replace HANDOFF section, append LEARNINGS.

### Out of scope (won't be addressed in any stage)
- Cross-language i18n
- DB migration framework (Knex/Sequelize) — current `IF NOT EXISTS`/`ALTER ADD COLUMN` works
- Multi-tenant / multi-org partitioning
- Mobile / responsive UI (simulator is desktop-only)
- Bundle-size optimization (vite warning is acknowledged)

### Prior audits (commits)
- `af9302a` Persona / Voice / Avatar — voice resolver extracted, provider routing fixed, OpenAI alignment, avatarType prop removed.
- `ff4056b` Case editor — schema fidelity (history mirror), persistence (localStorage stash provenance), session safety (vitals clamps, active-use chip), provenance (scenario.source).
- `d954fd0` Comprehensive Agent Persona editor — full-page editor mounted at App.jsx; reset-to-defaults; voice resolver on the editor mirrors ChatInterface.
- *Stage 1 sessions audit (this session, uncommitted as of writing)* — see Stage-1 section above.

---

## Completed

Built and wired the comprehensive Agent Personas editor that the previous session was asked to deliver. Standards are now admin-editable in place, with a `Reset to defaults` button restoring shipped values from the JS source-of-truth array. The new full-page editor is reachable from both Settings → Agent Personas (Edit / New Custom) and from the Case Wizard's Agents step (per-case agent → "Edit persona ↗").

### Backend (`server/db.js`, `server/routes.js`)
- Lifted `defaultAgents` to module-level `export const DEFAULT_AGENTS` + `export function findDefaultAgent(type, name)`.
- Removed the `403 is_default` guard on `PUT /api/agents/templates/:id` — admins can edit shipped standards directly.
- Added `POST /api/agents/templates/:id/reset-to-default` — re-applies `DEFAULT_AGENTS` values onto a standard row (overwrites name, role, prompt, avatar, context filter, communication style, config; clears LLM and memory overrides). Returns the freshly-reset row. Audit-logged.
- DELETE on standards still 403s — rationale: deleting the row is destructive in a way edit-and-reset isn't.

### Frontend
- `src/components/settings/AgentPersonaEditor.jsx` — NEW full-page editor (~700 lines). Mounted in `App.jsx` so it occupies the entire viewport. Sections: Identity, Avatar (live 3D preview + framing sliders), Voice (engine + file + rate + pitch + preview button with stop), Persona prompt, Dos + Don'ts (editable lists with reorder), Behavior, LLM (with test), Memory access, Discussant (conditional). Reset/Duplicate/Delete in header. Voice preview uses `VoiceService.speak({ voice: resolvedVoiceFile, rate: resolvedRate })` and mirrors the chat-side fallback chain.
- `src/components/settings/AgentTemplateManager.jsx` — stripped to list-only. Edit + New bubble up via `onOpenEditor(idOr'new')`. Standards now expose Edit + Duplicate + Reset-to-defaults; customs expose Edit + Duplicate + Delete.
- `src/components/settings/ConfigPanel.jsx` — accepts `initialTab` + `onOpenPersonaEditor` props; threads `onOpenPersonaEditor` to `CaseWizard` → `CaseAgentEditor`. Per-case agent rows now show a `Edit persona ↗` button alongside `Case overrides` (the in-place edit was relabelled from `Edit` to `Case overrides` to clarify scope).
- `src/App.jsx` — top-level state `personaEditorTarget` + `settingsInitialTab`; render branch for the editor; `handleOpenPersonaEditor` / `handleClosePersonaEditor` round-trip into ConfigPanel pinned to the Agents tab.
- `src/services/AgentService.js` — added `resetTemplateToDefault(id)` wrapper.

### Verified
- `npx vite build` — passes (8.65s, only the pre-existing chunk-size warning).
- `npx eslint <touched files>` — only pre-existing warnings remain (`App.jsx` `usePatientRecord/showConfig/toast/Date.now()` errors all predate this session; the `loadTemplates` exhaustive-deps warning matches the original file's pattern).

## Current state

- Build clean, lint clean for new code.
- Standards (`is_default=1`) can be edited, reset, or duplicated — never accidentally deleted.
- Customs (`is_default=0`) can be edited, duplicated, or deleted — same as before.
- Full-page editor is the canonical edit surface; the inline two-column form has been removed entirely from `AgentTemplateManager`.
- Voice preview works end-to-end provided platform voice settings are present (`/api/platform-settings/voice` + `/api/platform-settings/avatars`); falls back gracefully if no voice can be resolved (button disabled with "No voice resolved" hint).
- Live 3D avatar preview re-renders as the avatar dropdown / framing sliders change.

## Key decisions

### Editor mounted at App.jsx level (not inside ConfigPanel)
The previous editor was cramped because ConfigPanel's content area shares space with a sidebar. Mounting at App.jsx via `personaEditorTarget` state (mirroring `showFullPageSettings`, `showTnaAnalytics`) gives the editor the full screen. On close, the editor reopens ConfigPanel pinned to the Agents tab via `settingsInitialTab='agents'` so the round-trip feels seamless.

### `DEFAULT_AGENTS` as the recoverable baseline
The DB row is the live admin-editable copy. The JS `DEFAULT_AGENTS` array is the recoverable baseline. `Reset to defaults` re-applies the array values onto the row. This is the simplest model that lets admins edit freely and still recover from mistakes — no separate `original_*` columns, no backup table. The cost is that the JS array can drift from the DB; that's acceptable because the JS array IS the spec for "what shipped".

### Dos/Don'ts as editable lists rather than textareas
The previous editor used textareas with one-bullet-per-line parsing. The full editor uses proper lists with Add / Remove / Move up / Move down per row. Reorder is keyboard-only (no drag-and-drop dep) — at most 5–8 bullets per persona, the arrows are fine.

### "Edit persona ↗" in the case wizard
A persona template is system-wide; case agents are per-case overrides on top. The case wizard now distinguishes:
- `Case overrides` — per-case edits (name override, availability, response time) stored in `case_agents`.
- `Edit persona ↗` — opens the underlying template in the full editor; affects every case using it.

This makes the scope explicit so admins don't accidentally edit shipped behaviour while configuring a specific case.

## Case editor wiring audit (this session, third pass)

Three Explore agents reviewed the case editing system end-to-end (schema fidelity, cross-system wiring, wizard UX). 19 findings, of which 6 turned out to be false alarms (the agents cited code paths that were already correct). The 13 real findings shipped:

- **HIGH**: persona delete leaves orphan case_agents rows (server-side cascade in DELETE handler), structuredHistory ↔ clinicalRecords.history schema split (mirror writes with rename map), localStorage stash leaks across case switches (timestamped draft + Discard button), Cancel→Save&Exit race (await save before close), treatment-effects master propagation (UI warning banner — full snapshot deferred).
- **MEDIUM**: scenario provenance metadata persistence (`scenario.source` JSON), scenario clobber confirmation, story-mode switch clearing, `config.pages` editor surface, vitals server-side clamping.
- **LOW**: avatar manifest staleness warning, age integer parsing, active-session count chip on case cards.

Deferred: full session-config snapshot at session start (architectural change, would touch every runtime consumer of case config); lab-test orphan handling in LabInvestigationEditor.

## Persona / Voice / Avatar wiring audit (this session, second pass)

After the codex-review fixes landed and the user ran the editor in the
browser, three more issues surfaced that needed an end-to-end audit:

1. Patient chat and the discussant were both omitting `provider` from
   `/api/tts` body, so a case configured for Piper actually played
   whatever the platform default was (Google, on this machine).
2. The voice resolver was duplicated in three places with comments
   begging future devs to keep them in sync.
3. `pipePcmStream` had no even-byte alignment guard; OpenAI had been
   patched but Google/Kokoro relied on the upstream being well-behaved.
4. AgentTemplateManager card thumbnails ignored the persona's framing.
5. The `avatarType` prop on `PatientAvatar` was dead semantics that
   misled callers (some passed `"head"` thinking it'd give a thumbnail —
   it didn't).

The audit:

- Extracted `src/utils/voiceResolver.js` as the single source of truth.
  All three callsites now go through it. The resolver returns `provider`
  alongside the file/rate/pitch, so callers physically can't forget to
  forward the engine.
- Added an even-byte alignment guard to `pipePcmStream` (server/routes.js)
  mirroring the OpenAI iterator's pattern. Carries dangling bytes forward.
- Threaded `cameraOverride={resolveCamera(...)}` into AgentTemplateManager's
  thumbnails so the list view, editor preview, and runtime render the
  same framing.
- Removed the `avatarType` prop entirely; the `voiceSettings.avatar_type
  === 'none'` global kill-switch stays in `PatientVisual` at parent level.
  Cleaned six other callers.
- Wrote `scripts/audit-voices.sh` (bash 3.2 compatible) that asserts
  provider routing, distinct sample rates, stream alignment, and
  shipped-persona camera integrity. **Passes 10/10 locally.**

## Codex pre-commit review — fixes landed

Codex flagged 1 blocker, 4 concerns, and 1 nit. All addressed before commit:

1. **[Blocker] Seeder duplication on rename + restart** — Rewrote `seedDefaultAgents()` to insert only when no `is_default=1` row exists for that `agent_type`. The unique index on `(agent_type,name)` is preserved for non-default uniqueness, but the seeder no longer fights with admin renames.
2. **[Concern] Type-only reset fallback unsafe under agent_type edits** — PUT now rejects `agent_type` changes on standards (HTTP 400). With the type immutable, `findDefaultAgent(type, null)` is well-defined.
3. **[Concern] Voice resolver missed child slot + hardcoded fallback** — Editor's `resolvedVoiceFile` now mirrors `ChatInterface.pickVoiceFile` end-to-end, including age<13 → child slot and `PROVIDER_FALLBACK_VOICE`.
4. **[Concern] Case-wizard round-trip displaced the admin** — Persona editor now accepts an optional return context. Opening from `CaseAgentEditor` passes `{tab:'cases', wizardStep:11}`; closing lands the admin back on the case wizard's Agents step.
5. **[Concern] Reset audit log was thin** — Audit now logs the full pre-reset row as `oldValue` and the applied baseline as `newValue`, making a reset undoable from the audit trail.
6. **[Nit] Unused `DEFAULT_AGENTS` import in routes.js** — removed; only `findDefaultAgent` is needed there.

## Open issues

### A. "of others" still unconfirmed (MEDIUM)
The previous session flagged that the user's earlier ask "let's have templates of these, and also, of others" was ambiguous. Still unresolved. The persona-editor work assumes the narrower reading (other agent types, already covered). If the user wanted templates of OTHER things (cases, scenarios, voices, alarm presets, lab panels, drug protocols), that's a separate architectural pass.

### B. Drag-and-drop reorder for Dos/Don'ts (LOW)
Currently keyboard-only (▲/▼ buttons). Drag-and-drop would feel nicer but requires `dnd-kit` or similar. Worth raising only if the user complains about ergonomics.

### C. Voice preview without saved template (LOW)
Currently the preview button works on unsaved templates if a voice can be resolved. The LLM test button requires a saved template (intentional — the server-side `/test-llm` endpoint is keyed on template id). If the user wants pre-save LLM testing, the test endpoint needs to accept a templateless payload.

### D. Carried over from prior handoff (not addressed this session)
- ConfigPanel has a pre-existing `set-state-in-effect` lint error around the `case_id` loader effect.
- ChatInterface has multiple pre-existing `react-hooks/exhaustive-deps` warnings.
- App.jsx has 4 pre-existing eslint errors (`usePatientRecord`/`showConfig`/`toast`/`Date.now()`) — none touched.

## Next steps

1. **Have the user smoke-test the new editor**: load a standard (e.g. Sarah Mitchell), click Edit in full editor, confirm: avatar swap renders live, framing sliders work, voice preview plays, dos/donts reorder, save persists, reset-to-defaults restores shipped values.
2. **Get clarification on "of others"** before any further architectural work in this area (handoff item D from prior session).
3. Optional: add `Reset all standards` bulk button if admins need it.
4. Optional: surface the `Edit persona ↗` link in the runtime per-case agent picker (`CaseAvatarVoicePicker` or wherever else case agents render in the simulator) — currently only in the wizard.

## Context

- **Branch:** `main` (durable user rule — never feature branches).
- **Repo:** `https://github.com/mohsaqr/rohySimulator.git`
- **Local:** `/Users/mohammedsaqr/Documents/Github/rohySimulator`
- **DB:** SQLite at `server/database.sqlite`, auto-seeded.
- **Default creds:** `admin` / `admin123`, `student` / `student123`.
- **Vite dev:** `:5173`. API: `:3000` via `node server/server.js`.
- **Build:** `npx vite build`. Lint: `npx eslint <file>`. No npm test target.

### Files most likely to touch next
| File | Why |
|---|---|
| `src/components/settings/AgentPersonaEditor.jsx` | The new editor itself — any extension goes here |
| `src/components/settings/AgentTemplateManager.jsx` | List view — chips, filters, sorting |
| `server/db.js` | Edit `DEFAULT_AGENTS` if the shipped baseline changes |
| `server/routes.js` | Reset endpoint behaviour — currently around line 8166 |
| `src/App.jsx` | If new persona-editor surfaces (other entry points) need wiring |

### What NOT to do

- Don't re-introduce the read-only gating on standards. The user explicitly rejected that, twice.
- Don't move the editor back inside ConfigPanel — the full-page mount is what makes it not a "toy".
- Don't guess about "of others". Ask.
- Don't switch off `main` to a feature branch.

— end —
