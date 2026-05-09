### 2026-05-09 (night) — Unified data grid + export consolidation

The follow-up pass to last session's logging plumbing — replaces three hand-rolled tables with one shared component, kills four duplicate CSV export endpoints, and cleans up the System Logs panel.

- **New `LogGrid` component** (`src/components/analytics/LogGrid.jsx`) — TanStack Table v8 backed, headless. Sortable headers (click to toggle asc/desc), inline per-column filter row (toggleable), column show/hide chooser with persist-to-localStorage, density toggle (compact / comfortable, persisted), resizable columns, sticky header, click-to-copy on every cell, optional row-expand panel, paginated load-more bar that only appears when the data cap is reached.
- **Three viewers reduced to column configs.** `ActivityTable.jsx`, `SystemLogTable.jsx`, `ChatLogTable.jsx` rewritten as thin LogGrid wrappers — each declares its TanStack `ColumnDef[]` plus a fetch + an optional CSV export button in the header. Same UX across all three (toolbar shape, search box behavior, density toggle, column chooser).
- **New `SessionsTable.jsx`** — replaces the inline `<table>` that used to live inside ConfigPanel for the Sessions tab. Per-row `↓` button downloads the per-session CSV bundle from `/api/export/complete-session/:id`.
- **Export consolidation.** Four legacy server endpoints removed from `server/routes/analytics-routes.js`: `/api/export/login-logs`, `/api/export/chat-logs`, `/api/export/settings-logs`, `/api/export/session-settings`. All four were subsumed earlier by `/api/export/system-log/:source` (with `source = auth | config | chat | …`) and `/api/export/learning-events`. Callers + the four UI buttons that targeted them are gone too.
- **ConfigPanel `SystemLogs` section slimmed.** Dead `loginLogs` / `settingsLogs` / `sessionsList` state removed (each viewer fetches its own data now). Dead `login` and `settings` tab branches removed (their content lives in System Log → component=auth/config and Activity → category=AUTH/CONFIGURATION). The global "Export Data (CSV)" 6-button grid removed — exports are now inline per-tab. The header date pickers removed too — each viewer's toolbar owns its own from/to (and these are also the export filters).
- **SessionsTable bug fix during the smoke test.** First wiring fetched `/api/sessions` (404); switched to `/api/analytics/sessions` to match what the legacy ConfigPanel used. Caught by exercising the new tab in the browser, not by tests — vindicates HANDOFF point #4 ("verify by actually using the app").
- **Pre-existing test brittleness fixed in passing.**
  - `tests/server/analytics-tna.test.js` — three assertions hardcoded counts that didn't account for last session's auth dual-write inserting a `LOGGED_IN` learning_events row per `login()` call. Updated counts (28 → 29, etc.) with comments pointing at the source. The `uniqueVerbs` assertion stayed strict because session-less LOGGED_IN events count in `totalEvents` but not in the sequence-builder.
  - `tests/server/sessions-concurrency.test.js` — original contract demanded N concurrent POST /sessions return N distinct ids. Last session's intentional 30s dedup window collapses bursts to one session. Test rewritten to assert the new contract: all responses succeed, distinct count ≤ 3 (allowing for a millisecond-boundary edge case in CI), DB row count matches distinct id count exactly.
  - `tests/server/sql-injection-guard.test.js` — six interpolated SQL strings flagged by the static guard (in `/export/learning-events`, `/export/system-log/:source`, `/system-log/tables`, `/system-log/table/:name`, TNA filter helper) added to the allowlist with substring + justification. All six are server-controlled enums (`EXPORT_SOURCES` map, `sqlite_master` enumeration, hardcoded order columns) with values parameterised; no user input touches the interpolated identifier.
- **New regression test.** `tests/server/exports-unification.test.js` (8 tests) — pins that the four retired endpoints return 404, the four survivors return 200 with `Content-Type: text/csv`, and `/api/export/system-log/:source` rejects unknown sources with 404.

Files touched:
- `src/components/analytics/LogGrid.jsx` (new) — 280 lines, the shared grid.
- `src/components/analytics/ActivityTable.jsx` — rewritten as a 200-line column config + fetch + CSV header button.
- `src/components/analytics/SystemLogTable.jsx` — rewritten with a per-source export dropdown in the toolbar.
- `src/components/analytics/ChatLogTable.jsx` — rewritten with row-expand panel showing full content + provenance.
- `src/components/analytics/SessionsTable.jsx` (new) — replaces the inline ConfigPanel table.
- `src/components/settings/ConfigPanel.jsx` — `SystemLogs` function gutted: removed dead state, dead tab branches, the export grid, and the global date picker. Net −430 lines.
- `server/routes/analytics-routes.js` — four `/export/*` route registrations removed (~190 lines), replaced with a comment block documenting the canonical surface.
- `package.json` — `@tanstack/react-table` added.
- `tests/server/analytics-tna.test.js`, `tests/server/sessions-concurrency.test.js`, `tests/server/sql-injection-guard.test.js` — pre-existing brittleness fixed.
- `tests/server/exports-unification.test.js` (new) — 8-test regression guard.

Tests: full server suite `npx vitest run --no-coverage tests/server/` → 545 passing | 11 skipped | 0 failing. ConfigPanel.test.jsx → 17/17. New exports-unification → 8/8. Build green (`npx vite build`).

Smoke test: started `OYON_ENABLED=1 npm run dev`, logged in `admin/admin123`, opened Settings → System Logs, cycled all four viewers (Activity, Sessions, System Log, Chat Log), confirmed the chat-blank bug from HANDOFF #5 is no longer reproducible (chat panel + monitor both stay rendered after sending a message). The SessionsTable wrong-endpoint bug above was caught here, fixed, and re-verified.

Out of scope (deliberate):
- True server-side cursor pagination — current LogGrid still uses load-more increments (100 → 500 → 2000 → 10000) over the existing limit-based endpoints. Migrating to `WHERE id < cursor LIMIT N` is straightforward but every endpoint has different sort keys and would need its own contract.
- Reflection Questionnaire migration to LogGrid — its row shape is a variable-length nested object, not a flat row, so the current expand-on-click `<table>` stays.

### 2026-05-09 (late evening) — Unified learning-analytics logging (PLAN_LOGGING.md)

Two parallel event-logging systems coexisted — `event_log` (legacy, near-empty) and `learning_events` (modern xAPI, populated). The user reported "no student actions in the logs"; root cause was that the ConfigPanel "Event Log" tab read the empty legacy table while the populated modern table was on a sibling tab. PLAN_LOGGING.md folds both into one canonical pipeline with server-enforced trinity invariant. Codex round-1 flagged 3 issues (server-vs-client trinity authority, real CSV endpoint, legacy writer migration); round-2 flagged 5 fresh ones (drop-accounting contract, export DoS cap, regression-guard scope). Both reviews folded into v2 of the plan before code.

- **Phase 1 — server-enforced trinity.** New `resolveSessionTrinity(sessionId, tenant_id)` in `server/routes/_helpers.js`. `POST /api/learning-events` and `POST /api/learning-events/batch` now derive `(user_id, case_id)` from the sessions row; client-supplied values are ignored. Cross-tenant `session_id` is dropped, not silently mislabeled. Batch response shape: `{ inserted, dropped, total, dropped_reasons: { cross_tenant, missing_required_field, db_error } }`. `BackendSurface.js` strips `user_id`/`case_id` from the payload and surfaces drops via `console.warn` when `resp.dropped > 0`. Race fix: switched the batch insert loop to `Promise.all(runPromises).then(finalize)` so the response counter is correct.
- **Phase 2 — legacy writer migration.** Removed all production `INSERT INTO event_log`. Migrated `orders-routes.js:1383 lab_value_edited` to `learning_events` with new verb `EDITED_LAB_VALUE` (added to both server `LEARNING_VERBS` allowlist and client `VERBS`/`VERB_METADATA`). Dropped redundant dual-write at `orders-routes.js:1170 investigation_ordered`. Deleted obsolete `apiPost('/events/batch', …)` from `ChatInterface.jsx:749`. Retired the `POST /events/batch` route handler; kept the table itself for `_helpers.js` purge code. New regression guard `tests/server/event-log-deprecation.test.js` greps for any new `INSERT INTO event_log` outside an explicit allowlist.
- **Phase 3 — bug fixes + minor instrumentation.** `eventLogger.js:319 caseLoaded()` now calls `setContext({ caseId })` so mid-session case switches re-stamp the singleton. `BackendSurface` flushes immediately on `ENDED_SESSION` and on cleanup so logout / NotificationProvider re-key doesn't drop the last batch. Added `EventLogger.log('CLICKED', 'button', …)` on the logout button so the act of logging out is itself recorded.
- **Phase 4 — single canonical viewer.** Deleted `src/components/monitor/EventLog.jsx`. Removed the `events` tab from `ConfigPanel.jsx` (button, content branch, session selector state, `EventLog` import, test mock). Renamed `Activity Log` tab to `Learning Analytics` — `<SessionLogViewer showAllSessions={true} />` is now the single surface for every recorded action.
- **Phase 5 — real CSV export endpoint.** New `GET /api/export/learning-events` (admin → tenant-wide, non-admin → self). Filters: `from`, `to`, `user_id`, `case_id`, `session_id`, `verb`. Soft cap 50k rows; admin override `?confirm_large=1` raises to 200k; beyond that returns `413` with a hint. `Content-Disposition: attachment` and `Content-Type: text/csv`. RFC-4180-compliant CSV serializer (`csvEscape` helper). Joins `users`/`cases` for `username`/`case_name` so the CSV is self-contained. New "Learning Analytics (xAPI)" button added to the export grid in `ConfigPanel.jsx`; `downloadCSV()` updated to use `from`/`to` (instead of `start_date`/`end_date`) for this endpoint and to surface the structured `hint` from 413 responses.
- **Phase 6 — tests.** 12 new tests covering the trinity invariant, CSV completeness, RFC-4180 escaping (incl. embedded newline), tenant scoping, deprecation guard. Adjacent suites (`oyon-routes`, `retention-purge`, `analytics-tna`, `ConfigPanel.test.jsx`) all green at 70/70.

Codex round-3 (post-implementation diff review) returned `ship-with-fixes` with 5 findings; all folded in:
- **Access policy alignment** — `/api/export/learning-events` now uses `canReadAcrossUsers` (reviewer+) instead of admin-only, matching the existing `/api/learning-events/all` rule.
- **Try/finally around the batch insert** — `dbAdapter.prepare` + `Promise.all(runPromises)` + `stmt.finalize` are wrapped so a thrown promise can no longer leak the prepared statement nor leave the request hanging.
- **`sendBeacon` fallback** — when `navigator.sendBeacon` returns `false` (queue full or payload too large), `BackendSurface.js` now falls back to a `fetch` with `keepalive: true` so the last batch on logout/unload isn't dropped silently.
- **Tenant predicates on JOINs + spreadsheet-injection guard** — CSV export's `LEFT JOIN users` and `LEFT JOIN cases` now require matching `tenant_id`; `csvEscape` prefixes a single quote when a cell starts with `=`, `+`, `-`, `@`, `\t`, or `\r` (Excel/Calc/Numbers formula safety).
- **Wording correction** — `PLAN_LOGGING.md` now distinguishes the user's quoted goal phrasing from the honest concrete scope (~50 already-instrumented + ~25 listed verbs, not literally every keystroke).

Files touched:
- `server/routes/_helpers.js` — `resolveSessionTrinity` helper.
- `server/routes/analytics-routes.js` — single + batch endpoints rewritten; export endpoint added; `/events/batch` route deleted; `LEARNING_VERBS` extended.
- `server/routes/orders-routes.js` — `lab_value_edited` migrated to `learning_events`; redundant `event_log` dual-write dropped.
- `src/notifications/surfaces/BackendSurface.js` — payload trimmed; ENDED_SESSION immediate-flush; flush-on-unmount.
- `src/services/eventLogger.js` — `caseLoaded` re-stamps context; `EDITED_LAB_VALUE` verb added.
- `src/components/chat/ChatInterface.jsx` — redundant `/events/batch` POST removed.
- `src/components/settings/ConfigPanel.jsx` — events tab deleted; activity tab renamed; xAPI export button added; `downloadCSV` extended.
- `src/components/settings/ConfigPanel.test.jsx` — stale `EventLog` mock removed.
- `src/App.jsx` — logout click logged.
- `tests/server/learning-events-trinity.test.js` (new), `tests/server/learning-events-export.test.js` (new), `tests/server/event-log-deprecation.test.js` (new).
- `src/components/monitor/EventLog.jsx` — **deleted**.

Out of scope (deferred to follow-up): the remaining ~20 nice-to-have UI instrumentation points (scenarioStarted/Paused/Stepped, recordOpened/Edited, settingsOpened, etc.); dropping the `event_log` table itself; promoting `dbAdapter` to support `each` for true streaming exports.

Tests: `npx vitest run --no-coverage tests/server/learning-events-{trinity,export}.test.js tests/server/event-log-deprecation.test.js` → 12/12 passing. Adjacent regression: `oyon-routes`, `retention-purge`, `analytics-tna`, `ConfigPanel.test.jsx` → 70/70 passing.

### 2026-05-09 (evening) — Oyon: Learning Analytics surface + Codex audit fixes (round 2 + round 3)

Round 2 closed Codex's first 8 enterprise-review findings:
- Consent ownership: `POST /consent` and `POST /emotion-records` now require `String(session.user_id) === String(req.user.id)`. Educators/admins can no longer write into student sessions.
- Worker claim removed from `vite.config.js` and widget comments — inference is honestly main-thread until a worker path lands. `DEFAULT_RUNTIME.sample_interval_ms` reverted 333→500. Migration `0015` flips existing 333 rows.
- `OyonR/src/core/EmotionRuntime.js` gained `dispose()` (releases ONNX, MediaPipe, nulls refs). Widget calls it in `CaptureSession.stop()`. Overlay snapshot.
- `Dockerfile` copies `OyonR/` before `npm install` and into the runtime stage. `Caddyfile` adds `handle /oyon/*`, `handle /standalone/*`, `handle /api/addons/oyon*` so the `/rohy/` SPA base doesn't break root-absolute Oyon URLs.
- Migration `0016` partial unique index `(tenant_id, session_id, record_id) WHERE record_id IS NOT NULL`. Insert uses `ON CONFLICT … DO NOTHING`. Response shape `{ ok, inserted, skipped }`.
- Widget passes the full runtime config (`aggregate_window_ms`, `min_valid_frames`, `smoothing_alpha`, `min_hold_ms`, `switch_confidence`) to `EmotionRuntime`, not just model + interval.
- `consent_version` on every record is server-authoritative (uses the consent row's value, ignores client).

Round 3 closed Codex's follow-up 4 findings:
- `insertEmotionRecord` now derives a stable `record_id` from `sha1(tenant|session|window_start|window_end)` when the client omits one — replays from the runtime/widget actually dedupe (the partial unique index was previously dormant on null-id rows). 2 new tests cover the no-record_id replay path.
- `Caddyfile` rewritten honestly: it's internal-only, with manual-edit instructions for auto/off. The misleading multi-mode env claim removed from both Caddyfile and `compose.yml`.
- `OyonR/standalone/standalone-demo.js` adds `rohyFetch` helper that copies `rohy_csrf` cookie into `X-CSRF-Token` for non-GET requests (consent + emotion-records POSTs). Overlay updated.
- Standalone runtime teardown switched from `runtime.stop()` to `runtime.dispose()` + null in both replace and final-stop paths. Overlay updated.

### 2026-05-09 — Oyon: emotion-pill latency root-causes (Codex review pass)

- `src/components/oyon/OyonCaptureWidget.jsx`: live pill word now derived from `topLabel(p.probabilities)` per sample. Previous code read `p.dominant`, a field the runtime never emits — the displayed word only updated when a 10s `window` event arrived. Result: emotion label now updates at sample cadence (~3 Hz) like the rest of the live stats.
- `OyonR/src/inference/OnnxEmotionClassifier.js` + `scripts/oyon-overlay/src/inference/OnnxEmotionClassifier.js`: `configureOrt` now picks `min(4, navigator.hardwareConcurrency)` wasm threads when `crossOriginIsolated`, instead of forcing `numThreads = 1`. Without this, WebGPU-disabled hardware silently fell back to single-threaded wasm even after we enabled SharedArrayBuffer. Snapshotted into the overlay tree so `npm run oyon:update` keeps it.
- `server/security-headers.js`, `vite.config.js`: added `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` on every response. Required for SharedArrayBuffer (and therefore multi-threaded ONNX wasm). Vite dev server mirrored.
- `server/routes/oyon-routes.js` `ensureSettings()`: now INSERTs every runtime field from `DEFAULT_RUNTIME` instead of relying on the SQL column DEFAULTs from migration 0012. Prevents fresh tenants from regressing to the laggy 1Hz sampling default that 0013 only patched in existing rows.
- `migrations/0013_oyon_settings_default_interval.sql`: new — bumps existing rows from `sample_interval_ms = 1000` → `333` (only touches rows still on the old default).
- `server/routes/oyon-routes.js` `DEFAULT_RUNTIME`: `sample_interval_ms` lowered from 1000 → 333.
- Tests: build green; benchmark via Playwright + ORT direct shows per-inference 23–76ms (avg 36ms) on the HSE model with 4 wasm threads + WebGPU + cross-origin isolation.

### 2026-05-09 — Oyon: tenant-level capture-engine config + idempotent upstream sync

- `migrations/0012_oyon_settings_runtime.sql`: new — adds `model_profile`, `sample_interval_ms`, `window_ms`, `min_valid_frames`, `smoothing_alpha`, `min_hold_ms`, `min_switch_confidence` to `oyon_settings` with safe defaults.
- `server/routes/oyon-routes.js`: surfaces `runtime` block in `GET /config`; accepts + clamps the new fields in `PUT /settings`; structured logging on every route.
- `src/components/oyon/modelProfiles.js`: new — single source of truth for the model profile registry (HSE / MobileViT / MBF). Used by miniature + admin dropdown.
- `src/components/oyon/clientLogger.js`: new — tagged client-side logger (`[oyon]`) used across the integration.
- `src/components/oyon/OyonCaptureWidget.jsx`: waits for `/config.runtime` before preload; picks model + sample interval from tenant settings; consent POST gated on `localStorage['oyon.defaultConsent']`; structured `oyonClientLog` calls throughout.
- `src/components/settings/OyonSettingsTab.jsx`: new "Capture engine" admin subsection with Model dropdown + 6 numeric knobs (sample interval, window, min valid frames, smoothing α, min hold, switch confidence). Imports `CONSENT_PREF_KEY` from the widget for single-source-of-truth.
- `src/components/oyon/OyonAnalyticsView.jsx`, `oyonCaptureWorker.js`: deleted (dead code).
- `OyonR/standalone/standalone-demo.js`: `applyRohyTenantConfig()` now fetches `/api/addons/oyon/config` and overrides locally cached settings, locking the in-page model dropdown when `?source=rohy`.
- `scripts/apply-oyon-patches.mjs`: new — copies overlay files from `scripts/oyon-overlay/` into `OyonR/`. Idempotent; fails loud if upstream restructured destination dirs.
- `scripts/oyon-overlay/`: new tree — `standalone/index.html`, `standalone/standalone-demo.js`, `standalone/logs-dashboard.js`, `src/inference/MediaPipeFaceTracker.js`.
- `scripts/update-oyonr.sh`: rsync now excludes `/standalone/vendor` (so 64MB of MediaPipe/ONNX bundles survive the sync) and calls the overlay patcher post-rsync.
- Tests: build green; migration runner + cors + logger tests 43/43; migration 0012 applies cleanly to dev DB and adds defaults.
