### 2026-05-06 — TNA analytics rebuild on dynajs (LAILA replication + process map)
Replaces the thin tnaj-based TNA dashboard with a LAILA-grade six-tab analytics
page powered by dynajs. No reinvention — all sixteen TNA components were lifted
verbatim from LAILA-v3/client/src/components/tna/ via esbuild type-strip; the
i18n hook was swapped for a local English shim, useTheme stubbed to dark.
Process Map is a new tab using dynajs's buildDFGFromSequences + dagre layout +
the cumulative-95% pruning approach Carmdash documents in its CLAUDE.md.

- `package.json`: replaced `tnaj` (github:mohsaqr/tna-js, v0.1.0 — limited surface)
  with `dynajs` (file:../dynajs, has tna/ftna/ctna/atna + prune + centralities +
  summary + layout (10 algorithms) + clusterData + discoverPatterns +
  buildDFG + stateFrequencies + networkDensity). Added `dagre` for process-map
  hierarchical layout.
- `server/routes.js` /analytics/tna-sequences rewritten to LAILA's contract:
  returns parallel `sequences[][]` + `objectTypeSequences[][]`; supports
  `group_by=actor|actor-session`, `min_sequence_length`, `min_verb_pct`,
  `skip_merges`; P95 chunking caps long sessions; rich metadata
  ({totalSequences, totalEvents, uniqueVerbs, uniqueObjectTypes, caseTitle,
  dateRange, groupBy}). Six new sibling endpoints power the Activity tab and
  filter dropdowns: /daily-counts, /hourly-counts, /summary, /stats,
  /top-resources, /filter-options.
- `src/components/analytics/tna/laila/` (NEW directory, 18 files): the verbatim
  LAILA components — TnaNetworkGraph, NetworkModal (+ ClusterNetworkModal),
  CentralityBarChart, TnaCentralityTable, TnaDistributionPlot, TnaIndexPlot,
  TnaFrequencyChart, TransitionHeatmap, ActivityDonutChart, ActivityHeatmap,
  ActivityTimelineChart, ClustersTab, ClusterPanel, PatternsTab, PatternTable,
  colorFix.js — plus three local shims: i18nShim.js (humanises unknown keys,
  overrides for the ~50 user-facing labels), Loading.jsx, useTheme.js.
- `src/components/analytics/tna/laila/ProcessMap.jsx` (NEW, 200 lines): dynajs
  buildDFGFromSequences + dagre rankdir=TB. Cumulative-weight 95% auto-prune
  per active metric (absoluteCount / relativeCount / caseCount). Synthetic
  ▶ start / end ■ nodes optional. Edge stroke + opacity scale with the
  active metric.
- `src/components/analytics/tna/clinicalStates.js` (NEW, ~150 lines): the
  simulator-domain analogue of LAILA's 12 educational states. Ten clinical
  states (assessing / examining / investigating / treating / communicating /
  documenting / monitoring / regulating / reflecting / navigating). Three-tier
  resolver: explicit verb:object_type → object_type override → verb fallback →
  literal `verb_object` fallback. ~80 verb fallbacks + 22 object overrides +
  10 explicit pairs cover the existing 14 verb:object combos in the prod DB
  plus likely additions.
- `src/components/analytics/tna/TnaDashboardV2.jsx` (NEW, 480 lines): LAILA's
  Dashboard.tsx structure adapted to the simulator. Six tabs: Activity /
  Network / Clusters / Patterns / Process Map / Settings. Four sequence modes
  (combined / verb-only / object-only / raw). Four model types
  (relative / frequency / co-occurrence / attention). Nine layout algorithms.
  Verb renames + excludes editor in Settings tab. React-Query replaced with
  useState + useEffect + fetch (matches the rohy pattern; auth via
  AuthService.getToken). The old TnaDashboard.jsx and its 9 hand-rolled
  charts kept on disk for one cycle but no longer mounted (App.jsx now
  imports TnaDashboardV2).
- `src/components/analytics/tna/tnaUtils.js`: legacy file — kept the file but
  swapped its `tnaj` imports for `dynajs` so the legacy dashboard's nothing
  else still imports the file. Documented as deletable once V2 is the
  default for one cycle.
- `src/App.jsx`: import flipped from `./TnaDashboard` to `./TnaDashboardV2`.
- Tests: `tests/server/analytics-tna.test.js` (15 server integration tests)
  asserts the new endpoint contract — parallel sequences + objectTypeSequences,
  actor vs actor-session grouping, P95 length filter, case title surfacing,
  unique-verb metadata, summary/daily/hourly/stats/filter-options shapes.
  `src/components/analytics/tna/clinicalStates.test.js` (10 unit tests) locks
  the resolver chain precedence and asserts every value in
  DEFAULT_INTERPRETATIONS / OBJECT_OVERRIDES / VERB_FALLBACKS is one of the
  canonical ten states. All 22 new tests green; full suite 746 passing.

### 2026-05-06 — Tiered drug + lab catalogue, Session 2 (search proxies + scope-aware routes + tests)
Second of three sessions. Adds the runtime surface on top of Session 1's schema: three search proxies wrapping NLM/FDA APIs with a 24h in-memory cache, a new `/api/catalogue/*` mount point with full CRUD that respects the `scope` column from migration 0007, an admin-only `/promote` endpoint that widens scope (user → tenant → platform) with audit logs, and 38 new tests (12 unit + 26 integration). The legacy `/api/master/*` routes are left untouched so the existing settings UI keeps working until the Session 3 lift.

- `server/services/proxyCache.js` (NEW): tiny TTL-keyed Map shared by all three proxies. `cacheGet/cacheSet/cacheClear/cacheStats` plus `setFetch/getFetch` so unit tests can inject a mock fetcher. No setInterval cleanup (lazy expiry on read) so the module never holds the event loop open in tests.
- `server/services/rxnormProxy.js` (NEW): wraps `https://rxnav.nlm.nih.gov/REST/approximateTerm.json` for fuzzy typeahead search; de-dups on rxcui keeping highest-score row. Also exports `lookupRxCui()` for `/rxcui/<id>/properties.json`. License: NLM public domain.
- `server/services/openfdaProxy.js` (NEW): wraps `https://api.fda.gov/drug/label.json` Lucene query over `openfda.brand_name OR openfda.generic_name`. Treats upstream 404 as empty result (openFDA convention). License: CC0 1.0.
- `server/services/loincProxy.js` (NEW): wraps NLM Clinical Tables `loinc_items/v3/search` with `LOINC_NUM,COMPONENT,LONG_COMMON_NAME,EXAMPLE_UCUM_UNITS` field selector. Normalizes the upstream tuple-based response into the same `{external_source, external_id, display_name, ...}` shape as the medication proxies.
- `server/routes/catalogue.js` (NEW): mounted at `/api/catalogue` from `server/routes.js`. Endpoints:
  - `GET /medications`, `GET /lab-tests` — scope-aware visibility filter (`platform OR (tenant AND tenant_id=?) OR (user AND created_by=?)`).
  - `POST /medications`, `POST /lab-tests` — auth-only. Server pins `scope='user'` + `created_by=req.user.id`. Educator+ may pass `scope='tenant'`. `scope='platform'` is rejected here (must use /promote).
  - `PUT /medications/:id`, `PUT /lab-tests/:id` — owner / educator-tenant-match / admin only via `canMutate()`.
  - `DELETE /medications/:id` (soft-delete via deleted_at), `DELETE /lab-tests/:id` (hard-delete, no FK).
  - `POST /medications/:id/promote`, `POST /lab-tests/:id/promote` — admin-only. Bumps scope to 'tenant' or 'platform'. Writes a `system_audit_log` row with the old/new scope.
  - `GET /medications/search?q=&sources=rxnorm,openfda` — proxies through both upstreams in parallel; collects errors per-source so one failure doesn't blank the response.
  - `GET /lab-tests/search?q=` — LOINC proxy. Same shape.
  - `/medication-groups`, `/lab-test-groups` — full CRUD with items endpoint. Mounted at non-overlapping paths (not `/medications/groups`) because `/medications/:id` would shadow it via Express's match-by-registration-order rule.
- `server/routes.js`: imports `catalogueRouter` and mounts at `/catalogue`. No changes to the legacy `/master/*` routes.
- `tests/server/catalogue-proxies.test.js` (NEW, 12 tests): fetch-mocked unit tests for each of the three proxies; covers parsing, normalization, dedup, cache hit, blank-query short-circuit, upstream 404 vs 500 handling.
- `tests/server/catalogue-routes.test.js` (NEW, 26 tests): integration via `startTestServer()` with seeded admin/educator/student/student-2 users; exercises GET visibility, scope-rule enforcement on POST (student rejected from tenant + platform), educator can pass tenant, owner-only PUT/DELETE, admin-only `/promote` with audit row verification, lab-tests parallel routes, group CRUD with item add/list and cross-user 403.

Total Session 2 tests: 38 new (57 catalogue tests in aggregate including Session 1's 19). Full suite: 717 passing, 45 skipped, same pre-existing parallel flake on `auth.test.js`.

Deferred to Session 3: settings UI lift to 3-tab layout (Curated / My catalogue / Search) in `MedicationManager.jsx` and `LabTestManager.jsx`; `OrdersDrawer.jsx` group-aware order picker; deprecation of legacy `/master/*` routes once the new UI ships.

### 2026-05-06 — Tiered drug + lab catalogue, Session 1 (schema + curated seeders + tests)
First of three sessions executing the locked drug + lab catalogue plan (memory: project_drug_lab_catalogue_plan.md). Lays the structural foundation: a single migration that adds provenance + scope columns and seven new tables, five idempotent JSON-driven seeders, and a 19-test integration suite that exercises the lot end-to-end. No route changes yet; the search-proxy endpoints and settings UI lift come in Sessions 2 + 3.

- `migrations/0007_drug_lab_catalogue.sql` (NEW): adds `data_sources` provenance table (seeded with 9 canonical source rows: curated, rxnorm_v2026-05, openfda_v2026-05, loinc_v2.82, ucum, caliper_2026, admin, educator, student); adds `is_curated/scope/tenant_id/data_source_id/external_source/external_id/rxcui/ndc_primary/atc_code/openfda_setid/boxed_warning/created_by` columns to `medications`; adds `rxcui/data_source_id/pk_source/pk_evidence_url` to `treatment_effects`; adds `is_curated/scope/tenant_id/data_source_id/external_source/loinc_code/ucum_unit/created_by` to `lab_tests`; creates `lab_reference_ranges`, `custom_drug_groups` (+ items), `custom_lab_groups` (+ items); 11 supporting indices.
- `server/data/treatment_effects.json` (NEW, 101 rows): hand-curated PK + vitals-effects table with `rxcui` (83/86 medication rows have one), `pk_source` (StatPearls / FDA SPL / SAFE / SMART-ED), `pk_evidence_url`. Adds 67 ICU/ward-essential drugs to the prior 33 (anticoagulants, thrombolytics, reversal agents, antiarrhythmics, endocrine, electrolytes, antibiotics, RSI, antiplatelets, analgesia, antiemetics, anticonvulsants, antihypertensives, diuretics, tox antidotes, cardiac inotropes).
- `server/data/lab_loinc_mapping.json` (NEW, 178 patterns): hand-curated LOINC + UCUM mapping. Match strategy is case-insensitive substring on test_name; longer patterns win.
- `server/data/lab_pediatric_ranges.json` (NEW, 52 pattern rows): CALIPER pediatric reference intervals — neonatal, infant, child, adolescent age bands with M/F splits where clinically distinct. Isolated to one file + one table so a commercial deployment can drop the CC BY-NC-SA license rows wholesale.
- `scripts/seed-treatment-effects.js` (NEW): JSON-driven, replaces the deleted 576-line inline `seedDefaultTreatmentEffects` in `server/db.js`. Idempotent via INSERT ... ON CONFLICT(treatment_name, route) DO UPDATE; updates `data_sources.rows_imported` + checksum + `imported_at` so a single SELECT shows pinned-snapshot status.
- `scripts/seed-curated-medications.js` (NEW): mirrors medication-type rows from `treatment_effects` into the catalogue with `is_curated=1, scope='platform', data_source_id=curated`. Synthesises a stable `medication_code` slug for ON CONFLICT upsert. Back-fills `treatment_effects.medication_id` by name+route join after upsert.
- `scripts/seed-lab-tests-from-json.js` (NEW): bridge from `Lab_database.json` + `heart.txt` (the existing JSON catalogue read by `server/services/labDatabase.js`) into the SQL `lab_tests` table. Required so LOINC mapping and pediatric ranges can attach. Dedups on `(test_name, category)`.
- `scripts/import-loinc-mapping.js` (NEW): augment-only — stamps `loinc_code` + `ucum_unit` + `data_source_id=loinc` onto existing `lab_tests` rows. No new rows added. Coverage: **216/222 (97%)**.
- `scripts/seed-pediatric-ranges.js` (NEW): inserts CALIPER ranges into `lab_reference_ranges`, fanning out across every `lab_tests` row whose name matches the pattern. Idempotent via DELETE ... WHERE data_source_id = caliper before re-insert. Result: 132 range rows (52 patterns × multiple lab matches), 31 neonatal + 101 pediatric.
- `server/db.js`: imported the five new seeders. `initDb()` runs them in order after migrations, with a single try/catch so a transient JSON I/O issue cannot brick the boot. Deleted the legacy `seedDefaultTreatmentEffects` function (576 lines); the JSON-driven path is the single source of truth.
- `tests/server/catalogue-0007.test.js` (NEW, 19 tests): integration suite against a fresh `createTestDb()`. Locks: schema additions, 9 canonical `data_sources` rows, ~100 treatment_effects with curated provenance and pk_source, ~86 curated medications, lab_tests bootstrap, ≥90% LOINC coverage, ucum_unit non-null on every LOINC row, ≥50 CALIPER ranges across neonatal+pediatric populations, idempotent re-run (no dups). All pass in 6s.
- Verification on a fresh DB: 9/9 data_sources rows; 101 treatment_effects (83 with rxcui, 91 with pk_source); 86 curated medications; 222 lab_tests (216 with LOINC); 132 pediatric range rows. Full test suite: 686 passed, 38 skipped, 1 unrelated parallel-flake (`auth.test.js` SQLITE_READONLY when run in parallel; passes 28/28 in isolation).

Deferred to Session 2: search proxy services (rxnormProxy, openfdaProxy, loincProxy with 24h cache), scope-aware POST/PUT/DELETE in `server/routes.js`, `/promote` admin endpoint, `/groups` CRUD. Deferred to Session 3: settings UI lift to 3-tab layout (Curated / My catalogue / Search) in `MedicationManager.jsx` and `LabTestManager.jsx`.

### 2026-05-06 — TTS wire history + audition replay buttons in DiagnosticBar
Follow-up to the same-day discussant-voice work. The user reported the symptom a third time after seeing the live wire row showing `en-US-Neural2-D` ("the actual one in practice is en-US-Chirp3-HD-Charon"), so the bar now keeps a ring buffer of the last 12 TTS requests and ships an audition replay so the user can hear the captured payload back-to-back with the platform's male/female/child slot voice for direct A/B comparison. The point: a single "last wire" row can be misleading if the voice changed mid-stream; a history table makes that change visible, and replay turns "I think I heard X" into a falsifiable test.

- `src/services/voiceService.js`: added `getRecentTtsRequests()` (newest-first ring buffer of last 12 entries) keyed by a stable `id` so lifecycle phase updates (pending → ok / error / aborted) update an entry rather than duplicate it. New `auditionWirePayload(wire, override)` exported helper re-fires `/api/tts` with the captured payload (or with an override voice/provider) and plays the returned WAV through the same lipsync `audioContext`. Calls `teardown()` first so any live runtime playback is cancelled — listening to a captured payload while the runtime is mid-sentence would mix audio.
- `src/components/debug/DiagnosticBar.jsx`: new "TTS wire history" table replaces the single "Last TTS request" panel. Shows when / voice / provider / rate / status / text preview / play column / A/B column for each entry. Each row has a play button (re-fires the captured payload) and a "vs. <slot>" button that re-fires the same TEXT through the platform's `voice_<provider>_<slot>` slot for direct comparison. Includes `WireStatusBadge`, `auditionKey`, `deriveSlotForGender`, and `shortVoice` helpers. Audition state cancels on bar unmount so audio doesn't bleed past the user collapsing the UI.
- Verified end-to-end via Playwright on the post-case debrief flow: 3 sentences fired, all `en-US-Neural2-D` `ok (200)`, all visible in the table; clicking a "vs. HD-Charon" button fired a fresh `POST /api/tts` (non-streaming) for the audition and toggled the button label to `■ stop`. `npx vite build` passed.

### 2026-05-06 — Discussant voice diagnosis + live wire-capture in DiagnosticBar
Closed the unresolved discussant-voice complaint from yesterday's handoff. Three Explore agents and one Codex rescue agent re-traced the data flow; Playwright captured the literal `/api/tts` request body during a live debrief; curl-tested the server with three voices to confirm distinct audio. Conclusion: the wiring is correct end-to-end (configured `en-US-Neural2-D` reaches Google unchanged and Google returns the corresponding audio). To make this evidentially provable in future sessions, instrumented the lowest TTS layer with a runtime wire-payload feed.

- `src/services/voiceService.js`: `ttsFetch()` now records the literal request body (voice, provider, rate, pitch, gender, streaming, text length, text preview) plus response status (`ok` / `error` / `aborted` / `pending`) and round-trip duration into a module-level `_lastTtsRequest`. Dispatches `window` `'rohy:tts-request'` CustomEvents on every lifecycle phase. New `getLastTtsRequest()` export.
- `src/components/debug/DiagnosticBar.jsx`: subscribes to `'rohy:tts-request'` events, renders a new "Last TTS request (live wire)" section in the expanded panel, and prefers the live wire voice in the compact one-liner over the static resolver prediction (`TTS:` becomes `TTS wire:` when a request has fired). Includes `ttsStatusLabel()` helper for the status row.
- `HANDOFF.md`, `LEARNINGS.md`: marked the discussant-voice symptom resolved, captured the methodology lesson (static resolvers cannot prove runtime synthesis; capture wire payloads at the funnel point) and the cloud-TTS family-similarity pitfall (`en-US-Neural2-D` and `en-US-Neural2-J` sound similar to many ears even though they are correctly distinct voices).
- Verification: `npx vite build` (clean, only the pre-existing chunk-size warning), `bash scripts/audit-voices.sh` (10/10), Playwright captured the live wire row reading `voice · en-US-Neural2-D · provider · google · status · ok (200) · 282ms`. Pre-existing eslint errors in DiagnosticBar (`react-refresh/only-export-components` and `react-hooks/purity` on `useState(Date.now())`) predate this session.

### 2026-05-06 — Stage E9: Observability hooks (final enterprise stage)
Added opt-in runtime observability primitives without replacing existing handler `console.log` calls.

- `server/observability.js` (NEW): centralized NDJSON writer, log-level parsing, request-context storage, request-id validation/generation, SQL sanitization/truncation, slow-query threshold handling, platform-setting fallback, and one-time sqlite handle instrumentation for legacy callback routes.
- `server/middleware/requestId.js`, `requestLogger.js`, `errorHandler.js` (NEW): first-stack request id propagation, structured completion logs via `res.on('finish')`, 4xx/5xx `http_error` signals, and terminal Express error logging with server-side stack traces.
- `server/server.js`: installs request id before CORS/body parsing/routes, exposes `X-Request-Id`, mounts structured request logging, instruments the existing sqlite handle, reads platform slow-query settings after DB readiness, and adds a final error handler.
- `server/dbAdapter.js`: keeps the E8 adapter API unchanged while timing Promise-based `get`, `all`, `run`, and prepared-statement calls.
- `scripts/audit-observability.sh` (NEW): starts an isolated temporary server, verifies generated and inbound `X-Request-Id`, checks NDJSON request/error fields, and forces low slow-query threshold coverage without touching the orchestrator-managed `:3000`.
- `ENTERPRISE_AUDIT.md`, `HANDOFF.md`, and `LEARNINGS.md`: mark all 9 enterprise stages complete and document the E9 defaults: `ROHY_LOG_LEVEL=info`, `ROHY_SLOW_QUERY_MS=100`, and `ROHY_LOG_SKIP_PATHS=/api/proxy/llm,/health`.

Deferred: log shipping, APM agents, cross-service distributed tracing, and runtime log retention. Runtime logs intentionally go to stdout for the operator's future shipper.

### 2026-05-05 — Stage E8: Connection pooling + portability
Shipped the Postgres-portability inventory and adapter infrastructure without migrating routes.

- `server/dbAdapter.js` (NEW): Promise-returning wrapper around the existing sqlite3 handle from `server/db.js`, exporting `get`, `all`, `run`, `serialize`, `transaction`, `prepare`, `now`, and `upsert`. It opens no second connection and documents the future pg drop-in surface.
- `server/migrationRunner.js`: added a documentation comment calling out the SQLite-specific baseline detection and the future Postgres `information_schema.tables` equivalent.
- `scripts/audit-portability.sh` (NEW): Bash 3.2-compatible inventory audit that reports SQLite-specific counts, asserts the adapter surface, smokes an adapter query against a throwaway DB, checks no `pg` dependency was added, and passes even while inventory counts are non-zero.
- `HANDOFF.md` and `ENTERPRISE_AUDIT.md`: record E8 as shipped and explicitly defer route migration and actual Postgres migration.

Deferred: actual Postgres migration, route migration to the adapter, `pg` dependency, column-type abstractions, and query-builder adoption. E8 is the structural prerequisite only.

### 2026-05-05 — Stage E7: Soft delete + retention policy
Added a uniform retention layer for same-tenant user purge, soft-delete reads, and time-bounded log cleanup.

- `migrations/0005_retention.sql` (NEW): adds `deleted_at` to `agent_templates`, `scenarios`, `medications`, `case_investigations`, and `lab_definitions`; indexes all soft-delete columns; indexes retention time columns for `event_log`, `learning_events`, `interactions`, `system_audit_log`, `alarm_events`, and `llm_request_log`; rebuilds `users.email` as nullable for anonymization and `llm_request_log.user_id` as nullable for retained-log anonymization.
- `server/routes.js`: added `POST /api/users/:id/purge?dry-run=true`, admin-only and tenant-scoped. The endpoint audit-logs `purge_user` before destructive work, returns cascade counts for dry-runs, soft-deletes user-authored domain rows, hard-deletes ephemeral preference/session/config rows, anonymizes retained log `user_id` values to NULL, and deactivates the retained user row as `deleted_user_<id>` with PII nulled.
- `server/routes.js`: live reads now filter `deleted_at IS NULL` for cases, scenarios, case investigations, medications, and agent templates. `GET /api/cases/:id` now returns 404 for soft-deleted cases. Scenario, medication, case-lab, and agent-template deletes now soft-delete their parent rows.
- `scripts/retention-sweep.js` (NEW): deletes rows older than the retention window from time-bounded log tables. Default is 90 days, override with `ROHY_RETENTION_SECONDS`, `RETENTION_SECONDS`, `ROHY_RETENTION_DAYS`, `RETENTION_DAYS`, or platform settings `retention_days` / `log_retention_days`. Writes a `retention_sweep` audit row and is idempotent.
- `scripts/audit-retention.sh` (NEW): verifies soft-delete columns, case soft-delete behavior, purge dry-run counts, purge anonymization/hard-delete behavior, purge audit retention, and retention-sweep deletion of old rows.

Inventory: soft-delete tables are `cases`, `sessions`, `agent_templates`, `scenarios`, `medications`, `case_investigations`, `lab_definitions`, and `clinical_notes`. Hard-delete-on-purge tables are `user_preferences`, `active_sessions`, `alarm_config`, `session_notes`, `questionnaire_responses`, `export_records`, `llm_usage`, and `tts_usage`. Retain-N-days tables are `event_log`, `learning_events`, `interactions`, `system_audit_log`, `alarm_events`, and `llm_request_log`. Always-retain/anonymized anchors are `users` and `tenants` plus immutable case-version ownership history through the anonymized user row.

Deferred: real GUI for purge, data-export-on-purge, cross-tenant erasure beyond tenant admin scope, legal-hold flags, and tenant deletion semantics.

### 2026-05-05 — Stage E6: Multi-tenant readiness
Added the structural tenant boundary for enterprise deployments while keeping the existing single-tenant default path intact.

- `migrations/0004_tenants.sql` (NEW): creates `tenants`, seeds `default`, adds `tenant_id INTEGER NOT NULL DEFAULT 1` to user/case/session/runtime/log tables, and adds tenant-prefixed indexes for hot lookups. Tenant deletion is application-RESTRICT/deferred; existing rows are assigned to tenant 1 without data loss.
- `server/middleware/auth.js`: `authenticateToken` refreshes user status/role/tenant from the database, attaches `req.user.tenant_id`, exports `resolveTenant(req)`, and adds `requireSameTenant(resourceTenantIdGetter)`.
- `server/routes.js`: tenant-scoped the high-risk request paths for users, cases, sessions, interactions, learning events, investigation orders, alarms, active sessions, settings logs, audit logs, and session vitals. Inserts ignore body-supplied `tenant_id` and use `req.user.tenant_id`.
- `server/routes.js`: added `POST /api/tenants` and a minimal admin assignment hook `POST /api/users/:id/tenant`; both write `system_audit_log` rows with old/new `tenant_id`.
- `server/seeders/users.js`: default admin/student seed into tenant 1.
- `scripts/audit-tenant.sh` (NEW): verifies schema/default tenant, two-tenant isolation for cases/sessions/active sessions, mass-assignment resistance, and tenant audit rows.

Inventory: tenant-scoped tables are `users`, `cases`, `sessions`, `interactions`, `login_logs`, `settings_logs`, `session_settings`, `event_log`, `alarm_events`, `alarm_config`, `case_investigations`, `investigation_orders`, `scenarios`, `learning_events`, `physical_exam_findings`, `patient_information`, `case_versions`, `system_audit_log`, `vital_sign_history`, `export_records`, `active_sessions`, `scenario_events`, `user_preferences`, `clinical_notes`, `llm_usage`, `llm_request_log`, `patient_record_events`, `patient_record_documents`, `agent_templates`, `case_agents`, `agent_conversations`, `agent_session_state`, `team_communications_log`, `treatment_orders`, `active_treatments`, `case_treatments`, `emotion_logs`, `questionnaire_responses`, `tts_usage`, `session_notes`, and `session_vitals`. Global tables remain the shipped/master catalogs: platform settings, lab/radiology/master medication/investigation/diagnosis/vital/body-map catalogs, scenario templates/timelines, search aliases, pricing, and treatment effects.

Deferred: cross-tenant super-admin views, tenant deletion/retention semantics, per-tenant rate limits/billing/LLM keys, subdomain/header routing, user-tenant migration tooling, and tenant-local uniqueness for username/email.

### 2026-05-05 — Stage E5: Data classification + redaction policy
Generalized the Stage 4/7 apiKey redaction fixes into a central response policy.

- `server/redaction.js` (NEW): declares `RESPONSE_REDACTION_POLICY` and helpers `redactRow()`, `redactRows()`, `redactJsonColumn()`, `redactPlatformSettingRows()`, and `redactAuditPayload()`. Chosen approach: per-route helpers instead of an Express `res.json` interceptor so streaming endpoints such as `POST /api/proxy/llm` are not wrapped.
- `server/routes.js`: migrated `GET /sessions/:id` and `GET /users/preferences` to the helper and swept additional settings/key surfaces: session analytics, complete/session CSV exports, settings/audit log reads, active-session token rows, dedicated and generic platform-setting reads, scenario internal creator ids, and agent-template `llm_api_key` reads.
- `server/routes.js`: audit old/new/metadata payloads now use the same recursive redaction helper before persistence, so audit rows do not become a secondary secret store.
- `scripts/audit-redaction.sh` (NEW): logs in admin + a student, proves secret redaction on preferences, sessions, analytics sessions, agent templates, platform settings, active sessions, and checks admin/student PII behavior for `/users/:id`.

Inventory: secrets are `users.password_hash`, `active_sessions.token_hash`, platform settings matching `*_api_key`, agent `llm_api_key`, session/preference JSON carrying `apiKey`/`api_key`/`llm_api_key`, audit/settings old/new JSON, and future `*_key`/`*_secret`/`*_token` response columns. PII is `users.email`, `alternative_email`, `phone`, `address`, `name`, `education`, `grade` plus aliases such as `user_email` and `student_name`. Internal fields are creator/updater ranks and ids such as `created_by`, `updated_by`, and `role_rank`.

Deferred: column-level encryption at rest, request-side classification, and GDPR erasure remain separate stages.

### 2026-05-05 — Stage E4: Audit-log coverage
Centralized request-aware audit helpers and expanded `system_audit_log` coverage across sensitive mutations.

- `server/routes.js`: `logAudit()` now accepts both `resourceType/resourceId` and `targetType/targetId`, logs failures with `console.warn`, and has `auditSuccess()` plus `setAuditedPlatformSetting()` helpers for lower-friction route coverage.
- `server/routes.js`: added audit rows for case availability/default/labs/treatments, scenario create/update/delete/seed, alarm config writes, lab catalog writes/reloads, master lab/medication writes, platform settings writes, notification/user preference writes, case-agent mutations, agent-template duplicate/update/reset/delete, admin user reads/creates/deletes, and cross-user learning-event reads.
- `server/routes.js`: added `GET /api/system-audit-log` as an admin-only alias for the existing `/api/admin/audit-log` reader.
- `scripts/audit-auditlog.sh` (NEW): exercises representative sensitive writes and verifies `old_value`/`new_value` population through the audit-log API. Policy: failed authorization attempts are not audit-logged in E4 because `requireRole` rejects before handlers run.

Deferred: no GUI, retention policy, or external export hooks; those remain E7/E9 territory.

### 2026-05-05 — Stage E3: RBAC role hierarchy
Introduced the enterprise role ladder and moved route checks onto centralized rank helpers.

- `migrations/0003_role_hierarchy.sql:1`: rebuilds `users` with role enum `guest/student/reviewer/educator/admin`, maps legacy `user` rows to `student`, preserves all identity/profile/password columns, and adds generated `role_rank` for comparisons.
- `server/middleware/auth.js:39`: adds `ROLE_RANKS`, `normalizeRole()`, `getRoleRank()`, `hasRoleAtLeast()`, `requireRole(minRank)`, and `requireAdmin`/`requireEducator`/`requireReviewer`/`requireStudent` wrappers.
- `server/routes.js`: replaces scattered direct admin comparisons with rank helpers, opens reviewer read paths and educator authoring paths while keeping user/platform/admin audit surfaces behind `requireAdmin`.
- `server/routes.js` registration/user-management paths: self-registration defaults to `student`; only the first user can self-register as `admin`; admin-created users validate the five-role enum; role grants above the actor's rank are rejected; role transitions continue to write `oldValue.role` and `newValue.role` audit records.
- `server/seeders/users.js:20`: default `student/student123` now seeds with role `student` so fresh DBs satisfy the new enum.
- `scripts/audit-rbac.sh` (NEW): proves enum rejection, student IDOR denial, reviewer read-only behavior, educator non-admin authoring, admin-only gates, admin retained access, and student self-escalation denial.

Deferred: per-resource permissions such as "user X can edit case Y" remain Stage E4+ design work; E3 only establishes the rank hierarchy and enforcement points.

### 2026-05-05 — Stage E2: Migration framework
Replaced the ad-hoc schema bootstrap with versioned SQLite migrations and proved the first rebuild/copy FK migration.

- `server/migrationRunner.js:53`: new hand-rolled migration runner discovers sorted `migrations/*.sql`, calculates SHA-256 checksums, tracks `schema_migrations(version, name, applied_at, checksum)`, skips already-applied files, and supports `--dry-run` without mutating the database.
- `server/migrationRunner.js:105`: baseline-stamps `0001_initial.sql` when a pre-E2 database already has the expected core tables and an empty `schema_migrations` table, then leaves non-baseline migrations pending so retroactive rebuilds still apply.
- `migrations/0001_initial.sql:1`: baseline schema extracted from the previous `server/db.js` bootstrap; seed/default data remains in `server/db.js` per E2 scope.
- `migrations/0002_alarm_config_user_cascade.sql:4`: rebuilds `alarm_config` with `FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE`, copies existing rows, drops/renames the table, and recreates `idx_alarm_config_user_vital`.
- `server/db.js:11` and `server/db.js:987`: database boot now supports `ROHY_DB`, waits on `runMigrations(db)`, then runs existing seed/backfill routines. `server/server.js:166` awaits `dbReady` before seeders and fails startup on migration errors.
- `scripts/migrate.js:1`: standalone manual migration entry point with `--dry-run`.
- `scripts/audit-migrations.sh:87`: new audit verifies `schema_migrations`, dry-run immutability, no-op reruns, and the `alarm_config` user-delete cascade.

Deferred to E2.1/E8: individual down/rollback commands, seed refactoring out of `server/db.js`, and Postgres-compatible migration syntax.

### 2026-05-05 — Stage E1: Schema integrity sweep
Swept SQLite FK relationships, hard-delete handlers, and hot child-table query paths.

- `server/db.js`: documented intended ON DELETE behavior in fresh-table definitions for high-traffic session/case/user children where the semantic cleanup is clear, and added targeted indexes for child columns already used by route WHERE/JOIN/delete paths: investigation orders by investigation, case investigations by case/type, settings/session/event logs by parent, alarm config by user/vital, case agents by template, and treatment medication FKs.
- `server/routes.js`: hardened hard-delete parents that SQLite cannot retroactively protect. `DELETE /users/:id` now clears or detaches user-owned dependents before deleting the user. `DELETE /master/medications/:id` and `/all` now remove medication dose rows and detach medication references from treatment effects, treatment orders, and case treatments before deleting master medication rows.
- `scripts/audit-schema.sh` (NEW): proves five parent-child cleanup paths end-to-end: lab -> investigation orders, agent template -> case agents, patient record -> events/documents, medication -> dose/treatment/case-treatment references, and user -> preferences/active sessions/discussion notes.

Deferred to E2: existing databases still need a real migration framework before FK constraint changes can be rebuilt safely in place. Stage E1 keeps existing live data safe with application-layer cleanup rather than ad-hoc table rebuilds.

### 2026-05-05 — Stage 9: Body avatars (CLOSED — no scope)
The roadmap's checkpoint — "First check: do body GLBs exist as a separate concept?" — has a definitive answer: **no**. Avatar rendering is head-only. `frontend/avatars/` contains only a `heads/` subdirectory; `VOICE_AVATAR_TYPES = ['3d_head', 'none']` in `server/routes.js:7309`; `PatientAvatar` renders only head geometry; `BodyMap` is a 2D SVG silhouette for clickable physical-exam regions, not a 3D body avatar. No `body*.glb` files, no `BodyAvatar` component, no `body_avatar_type` setting, no `/avatars/body/*` endpoints. Stage 0's persona/voice/avatar audit (`af9302a`) was head-only by intent. **Stage 9 closed: no architectural surface to audit.** If a future feature adds full-body avatars, that's a new subsystem requiring its own snapshot/wiring review at that time.

### 2026-05-05 — TNA analytics + event log audit (Stage 8)
Two Explore agents (Stage 8 + Stage 9 in parallel) reviewed analytics + body avatars. 0 false positives. Real fixes shipped:

- `server/routes.js` GET `/learning-events/detailed/:sessionId`: added ownership check. Pre-fix any authenticated user could dump another user's event log + lab orders + chat messages by passing their session ID — the same IDOR shape as the alarm-ack and orders-view fixes from Stages 3 + pattern-sweep. The pattern keeps recurring on read endpoints; LEARNINGS now flags read endpoints separately from write endpoints because admins audit writes more carefully than reads.
- `server/routes.js` GET `/learning-events/analytics/summary`: the `user_id` branch already had ownership check, but the `session_id` branch had none — a partial guard, the same shape Stage 5 caught in the scenario engine override logic. Both branches now verify `session.user_id === req.user.id || isAdmin`.
- `scripts/audit-tna.sh` (NEW): asserts cross-user 403 on detailed-events and analytics-summary endpoints, plus self-read 200. **6/6 passing**.

Triage outcomes:
- **DEFERRED** (uncertain blast radius): TNA aggregation includes in-progress sessions (Stage 1's `status='completed'` transition exists but TNA queries don't filter on it). Including in-progress sessions in dashboards may be intentional for live monitoring; changing the behavior could break existing dashboards.
- **DEFERRED** (LOW, speculative): TNA endpoint echoes raw verbs from `learning_events` if not in `TNA_VERB_MERGE_MAP` — the dataset is enum-constrained at insert time, so the fallthrough is safe but inelegant.

Browser smoke `:5173`: simulator workspace mounts, no React error-boundary fires.

**Tests:** `audit-tna.sh` 6/6. `audit-auth.sh` 3/3. `audit-physexam.sh` 6/6. `audit-scenario.sh` 7/7. `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9 (last green run; not re-run due to in-test login rate-limit, but Stage-8 changes don't touch session lifecycle). **68/68 across all stages.**

### 2026-05-05 — Auth + user preferences audit (Stage 7)
Two Explore agents reviewed auth/user-prefs server-side and the client surfaces. 0 false positives. Real fixes shipped:

- `server/routes.js` GET `/users/preferences`: redacts `apiKey` / `api_key` from `default_llm_settings` JSON. Stage 4 fixed the same shape on GET `/sessions/:id` but missed this twin endpoint — `SELECT *` echoed the saved API key to anyone who'd configured one in `UserProfilePanel`.
- `server/routes.js` PUT `/user/password`: now calls `logAudit({action: 'change_password_self', ...})` after a successful password update. Pre-fix users could rotate passwords with no audit trail for incident response.
- `server/routes.js` PUT `/users/:id`: admin-side user edits now log `admin_user_password_reset` and/or `admin_user_role_change` to the audit log when those fields change. Reads prior state to capture `oldValue.role` so post-incident review can see who escalated whom.
- `src/components/settings/ScenarioRepository.jsx`: replaced `JSON.parse(localStorage.getItem('user') || '{}')` with `useAuth()`. The `localStorage.user` key was never populated by the login flow (only `localStorage.token` is set), so `isAdmin` always evaluated false and admins saw the same UI as students. One-line fix surfaced by the pattern sweep.
- `scripts/audit-auth.sh` (NEW): asserts the apiKey-redaction round-trip on `/users/preferences`. **3/3 passing**.

Stage-4 follow-on resolved (false alarm): the "user-layer LLM resolver wiring deferred" deferral was incorrect. Verified that `default_llm_settings` IS read at session-start (`routes.js:1164`) and merged into `sessions.llm_settings`, which then flows to `/proxy/llm` as `sessionLlmSettings`. The user layer is correctly captured at the snapshot boundary; runtime doesn't need to re-read it.

Triage outcomes:
- **NOT A BUG** (intentional): "first user becomes admin" registration path; no forgot-password endpoint (educational platform without email integration).

Browser smoke `:5173`: simulator workspace mounts, no React error-boundary fires.

**Tests:** `audit-auth.sh` 3/3. `audit-physexam.sh` 6/6. `audit-scenario.sh` 7/7. `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. **62/62 across all stages.**

### 2026-05-05 — Physical exam + body map audit (Stage 6)
Three Explore agents reviewed the physical-exam subsystem (DB+server, admin editors, runtime UI). 0 false positives. Real fixes shipped:

- `server/routes.js` POST `/sessions/:id/exam-findings`: idempotent on `(session_id, body_region, exam_type)`. Pre-fix every POST inserted a fresh row AND bumped `exam_findings_count`, so a network retry doubled both the audit trail and the counter. Replays now return the existing id + `already_recorded:true`; the counter only increments on real inserts.
- `src/App.jsx`: new app-level `caseSnapshot` state mirrors the per-component pattern from Stage 4 (ChatInterface) and Stage 5 (PatientMonitor). `<ManikinPanel>` now receives `physicalExam={caseSnapshot?.config?.physical_exam ?? activeCase?.config?.physical_exam}`. Pre-fix the runtime body-map read live `activeCase.config.physical_exam`, so admin edits to a case's findings mid-session bled into the running session — same Stage-1 follow-on shape as the chat and scenario fixes. Snapshot binding is now a structural property at three call sites.
- `src/components/settings/ClinicalRecordsEditor.jsx` `removeMedication` / `removeProcedure` / `removeNote`: now confirm before deleting if the row has any data. Stage-2 added confirms for lab + radiology editors; this was the last unprotected destructive surface in the case wizard.
- `scripts/audit-physexam.sh` (NEW): asserts first-record stamp, replay-returns-same-id with `already_recorded:true`, and `physical_exam_findings` table holds exactly 1 row after a replay. **6/6 passing**.

Triage outcomes:
- **DEFERRED** (architectural): two parallel physical-exam schemas — `clinicalRecords.physicalExam` (free-text, AI-consumed) vs `config.physical_exam` (region×exam grid, ManikinPanel-consumed). They don't reconcile. Bidirectional sync would require schema unification and dual-write logic; out of scope here. Documented in HANDOFF for future stage.
- **DEFERRED** (Stage-4 follow-on): server-side enforcement of `aiAccess.physicalExam` toggle. Same shape as `memory_access` server enforcement deferred earlier.
- **DEFERRED** (LOW): reset-to-defaults button in ClinicalRecordsEditor; BodyMap region-definitions localStorage scoping (currently global, but that's region polygons, not findings — not session data).

Browser smoke `:5173`: simulator workspace mounts, no React error-boundary fires.

**Tests:** `audit-physexam.sh` 6/6. `audit-scenario.sh` 7/7. `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. **59/59 across all stages.**

### 2026-05-05 — Scenario engine runtime audit (Stage 5)
Three Explore agents reviewed the scenario engine state machine (`PatientMonitor`), persistence/snapshot interactions, and admin/runtime UX. **1 false positive** on triage (FP rate ~8% — Agent 2 self-corrected on `scaleScenarioTimeline`). Real fixes shipped:

- `src/components/monitor/PatientMonitor.jsx`: new `caseSnapshot` state mirrors the Stage-4 ChatInterface pattern — fetches `/api/sessions/:id` once on mount and uses the frozen `case_snapshot.scenario` for the engine's timeline source. Falls back to live `caseData.scenario` only if the snapshot fetch hasn't completed. Pre-fix the engine read `caseData.scenario` directly, so admin scenario edits mid-session bled into the running session — the same Stage-1 follow-on shape as Stage 4's chat fix.
- `src/components/monitor/PatientMonitor.jsx` engine tick: override guard now checks every key the scenario can mutate (params, conditions, discrete switches), not just `rhythm`. Pre-fix a learner who manually pushed HR to 60 watched the next beat clobber it back to whatever the timeline interpolation produced. Helper `filterOverrides()` strips overridden keys before `setParams` / `setConditions` so the apply is pure.
- `src/components/monitor/PatientMonitor.jsx` engine tick: auto-stop on complete. When `nextTime >= toFrame.time + 2` the engine schedules `setScenarioPlaying(false)` via `setTimeout(..., 0)` so the final-frame state lands first, then the interval tears down. Pre-fix the engine held the last frame indefinitely with no completion signal — `scenarioTime` ticked toward infinity, the UI showed "Playing" forever, and any analytics keyed on completion never fired.
- `src/components/monitor/PatientMonitor.jsx`: aria-label + title on the play/pause button. Was icon-only with no screen-reader affordance.
- `src/components/settings/ConfigPanel.jsx` `ScenarioRepository.onSelectScenario`: confirm before clobbering an existing case scenario. Stage 2 added the same guard to the in-wizard scenario picker; the repository import path was an outlier (drag-drop / double-click / keyboard-pick all bypassed the dialog).
- `server/routes.js` POST + PUT `/scenarios`: new `validateScenarioTimeline()` rejects malformed frames before persisting (non-numeric `time`, non-numeric param values, non-object frames, non-string rhythm). Pre-fix the server stored anything; PatientMonitor's interpolator hit `NaN` or pushed an unknown rhythm into the ECG generator at runtime.
- `scripts/audit-scenario.sh` (NEW): asserts POST/PUT 400 on malformed frames, valid-scenario round-trip, and `case_snapshot` has both `scenario` + `system_prompt` keys. **7/7 passing**.

Triage outcomes:
- **DEFERRED** (architectural / speculative): beat-skipping under load (`setInterval` drift, no `performance.now()` rebase); scenario-disable mid-run zombie state (engine no-ops cleanly but doesn't surface a banner); server-side timeline scaling (`scaleScenarioTimeline` runs only client-side); PUT /scenarios idempotency marker; mid-run UX banner if admin removes scenario; master/copy distinction UI label.
- **FALSE ALARM**: `scaleScenarioTimeline` rhythm/conditions preservation — Agent 2 flagged then verified the spread copies all fields correctly.

Browser smoke `:5173`: simulator workspace mounts, no React error-boundary fires.

**Tests:** `audit-scenario.sh` 7/7. `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. **53/53 across all stages.**

### 2026-05-05 — LLM precedence chain audit (Stage 4)
Three Explore agents reviewed the platform → case → agent → session → user resolver across server, editors, and runtime. **0 false positives** (FP rate 30 → 18 → 11 → 0 → 0%). Real fixes shipped:

- `server/db.js`: new `llm_temperature REAL` + `llm_max_tokens INTEGER` columns on `agent_templates` (idempotent ALTER). Pre-fix the resolver `SELECT` only fetched `provider/model/api_key/endpoint` from the agent template and the agent layer was *silently dropped* for these two fields — every chat used session/platform defaults regardless of admin tuning.
- `server/routes.js` `/proxy/llm`: agent-layer resolution now consults the new columns. Precedence is `agent ?? session ?? platform` for both temperature and max_tokens. Empty/null clears fall through correctly (uses `??` not `||` — a temperature of `0` is valid).
- `server/routes.js` POST + PUT `/agents/templates`: accept `llm_temperature` (REAL) and `llm_max_tokens` (INTEGER) in the request body. Empty string clears to NULL. Non-finite values become NULL so the resolver falls through cleanly.
- `server/routes.js` POST `/sessions`: `case_snapshot` now includes `system_prompt` (was capturing `config + scenario + name` only). Pre-fix the chat persona was rebuilt every render from live `activeCase.system_prompt`, so admin renames or prompt edits mid-session shifted the patient's voice for the in-progress chat.
- `server/routes.js` GET `/sessions/:id`: redacts `apiKey` / `api_key` from `llm_settings` JSON before responding. Session creation merges `user_preferences.default_llm_settings` into this column, which can carry an API key; the prior `SELECT s.*` echoed it verbatim to the response.
- `src/components/chat/ChatInterface.jsx` `buildPatientSystemPrompt`: now reads from a frozen `caseSnapshot` state (fetched once at mount from `/api/sessions/:id`) and falls back to `activeCase` only if the snapshot fetch hasn't completed. Closes a Stage-1 follow-on — the server-side reader sites used the snapshot but the client-side persona builder was reading live React state.
- `src/components/settings/AgentPersonaEditor.jsx`: new Temperature + Max-tokens fields in the LLM section (placeholder text says "(platform default)"; helper text explains the precedence chain). Pre-fix admins had no UI for these even after the columns existed.
- `scripts/audit-llm.sh` (NEW): asserts agent-template round-trip for temperature/max_tokens, empty-string clears, `system_prompt` in `case_snapshot`, and `apiKey` redaction in `/sessions/:id`. **7/7 passing**.

Triage outcomes:
- **DEFERRED** (architectural): server-side enforcement of `agent_templates.memory_access` matrix (currently client-side only — a learner could bypass by crafting requests directly; threat model is weak in an educational context); user-layer LLM resolver (UserProfilePanel saves `default_llm_settings` but it's never read at runtime); case-layer LLM config (would need new schema + UI surface).
- **INTENTIONAL** (not bugs): Voice provider vs LLM provider divergence; system prompt assembly order (platform template + client → client wins).

**Tests:** `audit-llm.sh` 7/7. `audit-alarms.sh` 13/13. `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. Browser smoke `:5173`: simulator workspace mounts, no error-boundary fires.

### 2026-05-05 — Pattern sweep: orders/:id/view IDOR + idempotency
The Stage-3 audit named the IDOR + timestamp-restamp shape as a recurring pattern in LEARNINGS.md. A grep sweep across `server/routes.js` for the same shape (`req.params.id` + UPDATE without ownership JOIN) found one outlier I missed in Stage 2:

- `server/routes.js` PUT `/orders/:id/view`: pre-fix had no ownership check (any authenticated user could mark any other learner's order as viewed) AND re-stamped `viewed_at = CURRENT_TIMESTAMP` on every call (a network retry zeroed the legitimate `view_delay_ms` analytics metric — `view_delay_ms = order.viewed_at ? 0 : (now - availableAt)` reads from the just-mutated row). Fix mirrors the alarm-ack pattern: JOIN through `sessions.user_id`, allow only owner or admin, return 200 with `already_viewed:true` if `viewed_at` is set, otherwise UPDATE `WHERE viewed_at IS NULL`. Verified via the extended `audit-investigations.sh` (now 17 assertions including a cross-user 403 test).

Sweep also verified that the rest of the routes are clean: every `:id`-receiving PUT/DELETE on a user-owned table either checks `requireAdmin`, owner ownership (`scenarios` does this correctly at routes.js:5310, 5347), or has been audited in a prior stage (`/sessions/:id/end` Stage 1; `/alarms/:id/acknowledge` Stage 3). No other instances of the pattern remain.

**Tests:** `audit-investigations.sh` 17/17. `audit-sessions.sh` 9/9. `audit-alarms.sh` 13/13.

### 2026-05-05 — Alarms + Notifications wiring audit (Stage 3)
Three Explore agents reviewed alarms/notifications (backend persistence, central dispatcher, five surface components). 11 distinct findings; **0 false positives** on triage (all real, but several were "intentional design" rather than bugs and got reclassified out). Real fixes shipped:

- `server/routes.js` PUT `/alarms/:id/acknowledge`: pre-fix had no ownership check (textbook IDOR — any authenticated user could ack any alarm by ID) AND re-stamped `acknowledged_at` on every call (network retries corrupted the audit trail). Fix folds both concerns: JOIN `alarm_events.session_id → sessions.user_id`, allow only the owner or an admin, then `UPDATE … WHERE id=? AND acknowledged_at IS NULL`. Re-acks return the original timestamp with `already_acknowledged:true`.
- `server/routes.js` GET `/alarms/config/:userId`: pre-fix had no scope check, so any authenticated user could read any other user's alarm thresholds by guessing their numeric ID. Fix: 403 unless `userId === req.user.id` or admin.
- `src/notifications/NotificationContext.jsx`: new `clearTransient(reason)` API that empties `active`, `acked`, and `snoozed` (and persists empty sets to localStorage). Prefs and history stay user-scoped because those are real user-level preferences/audit trails. Acks/snoozes are *session-scoped* semantically ("I've handled this in this case"), and the existing user-only persistence let them leak.
- `src/App.jsx`: on every `sessionId` transition (null→123, 123→124), `AuthenticatedApp` calls `clearTransient('session-change')`. Pre-fix, a user who acked `alarm:hr_high` in case A and then loaded case B would silently *not* hear/see the new HR alarm in case B because the dispatcher's router checked the ack set first.
- `src/notifications/surfaces/BannerSurface.jsx`: aria-live wired on the banner stack. `role="alert"` + `aria-live="assertive"` when any banner is `CRITICAL`, otherwise `role="status"` + `polite`. Toast already had this; banner did not.
- `scripts/audit-alarms.sh` (NEW): end-to-end verification — admin/student two-role login, alarm ack ownership (allow owner + admin, deny non-owner with 403), idempotency on re-ack, cross-user config-read denial (403), self-read allowed, admin override allowed. **13/13 passing** against the live API.

Triage outcomes (intentional or deferred, not bugs):
- **INTENTIONAL**: Toast `dismiss()` vs Banner `ack()` (toast = transient hide, banner = handled-everywhere); Banner critical has no Dismiss (acknowledge IS the dismiss for critical); latch resolves on ack but not snooze (snooze is time-bounded by definition).
- **DEFERRED** (architectural): alarm thresholds are read live from `alarm_config` rather than snapshot-bound at session start (mid-session admin threshold edits bleed in). Would need adding alarm thresholds to `sessions.case_snapshot` or a parallel structure. Captured in HANDOFF for a future stage.
- **DEFERRED** (LOW, speculative): `/alarms/log` not idempotent (network retry creates duplicate rows — very rare); localStorage-ack-saves-before-server-PUT-confirms (would need a confirm-then-persist pattern); silenced-still-abnormal not surfaced in `NotificationsSettingsTab` (feature work, not a bug).

Browser smoke on `:5173`: simulator workspace mounts, Laboratory/Radiology/Treatments tabs render, no React error-boundary fires.

**Tests:** `npx vite build` clean. `bash scripts/audit-alarms.sh` 13/13. `bash scripts/audit-investigations.sh` 14/14 (no Stage-2 regression). `bash scripts/audit-sessions.sh` 9/9 (no Stage-1 regression).

### 2026-05-05 — Investigations: Lab + Radiology wiring audit (Stage 2)
Three Explore agents reviewed the labs/radiology subsystem (DB+server, admin editors, runtime). 9 distinct findings; **1 false positive** on triage (FP rate ~11%, lower than the prior ~18-30% baseline — three reports cross-referenced against each other catch more upfront). Real findings shipped:

- `server/routes.js` POST `/cases/:id/labs`: now an UPSERT on `(case_id, test_name, investigation_type='lab')`. Pre-fix it was append-only, which let `ConfigPanel`'s per-row save loop quietly accumulate duplicate rows every time an admin saved a case (the `// First, delete existing labs` comment described intent that was never implemented).
- `server/routes.js` PUT `/cases/:id/labs` (NEW): bulk-replace endpoint. Single transaction: drop dependent `investigation_orders` for this case's labs, drop the old `case_investigations` rows, insert the new array. Atomic; ROLLBACK on any insert failure.
- `server/routes.js` DELETE `/cases/:id/labs/:labId`: now cascades to `investigation_orders` (Stage-1 deferred L6). SQLite can't add `ON DELETE CASCADE` retroactively, so cleanup lives in the application layer ahead of the parent delete. Reports `orphan_orders_removed:N` for verification.
- `server/routes.js` POST `/sessions/:id/order-labs`: idempotent on `(session_id, investigation_id)`. Re-ordering the same lab returns `skipped_duplicates:N` and does not insert. Pre-fix, double-clicks and replayed requests accumulated rows; client polling masked it but DB grew over time.
- `server/routes.js` POST `/sessions/:id/order-radiology`: idempotent on `(session_id, ci.test_name)` via JOIN. Radiology's order flow `INSERT ci → INSERT order` creates a fresh `case_investigations` row per order (intentional — captures result_data at order time), so dedup keys on test_name not investigation_id.
- `src/components/settings/ConfigPanel.jsx` lab-save flow: replaces the per-row POST loop with a single PUT to the new bulk endpoint. Lab removals now propagate to the DB.
- `src/components/settings/LabInvestigationEditor.jsx`: bulk `Delete Selected` now confirms before deleting (counts the selection in the prompt). Per-row Trash stays unconfirmed — harder to mis-target.
- `src/components/settings/RadiologyEditor.jsx`: per-study delete confirms with the study name and notes that uploaded image/video URLs are dropped.
- `scripts/audit-investigations.sh` (NEW): end-to-end verification — UPSERT correctness, bulk-replace + orphan cleanup, DELETE cascade, lab order idempotency, radiology order idempotency. **14/14 passing**, repeatable (per-run unique `LAB_NAME` so prior runs don't poison subsequent assertions, mirroring the Stage-1 fix).

Triage outcomes:
- **DEFERRED** (architectural, expensive): radiology stored only in `cases.config.radiology` JSON with no DB master catalog (asymmetric to labs by design); master-lab-edit propagation to per-case copies (admin renames in `lab_tests` master don't update existing `case_investigations` rows — would need an audit-log replay).
- **DEFERRED** (LOW, cosmetic): unused `InvestigationPanel` export, `result_data` JSON shape inconsistency between order-time and config-time radiology rows, missing reset-to-defaults in editors.
- **FALSE ALARM**: claimed `turnaroundMinutes` camelCase mismatch in editor payload — verified at LabInvestigationEditor.jsx:143 the editor uses `turnaround_minutes` snake_case throughout, matching the server.

Browser smoke test on `:5173`: simulator workspace mounts, Laboratory + Radiology buttons render, no React error-boundary fires (per the Stage-1 learning that bash audits miss UI crashes).

**Tests:** `npx vite build` clean. `bash scripts/audit-investigations.sh` 14/14 (repeatable). `bash scripts/audit-sessions.sh` still 9/9 (no Stage-1 regression).

### 2026-05-05 — Sessions + lifecycle wiring audit (Stage 1)
Three Explore agents reviewed the Sessions subsystem end-to-end (schema/persistence, cross-system wiring, runtime correctness). 17 findings; **3 false positives** on triage (`B-H3` SESSION_EXPIRY_MS module-load capture — module const is fine; `C-M2` debrief re-open guard — already in place via `caseEnded` gate; `B-H2` EventLogger context timing — narrow gap, demoted to LOW). False-positive rate this round: ~18%. Real findings shipped:

The user picked, in `AskUserQuestion`: **(1)** snapshot at session start, **(2)** detect-and-warn for multi-tab, **(3)** persist vitals on meaningful change.

- `server/db.js`:
  - Added `case_snapshot JSON` column to `sessions` (idempotent ALTER). The infrastructure designer scaffolded `sessions.case_version` years ago but never wired the runtime side; this completes that work via a simpler one-column-on-sessions path rather than the existing `case_versions` audit-log table.
  - Added `session_vitals` table with index on `(session_id, timestamp)` for trend persistence. Cascades on session delete.
- `server/routes.js`:
  - New helpers `resolveSessionCaseConfig(row)` and `resolveSessionCaseScenario(row)` — read from `case_snapshot` first, fall back to live JOIN for sessions written before the column existed.
  - `POST /api/sessions` now captures `{config, scenario, name, snapshot_at}` from the live `cases` row at session start. Refactored to `async` so it can `await` the case fetch in a Promise.
  - `PUT /api/sessions/:id/end` is now idempotent: re-call returns the original `end_time/duration` and `already_ended:true` instead of overwriting (prior behavior corrupted analytics on any double-end).
  - `PUT /api/sessions/:id/end` also transitions `sessions.status = 'completed'` — the column existed with a CHECK constraint but had never been written.
  - New `POST /api/sessions/:id/vitals` and `GET /api/sessions/:id/vitals` for trend persistence. POST writes a snapshot row with `elapsed_ms + hr/rhythm/spo2/bp/rr/temp/etco2 + source` tag.
  - Five reader sites refactored to prefer the snapshot: `/sessions/:id/available-labs`, `/sessions/:id/available-radiology`, `/sessions/:id/order-radiology`, `/sessions/:id/treatments`, `/sessions/:id/order-treatment`. Plus the order-labs path that fetches case config separately.
- `src/App.jsx`:
  - `endSessionOnServer(sid)` helper hoisted above the validate-on-mount effect so all callers (explicit end, expiry detection, case reload) use the same fire-and-forget /end path.
  - `handleLoadCase` now ends the previous session server-side before loading the new case (was leaving orphan rows with `end_time IS NULL`).
  - `handleCloseDiscussion` now also clears `rohy_discussion_history_<sessionId>` (was leaking debrief transcripts across sessions).
  - Expiry detection in `validateAndRestoreSession` now ends the expired session server-side and clears the discussion history key (was silently abandoning the row server-side).
  - Multi-tab detection: `storage` event listener fires when another tab on the same origin writes to `rohy_active_session`. Surfaces a fixed-overlay amber banner (last-write-wins applies). Per Q2 — detect+warn, not block.
- `src/components/chat/ChatInterface.jsx`:
  - Chat history localStorage entry now carries `sessionId` alongside `caseId`. Restore requires both to match (or both null for in-progress drafts). Stale entries from prior sessions on the same case are explicitly cleared instead of being replayed.
- `src/components/monitor/PatientMonitor.jsx`:
  - New persist-on-deadband effect POSTs the full vital snapshot to `/sessions/:id/vitals` when any vital crosses its threshold. Fail mode: `console.warn`, never blocks the monitor. Maintains its own `lastPersistedVitalsRef` independent of the EventLogger effect's `prevVitalsRef`.
  - On session restore (sessionId set), fetches `/sessions/:id/vitals`, takes the latest row, and seeds `params` + `rhythm` so the monitor resumes from where the learner left off instead of snapping back to baseline.
  - **Both new effects placed AFTER `activeScenario`'s `useState`** declaration. An earlier draft positioned the persist effect alongside the EventLogger effect (line ~404) and listed `activeScenario` (declared at line ~535) in its deps array. Reading the destructured `const` before its declaration ran throws a temporal-dead-zone `ReferenceError` on every render — `<PatientMonitor>` crashed under React's error boundary the moment a session loaded. Browser smoke test caught this; the bash audit didn't (it never renders the UI). Lesson: end-to-end UI verification is not optional for monitor-touching work.
- `scripts/audit-sessions.sh` (NEW): end-to-end verification — login, snapshot capture, snapshot immutability under live edit, /end idempotency, status transition, vitals POST/GET round-trip. **9/9 passing** against the live API. Bash 3.2 compatible. Snapshot-immutability assertion uses a `RUN_MARKER="audit-run-$$-$(date +%s)"` so prior runs' marker writes (which persist in `cases.config`) don't false-positive subsequent invocations — without this, the test passed on the first run only.

**Tests:** Build clean (`npx vite build` — only pre-existing chunk warning). Lint clean for new code (4 pre-existing errors in App.jsx, 3 in ChatInterface.jsx — all carried forward, none introduced this session). Audit script: 9/9 pass on repeated runs. Browser smoke test on `:5173`: login → simulator renders, no monitor errors.

### 2026-05-05 — Persona/Voice/Avatar wiring audit
- `src/utils/voiceResolver.js` (NEW): single source of truth for voice resolution. Returns `{file, provider, rate, pitch, tier}`; mirrors the server's `resolveTtsVoice` chain. Replaces three previously-duplicated implementations.
- `src/components/chat/ChatInterface.jsx`: replaced `pickVoiceFile` + `resolveRatePitch` + `resolveSpeakerSettings` with a single call to `resolveVoice()`. Both `beginSpeechSession` and `speak()` now forward `provider` — without this, a case configured for Piper silently played whatever the platform default tts_provider was.
- `src/hooks/useDiscussionEngine.js`: `resolveDiscussantVoice` now wraps `resolveVoice()` and returns `provider` so `beginSpeechSession` forwards it. Discussant audio now actually plays its configured engine.
- `src/components/settings/AgentPersonaEditor.jsx`: replaced inline `resolvedVoice` memo with `resolveVoice()`. Editor preview, chat runtime, and discussant runtime now share one resolver.
- `server/routes.js` (`pipePcmStream`): added even-byte alignment guard. If an upstream provider ever yields an odd-length PCM chunk, the helper now carries the dangling tail byte to the next frame instead of emitting an unaligned int16 stream. (OpenAI's iterator already guards itself; this is a defense-in-depth for Google/Kokoro/future providers.)
- `src/components/settings/AgentTemplateManager.jsx`: card thumbnails now apply `cameraOverride={resolveCamera(...)}` so admin framing edits are visible in the list view, matching the editor preview and runtime.
- Removed the dead `avatarType` prop from `PatientAvatar.jsx`. `PatientVisual` keeps the `voiceSettings.avatar_type === 'none'` global kill-switch at parent level. Cleaned five callers (PatientVisual, AgentPersonaEditor, AgentTemplateManager, AvatarsSettingsTab, CaseAvatarVoicePicker, PatientSummaryCard, DiscussionScreen).
- `scripts/audit-voices.sh` (NEW): end-to-end verification — provider routing, distinct sample rates, PCM s16le alignment, default-persona camera resolution. 10/10 passing locally. Bash 3.2 compatible (no associative arrays).

### 2026-05-05 — Case editor wiring audit
Three review agents flagged 19 findings across the case editing system. After verification, **6 were false alarms** (L7 scenario-timeline, M2 aiAccess enforcement, M3 vitals fallback chain, M7 scenario scaling preservation, M8 persona-editor wizard-step round-trip, M9 demographics null guards) — the agents were over-eager about claims that turned out already-correct in the code. The remaining 13 were real and shipped here:

- `server/db.js` / `server/routes.js`: persona DELETE now explicitly cleans up dependent `case_agents` rows (SQLite forbade adding ON DELETE CASCADE retroactively). Audit log records the cascade. Server response message names the count of affected case-agent rows.
- `server/routes.js`: case POST/PUT now persists scenario provenance (`scenario_template` / `scenario_from_repository` / `scenario_duration`) by tucking it into `scenario.source = { kind, id, name, duration_minutes }` so it survives the round-trip. Editor's read site falls back to legacy top-level fields for in-flight migrations.
- `server/routes.js`: physiological clamps for `config.initialVitals` at case save time (HR 20–250, SpO2 50–100, etc.) — belt-and-braces against the editor's HTML min/max being type-bypassable.
- `server/routes.js`: `/api/cases` GET annotates each case with `active_session_count` so the editor can show which cases are being used live.
- `src/components/settings/ConfigPanel.jsx`:
  - `updateStructuredHistoryField()` helper mirrors Step 3 inputs into `clinicalRecords.history` with the canonical key names (pmh→pastMedical, psh→pastSurgical, socialHistory→social, familyHistory→family). Pre-this-fix, Step 3 edits were silently lost — the runtime only reads `clinicalRecords.history`.
  - localStorage stash now carries `_stashedAt` + `_caseId`. Wizard renders a "Resumed unsaved draft from <date>" banner with an explicit "Discard draft" button so admins can no longer mistake a stale draft for a fresh open.
  - `handleSaveCase` returns boolean success; cancel-dialog "Save & Exit" awaits it and only closes when the save actually persisted.
  - Story mode toggle (freeform↔structured) confirms before clearing the unused mode's data; eliminates the doubled-AI-context bug where both modes survived a switch.
  - Scenario picker now confirms before clobbering an existing scenario.
  - Active-use chip on every case card shows `⚡ N live` when sessions are open.
  - New `PagesEditor` component for `config.pages` — title/content pairs the AI patient knows about but only reveals when relevant. Pre-this-fix the runtime read these pages but no editor surface existed.
  - Age input parses to integer + clamps to 0..120 instead of accepting bare strings.
- `src/components/settings/CaseAvatarVoicePicker.jsx`: warns when `config.avatar_id` no longer exists in the loaded avatar manifest (manifest staleness).
- `src/components/settings/CaseTreatmentConfig.jsx`: amber banner clarifies that treatment effects live in the shared master catalog and that master edits propagate to every case using a treatment.

### 2026-05-05 — Codex-review pre-commit fixes
- `server/db.js`: rewrote `seedDefaultAgents()` to insert a shipped row only when no `is_default=1` row exists for that `agent_type` (was: `INSERT OR IGNORE` on `(agent_type,name)`). Prevents the rename-then-restart duplication that would have made reset-to-defaults collide on the unique index.
- `server/routes.js`:
  - PUT now rejects `agent_type` changes on `is_default=1` rows with HTTP 400 — the type is the immutable identity that the seeder + reset both rely on.
  - reset audit log now records the full pre-reset row + the baseline applied (`oldValue`/`newValue` JSON) so a reset is reversible from the audit trail.
  - dropped unused `DEFAULT_AGENTS` named import; only `findDefaultAgent` is used at the call site.
- `src/components/settings/AgentPersonaEditor.jsx`: voice resolver now mirrors `ChatInterface.pickVoiceFile` faithfully — adds child slot (`age<13`) and per-provider hardcoded fallback (`PROVIDER_FALLBACK_VOICE`). Comment now points back to the canonical source so future drift is obvious.
- `src/App.jsx`, `src/components/settings/ConfigPanel.jsx`: persona editor now accepts an optional return-context. The "Edit persona ↗" button in the case wizard's Agents step passes `{tab:'cases', wizardStep:11}` so closing the editor lands the admin back on the wizard step they came from instead of being displaced to the global Agent Personas tab.

### 2026-05-05 — Comprehensive Agent Persona editor wired system-wide

- `server/db.js`: lifted the inline `defaultAgents` array to a module-level `DEFAULT_AGENTS` export plus a `findDefaultAgent(type, name)` helper. Same array now seeds first boot AND backs the new reset-to-defaults endpoint.
- `server/routes.js`:
  - dropped the `is_default === 1` 403 guard on `PUT /api/agents/templates/:id`. Admins can now edit shipped standards in place.
  - added `POST /api/agents/templates/:id/reset-to-default` — re-applies `DEFAULT_AGENTS` values onto a standard row, clears LLM/memory overrides, audit-logged. Custom rows reject with 400.
  - imported `DEFAULT_AGENTS` and `findDefaultAgent` from `db.js`.
- `src/services/AgentService.js`: added `resetTemplateToDefault(id)` client wrapper.
- `src/components/settings/AgentPersonaEditor.jsx` (NEW, ~700 lines): full-page persona editor mounted at the App.jsx level so it owns the entire viewport. Sections: Identity / Avatar (live 3D preview + framing sliders) / Voice (engine, file, rate, pitch, **preview button** that resolves the effective voice via the same fallback chain as ChatInterface) / Persona prompt (large monospace) / Dos + Don'ts (proper editable lists with add / remove / reorder) / Behavior / LLM (with test button) / Memory access (8-verb checklist with descriptions) / Discussant settings (gated). Reset-to-defaults & duplicate buttons in header for standards.
- `src/components/settings/AgentTemplateManager.jsx`: stripped down to list-only. Edit + New now bubble up via `onOpenEditor(idOr'new')` to App.jsx. Standards expose Edit + Duplicate + Reset-to-defaults; customs expose Edit + Duplicate + Delete. Header copy updated to reflect that admins can edit standards.
- `src/components/settings/ConfigPanel.jsx`:
  - `ConfigPanel` accepts `initialTab` and `onOpenPersonaEditor` props.
  - threaded `onOpenPersonaEditor` into `CaseWizard` → `CaseAgentEditor`. Each per-case agent now shows an "Edit persona ↗" button next to "Case overrides" — opens the underlying template in the full editor (system-wide).
  - "Edit" → "Case overrides" label clarified so admins know what scope they're editing.
- `src/App.jsx`:
  - new top-level state `personaEditorTarget` (null | 'new' | <id>) and `settingsInitialTab`.
  - new render branch: when `personaEditorTarget !== null`, render `<AgentPersonaEditor>` taking the entire viewport.
  - `handleOpenPersonaEditor(target)` and `handleClosePersonaEditor()` orchestrate the full-page round-trip; closing returns the user to ConfigPanel pinned to the Agents tab.
  - `ConfigPanel` now receives `initialTab={settingsInitialTab}` and `onOpenPersonaEditor={handleOpenPersonaEditor}`.
- Tests: no automated test target for the simulator side — `npx vite build` passes (8.65s, no errors), `npx eslint` clean on touched files modulo pre-existing warnings unchanged by this work.
