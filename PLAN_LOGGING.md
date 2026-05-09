# Plan — Unified Learning-Analytics Logging (v2)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7, 1M)
**Reviewer:** Codex
**Status:** v2 — folded Codex round-1 findings (high×2, medium×1)

## 1. Problem statement

The user reports three symptoms:

1. No student actions appear in the logs.
2. The "Event Log" tab in ConfigPanel is empty.
3. Several "Export Data (CSV)" buttons exist but the user can't see / can't get useful data from them.

User goal (quoted): *"all student actions, interactions, chats, and events related to the case are recorded using a unified session, user, case ids — like learning analytics."*

**Honest scope of this plan:** the ~50 already-instrumented xAPI verbs (App, ChatInterface, PatientMonitor, InvestigationPanel, TreatmentPanel, AuscultationPanel) plus ~25 listed below in Phase 3. "Every meaningful clinical decision and UI interaction we identified" — not literally every keystroke or hover. The trinity is unified across all of them.

## 2. Diagnosis (verified against source)

Two independent event-logging systems coexist:

### System A — `event_log` (legacy, near-empty)
- Table: `migrations/0001_initial.sql:123`.
- Write endpoint `POST /api/events/batch` (`server/routes/analytics-routes.js:614`).
- Read endpoint `GET /api/sessions/:id/events` (`server/routes/analytics-routes.js:673`).
- Writers in repo:
  - `src/components/chat/ChatInterface.jsx:749` — `emotion_selected` only.
  - `server/routes/orders-routes.js:1170` — `investigation_ordered` (also dual-writes to `learning_events` at line 1175).
  - `server/routes/orders-routes.js:1383` — **`lab_value_edited` (event_log only — no `learning_events` sibling)**.
- UI reader: `src/components/monitor/EventLog.jsx:17`, mounted at `src/components/settings/ConfigPanel.jsx:2338` under the `events` tab.

### System B — `learning_events` (modern xAPI, populated)
- Table: `migrations/0001_initial.sql`. Trinity columns `session_id`, `user_id`, `case_id` plus `verb`, `object_type`, `object_id`, `object_name`, `component`, `parent_component`, `result`, `duration_ms`, `context` (JSON), `message_content`, `message_role`, `severity`, `category`, `tenant_id`. Retention 90 days (`migrations/0005_retention.sql`).
- Write endpoint `POST /api/learning-events/batch` (`server/routes/analytics-routes.js:816`).
- Read endpoints `analytics-routes.js:1005, 1149, 1177, 1235`.
- Writers: ~50 call sites through `EventLogger` → `NotificationCenter` (TELEMETRY) → `BackendSurface` (`src/notifications/surfaces/BackendSurface.js:265`).
- UI reader: `src/components/analytics/SessionLogViewer.jsx`, mounted at `ConfigPanel.jsx:2186` under the `activity` tab.

### Root cause
The user looks at the `events` tab (System A — almost empty); their actions are recorded in System B (shown on the `activity` tab). The legacy system was never retired.

### Existing CSV exports
`ConfigPanel.jsx:2438-2477` has 5 buttons hitting `/api/export/{login,chat,settings,session-settings,questionnaire}-logs`. Three are admin-only and silently 403 for non-admin users (`apiFetch` throws → toast says "Export failed" with no reason). **No CSV export of `learning_events` exists today.**

## 3. Codex round-1 findings — folded into this plan

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | high | Trinity is client-stamped; batch endpoint persists `event.case_id` after only checking session ownership. Stale tab / replay can write a wrong `case_id` against a valid `session_id`. | **Phase 1 rewritten** — server derives `user_id` and `case_id` from `session_id`, ignoring client values. |
| 2 | high | Planned export pointed at `/learning-events/all`, which returns paginated JSON `{events, sessions}` capped at 500 rows. `parseAs:'blob'` would have downloaded a partial JSON blob labeled `.csv`. | **Phase 5 rewritten** — new dedicated `/api/export/learning-events` CSV endpoint with no row cap and explicit `Content-Disposition`. |
| 3 | medium | Plan left legacy `event_log` writers in place while removing the only UI reader. `orders-routes.js:1383` writes `lab_value_edited` to `event_log` only. | **New Phase 2** — migrate legacy writers to `learning_events`; add a regression guard preventing new `event_log`-only inserts. |

## 4. Solution — six phases

Schema is already correct (trinity is on every row of `learning_events`). No migration needed.

### Phase 1 — Server-enforced trinity invariant

**Goal:** make the trinity a *server-derived* invariant. Client values for `user_id` and `case_id` are ignored on write.

Changes to `server/routes/analytics-routes.js:816` (`POST /learning-events/batch`) and the single-event POST at `:747`:

- For each event with `session_id != null`:
  - Look up `(user_id, case_id)` from `sessions WHERE id=? AND tenant_id=?` — already done for ownership at line 830, just extend the SELECT.
  - If session not found in tenant → **drop event** (already 403 path for non-educator), or for educator/admin batches, drop with a `skipped` counter.
  - Persist server-derived `user_id` and `case_id`. Ignore `event.case_id` from request body entirely.
  - For educators/admins logging on behalf: keep ownership bypass for read paths only (per `HANDOFF.md` access policy); for write paths, derive `user_id` from the session record, not `req.user.id`.
- For each event with `session_id == null` (pre-session telemetry):
  - `user_id := req.user.id` (from JWT).
  - `case_id := NULL` (forced).

Cache the lookup per batch (one query per distinct `session_id`, not per row).

Single-event endpoint at `:747` gets the same treatment.

**Client-side change:** strip `case_id` from the BackendSurface payload (`src/notifications/surfaces/BackendSurface.js:240`). Keep `session_id`. Document in code comment that the server is now authoritative for trinity.

**Bug fixed in passing:** `src/services/eventLogger.js:319 caseLoaded()` does not currently call `setContext({ caseId })`, so a mid-session case switch leaves stale `caseId` in the singleton. Fix the client side too — but the server invariant is the load-bearing change.

**Response contract (tightened per Codex round-2):**
```json
{
  "inserted": <int>,
  "dropped": <int>,
  "dropped_reasons": {
    "session_not_found": <int>,
    "cross_tenant": <int>,
    "missing_required_field": <int>
  },
  "total": <int>
}
```
Per-row indices are deliberately omitted (aggregate counts with reasons is enough for client diagnosis). The client logs a console warning when `dropped > 0` so misconfigured tabs are not silent.

**Tests (Phase 6):**
- POST a batch with `{ session_id: X, case_id: WRONG }`; GET back; assert stored `case_id` matches the case bound to session X, not `WRONG`.
- POST a batch where one event references a session in a different tenant → assert it is counted in `dropped_reasons.cross_tenant` and not stored.
- POST a batch with `session_id: null` and a client-supplied `case_id` → stored `case_id` is NULL.
- Mixed batch (3 valid + 2 cross-tenant) → response is `{inserted:3, dropped:2, dropped_reasons:{cross_tenant:2}, total:5}`.

### Phase 2 — Migrate `event_log`-only writers

**Goal:** every legacy `event_log` write either gets a `learning_events` sibling or is replaced outright.

Targeted writes:

1. `server/routes/orders-routes.js:1383` — `lab_value_edited`. **Replace** the `event_log` INSERT with a `learning_events` INSERT:
   - `verb = 'EDITED_LAB_VALUE'` (add to `VERBS` constant in `src/services/eventLogger.js`)
   - `object_type = 'lab'`, `object_id = String(labId)`, `object_name = (lookup test_name)`
   - `context = { current_value, instructor_id: req.user.id }`
   - `severity = 'info'`, `category = 'instructor'`
   - Server derives `user_id` and `case_id` from `sessionId` via the sessions table (Phase 1 helper).
2. `server/routes/orders-routes.js:1170` — `investigation_ordered`. Already dual-writes. **Drop** the `event_log` INSERT; keep the `learning_events` INSERT (already at line 1175).
3. `src/components/chat/ChatInterface.jsx:749` — `emotion_selected` POST to `/events/batch`. Already covered by `EventLogger.emotionExpressed()` at line 738. **Delete** the redundant `apiPost('/events/batch', …)`.

**Regression guard (refined per Codex round-2):** add a vitest at `tests/server/event-log-deprecation.test.js` that greps for `INSERT INTO event_log` and fails on any new occurrence outside the allowlist. Allowlist:
- `migrations/**` — schema CREATE TABLE is fine.
- `tests/**` — fixture seeds may legitimately insert.
- `server/routes/_helpers.js` — purge code legitimately references the table for the user-purge plan (read/UPDATE only, no INSERT — the test guards `INSERT INTO event_log` specifically).

The test also enumerates *all* `event_log` references (read, write, JOIN) once and writes them to a snapshot file (`tests/server/__snapshots__/event-log-references.txt`) so a future PR adding a new read path is visible in code review even if the test doesn't fail.

**Out of scope (deliberate):** dropping the `event_log` table itself. `_helpers.js:53,340` still references it for the user-purge plan; removing the table is a separate migration with its own review. Keep the table; just stop writing to it.

### Phase 3 — Instrument missing UI interactions

Add `EventLogger.X(...)` calls at the listed sites. Use existing constants in `eventLogger.js` (`VERBS`, `OBJECT_TYPES`, `COMPONENTS`); add new constants only when needed.

| Component | New verbs |
|---|---|
| `ChatInterface.jsx` | messageRegenerated, voiceToggled, ttsPlayed, suggestionClicked |
| `PatientMonitor.jsx` | scenarioStarted, scenarioPaused, scenarioStepped, ecgModeChanged, monitorTabOpened, snapshotTaken |
| `InvestigationPanel.jsx` | labCancelled, labResultAcknowledged |
| `TreatmentPanel.jsx` | treatmentCancelled, doseAdjusted, treatmentDiscontinued |
| `AuscultationPanel.jsx`, `App.jsx` | examFindingNoted, bodyMapClicked |
| Patient record / notes | recordOpened, recordEdited, noteAdded, noteEdited, noteDeleted |
| Auth + settings | loggedIn, loggedOut, settingsOpened, configChanged, profileUpdated |

**Concurrency fix:** `eventLogger.js:319 caseLoaded()` must call `this.setContext({ caseId })`. Without this, mid-session case switches leave the singleton `caseId` stale on the *client*; with the Phase 1 server fix, the row will still be correct (server overrides), but the client-side stale state can confuse other components reading `EventLogger.getStatus()`.

**Flush-before-clear ordering on logout:** verify `BackendSurface` flushes synchronously (or via `sendBeacon`, line 261) before `App.jsx` calls `clearContext`. If not, last-batch loss on logout is a silent data gap. Add a unit test that asserts flush order.

### Phase 4 — Single canonical viewer

- Delete `src/components/monitor/EventLog.jsx`.
- Delete the `events` tab branch in `ConfigPanel.jsx` (lines ~2300-2350) plus its session selector and the `EventLog` import on line 7.
- Rename the existing `activity` tab to **"Learning Analytics"** (`ConfigPanel.jsx:2186` and corresponding sidebar/tab labels).
- Audit `src/components/analytics/SessionLogViewer.jsx`:
  - Default visible columns: timestamp, user, case, session, verb, object_type, object_name, component.
  - Filters: by user, case, verb, component, date range.

### Phase 5 — Real CSV export endpoint

**New backend route:** `GET /api/export/learning-events` in `server/routes/analytics-routes.js`.

Contract:
- Auth: `authenticateToken`.
- Tenant scoping: `WHERE tenant_id = ?` (always — including admin).
- Self vs admin: non-admin users get `WHERE user_id = req.user.id` appended; admins get tenant-wide.
- Query params: `from`, `to` (ISO date), `user_id`, `case_id`, `session_id`, `verb`. All optional.
- **Row-cap policy (per Codex round-2 — DoS / browser-memory risk):**
  - Default soft cap: **50,000 rows**. If unfiltered query would exceed, return `413 Payload Too Large` with a body of `{ error, count, hint: "Use ?from / ?to / ?user_id / ?case_id to narrow the export" }`.
  - Hard ceiling: **200,000 rows** (admin-only override via `?confirm_large=1`). Beyond that, refuse — researchers should script directly against SQLite.
  - **Rationale:** browser `Blob` from `apiFetch({parseAs:'blob'})` materializes the whole CSV in client memory; >50k rows risks OOM on mid-tier laptops. Date-range filter is the expected ergonomic.
- **Streaming + DB safety:**
  - `db.each` cursor; write CSV rows in chunks of 1000 to `res`.
  - Server-side query timeout: 30s (`PRAGMA busy_timeout`).
  - Every filter column has an existing index (`session_id`, `user_id`, `timestamp`); add `idx_learning_events_case_id` if EXPLAIN QUERY PLAN shows a scan when `?case_id=...` is the only filter.
- Headers:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="learning-events_${YYYY-MM-DD}.csv"`
- Columns (header row, in this order):
  ```
  timestamp, user_id, username, case_id, case_name, session_id,
  verb, object_type, object_id, object_name,
  component, parent_component, result, duration_ms,
  message_role, message_content, severity, category, context_json
  ```
  `username` and `case_name` LEFT JOINed from `users` and `cases` to keep the CSV self-contained.
- CSV escaping: RFC 4180 — wrap any field containing `,`, `"`, or newline in double quotes; escape inner `"` as `""`. Use a tested helper, not ad-hoc string concat.

**UI button:** add a 6th button to `ConfigPanel.jsx:2438` labeled **"Learning Analytics (xAPI)"**, calling the new endpoint with `parseAs: 'blob'` (the endpoint actually returns a blob now, unlike the round-1 plan).

**Visibility fix:** hide the 3 admin-only buttons (`Login`, `Settings`, `Questionnaire`) when `!isAdmin` instead of letting them silently 403 with a generic toast.

**Completeness test:** in `tests/server/`, seed N=1500 events, hit the export, parse the response, assert `parsed_rows == seeded_rows` (catches any future hidden cap).

### Phase 6 — Tests + verification

1. **`tests/services/eventLogger.test.js`** — trinity stamping after `setContext` / `caseLoaded` / `sessionEnded`; verifies the `caseLoaded` mid-session bug fix.
2. **`tests/server/learning-events-trinity.test.js`** — Phase 1 server enforcement: mismatched `case_id` → server-derived value wins. Cross-tenant session_id → event dropped.
3. **`tests/server/event-log-deprecation.test.js`** — grep guard from Phase 2.
4. **`tests/server/learning-events-export.test.js`** — Phase 5 completeness, CSV escaping, tenant scoping, self-vs-admin, Content-Type/Disposition headers.
5. **Playwright smoke** (`tests/e2e/learning-analytics.spec.js`) — login → start case → send chat → adjust vital → order lab → open Learning Analytics tab → assert ≥4 rows with consistent trinity. Export CSV; assert every row has trinity populated and `case_id` matches the loaded case.
6. **CHANGES.md, HANDOFF.md, LEARNINGS.md** updated.
7. **Codex pass** on the resulting diff (per `feedback_codex_review.md`).

## 5. Schema — no migration needed

`learning_events` already has every required column. Indexes on `session_id`, `user_id`, `timestamp` exist. Tenant column added in `migrations/0004_tenants.sql`.

## 6. Risks the reviewer should focus on

Mapped to failure modes in `feedback_codex_review.md`:

- **Wrong field on hot path.** Phase 1 changes write semantics for the highest-volume endpoint in the system. If the server-derived `user_id` is computed from the wrong row (e.g. session record's owner vs the JWT principal for educators), every event lands mis-attributed. Reviewer: confirm the SELECT pulls `user_id` from `sessions` and not `users`, and confirm educator/admin write semantics match read semantics.
- **Access policy drift.** Phase 5's new export endpoint duplicates auth logic that already exists on `/learning-events/all`. Reviewer: confirm the new endpoint matches or tightens (never loosens) the read-side rule. Tenant scoping is `WHERE tenant_id = ?` everywhere — verify the query is parameterized and tenant comes from `tenantId(req)`, not `req.body`.
- **Promise vs populate gap.** Phase 1 drops events that reference sessions outside the tenant. Reviewer: confirm the response distinguishes `inserted` vs `dropped` so the client can detect a misconfigured tab. Phase 3 flush-before-clear: if `BackendSurface` flushes asynchronously, last batch is lost on logout — verify the `sendBeacon` path is wired to logout, not just `pagehide`.
- **PII / retention coverage.** `message_content` carries verbatim chat text. Retention 90 days; user-purge clears `learning_events` per `_helpers.js`. Reviewer: confirm the new export endpoint respects user-purge (no rows from purged users), and confirm the CSV doesn't leak fields from other tenants.
- **Wording over-claim.** Plan says "all student actions". Reality: ~50 already-instrumented + ~25 new verbs. Reviewer: flag any phrasing in CHANGES.md / HANDOFF.md that overpromises coverage. Honest claim: "every meaningful clinical decision and UI interaction we identified."

## 7. Open questions for reviewer

1. **`caseLoaded` mid-session.** When a session changes case (UI path: `App.jsx:406 EventLogger.caseLoaded(...)`), should the server emit a synthetic `CONTEXT_SWITCHED` event so the case-change is auditable, or is the implicit change in `case_id` on subsequent rows enough? Default: emit a synthetic event for clarity.
2. **Pre-session events.** Phase 1 forces `case_id := NULL` for events without `session_id`. Should the export endpoint include them by default, or filter them out unless `?include_pre_session=true`? Default: filter out (researchers want session-bound rows).
3. **Educator-on-behalf writes.** Read paths allow educator/admin to view any session in their tenant. Should the *write* path also let them log on behalf of students (e.g. instructor-led demos)? Today's batch endpoint at `:827` allows this. Phase 1 keeps the bypass — flag if reviewer wants it tightened.

## 8. Estimated effort

- Phase 1: 2h (server-derive helper + endpoint changes + cache + payload strip)
- Phase 2: 1h (3 writers + grep guard test)
- Phase 3: 2-3h (~25 instrumentation points + caseLoaded fix + flush-order test)
- Phase 4: 1h (delete + rename + viewer audit)
- Phase 5: 2h (export route + CSV serializer + UI button + completeness test)
- Phase 6: 2h (remaining unit + server + Playwright + docs)
- Codex review + fixes: 1h

Total: ~11-12h focused work. Phases 1 + 2 are sequenced (Phase 2 uses Phase 1's server-derive helper); Phase 3 is independent; Phase 4 depends on nothing; Phase 5 depends on Phase 1's helper; Phase 6 last.
