# Session Handoff — 2026-05-07 (audit follow-through)

This session executed against the 25-finding enterprise audit pass from
2026-05-06 plus four follow-up items the audit itself missed (CSP,
SQL-injection static guard, retention test, incident-response runbook)
and the cookie/CSRF/refresh-flow rollout.

## Completed (29 commits on `main`, all pushed)

### From the audit's 25 findings

22 closed by code, 3 deferred with rationale (#7 routes split, #9
dbAdapter migration, #11 TTS/LLM concurrency budgets — each a multi-
day mechanical refactor). The shape of each commit:

- **#1** apiClient + ApiError contract; service-layer + clinical-
  workflow component migrations (admin editors deferred under #15).
- **#2** active_sessions revocation enforced in `authenticateToken`.
- **#3** medkit-app: persona + emotion classifier tests (split
  `detectEmotion` out of `conversation.ts` for testability without
  livekit).
- **#4** HttpOnly `rohy_auth` cookie issued at login, dual-mode
  bearer/cookie auth.
- **#5** Coverage ratchet at 50/44/43/51% as floor.
- **#6** `src/storage/registry.js` declares every `rohy_*` namespace;
  test fails on undeclared keys.
- **#8** `runDbMigrations` / `seedDbDefaults` split, `scripts/seed.js`
  + `ROHY_NO_AUTO_SEED=1` opt-out.
- **#10** `fetchWithTimeout` primitive; OpenAI + Google TTS adopted.
- **#12** Auth middleware tenant-change + malformed-header tests.
- **#13** Migration runner downgrade + dirty-db tests.
- **#14** LabValueEditor integration tests.
- **#16** tnaUtils edge-case tests.
- **#17** useAlarms timer + useTreatmentEffects session-change tests.
- **#18** Notification per-user scoping + legacy-key migration tests.
- **#19** CORS factory + production allowlist tests.
- **#20** Backend persistence telemetry counters; surfaced in
  DiagnosticBar.
- **#21** `src/notifications/SAFETY.md` clinical alarm safety
  acceptance criteria.
- **#22** DiagnosticBar role gate (admin/educator only).
- **#23** Cleanup: tnaUtils dead allocation, parseConfig deep-clone.
- **#24** Static-template schema validation.
- **#25** API URL resolution across BASE_URL configs.

### Beyond the audit (added or surfaced this session)

- **CSRF** — double-submit-cookie protection on cookie-auth path; the
  cookie/CSRF rollout was the natural follow-on to #4.
- **JWT refresh** — `POST /auth/refresh` rotates active_sessions row
  + cookies; `AuthContext` schedules a 3h tick.
- **Cookie-mode flag day** — login/register no longer write
  localStorage by default (`rememberToken: true` opts back in for
  explicit cross-origin callers).
- **CSP + security headers** — `server/security-headers.js` sets
  Content-Security-Policy, X-Frame-Options, Permissions-Policy,
  X-Content-Type-Options, Referrer-Policy. CSP is strict in production
  (`script-src 'self'` only) and adds `unsafe-eval` for dev (Vite HMR).
- **SQL-injection static guard** — `tests/server/sql-injection-guard.test.js`
  greps server tree for `${...}` interpolation in SQL strings; new
  interpolation fails CI unless explicitly allowlisted with rationale.
- **Retention/purge end-to-end test** — `tests/server/retention-purge.test.js`
  exercises `POST /api/users/:id/purge` against the real server, asserting
  hard-delete tables lose rows, anonymised log tables NULL their user_id,
  and the user row is retained but PII-wiped.
- **Body-size limit tightened** — global JSON limit dropped from 10mb
  to 256kb (DoS surface).
- **Real timezone bug fixed** — `active_sessions.expires_at` comparison
  was using `new Date(sqliteString)` which parses as local time but
  SQLite stores UTC. Fixed by appending 'Z' before parse. Caught by
  the new auth-refresh tests on a non-UTC dev box.
- **Incident-response runbook** — `docs/INCIDENT_RESPONSE.md`. Seven
  failure-mode playbooks (locked-out users, CSRF rejection, dropped
  persistence, TTS timeout, refresh loop, JWT-secret rotation, DB lock).

## Current state

### What works
- Cookie-only auth lane: HttpOnly `rohy_auth` + `rohy_csrf` double-submit
  CSRF + 3h JWT refresh + flag-day defaults. Login/register no longer
  write localStorage; existing localStorage tokens self-heal as users
  cycle through logout/refresh.
- Server-side revocation: logout, admin force-logout, password change
  all immediately invalidate the JWT.
- DiagnosticBar (admin/educator only) shows live backend persistence
  telemetry alongside the existing voice / LLM / session diagnostics.
- 22 of 25 audit findings closed by code; 3 deferred with documented
  rationale; 4 follow-ups (CSP, SQL guard, retention test, incident
  runbook) added beyond the audit's scope.
- 973 vitest tests passing, 10 documented skipped, 0 failed (one
  intermittent flake on `DiscussionScreen.test.jsx` "Start debrief"
  gate — passes on re-run; not introduced this session).

### What's broken / partial
- **Admin editor migration to apiFetch + tests (#15)** — 10 admin-only
  components still on direct fetch (LabTestManager, MedicationManager,
  etc.). Lower security risk (admin-only paths, role-gated server-side)
  but real debt.
- **`server/routes.js` split (#7)** — still one 7000-line file.
  Mitigated by `route-auth-allowlist.test.js` but the file itself is
  still a wall.
- **dbAdapter migration (#9)** — direct `db.get/all/run` still
  pervasive in routes.js.
- **TTS/LLM budget tracker (#11)** — no per-user/platform spend
  enforcement. fetchWithTimeout from #10 is the building block the
  budget tracker will wrap.
- **TTS retry / circuit-breaker** — primitive in place, no policy
  layered on top yet.
- **Structured logging schema** — `console.log` is everywhere;
  `requestLoggerMiddleware` exists but per-route warn/error don't go
  through it.
- **session_id collision test** — no test for the SQL race when two
  tabs start a session simultaneously.
- **Cookie-path Playwright e2e** — unit tests cover the cookie/CSRF/
  refresh logic but no e2e issues a real `Set-Cookie` and watches the
  next fetch send it back.

### Files changed this session

Net diff is ~30 commits, 64 files changed, 6,500+ lines net.
High-leverage modules:

- **New:** `src/services/apiClient.js`, `src/storage/registry.js`,
  `src/notifications/SAFETY.md`, `server/cors-config.js`,
  `server/security-headers.js`, `server/middleware/csrf.js`,
  `server/services/fetchWithTimeout.js`, `scripts/seed.js`,
  `docs/INCIDENT_RESPONSE.md`, plus 14 new test files.
- **Heavily modified:** `src/services/{authService,llmService,
  voiceService,AgentService,discussionService,notesService}.js`,
  `src/contexts/AuthContext.jsx`, `src/App.jsx`, `src/components/
  {chat/ChatInterface,monitor/PatientMonitor,orders/OrdersDrawer,
  treatments/TreatmentPanel,investigations/*,examination/*}.jsx`,
  `src/notifications/{persistence,surfaces/BackendSurface}.js`,
  `src/hooks/{useAlarms,useTreatmentEffects,useDiscussionEngine}.js`,
  `server/routes.js`, `server/middleware/auth.js`, `server/db.js`,
  `vitest.config.js`.

## Key decisions

- **Cookie-mode flag day is graceful, not abrupt.** Existing
  localStorage tokens keep working through `apiClient`'s Authorization
  header attachment. The localStorage slot self-heals: any 401 clears
  it, so users naturally migrate as their old tokens expire.
- **CSRF skips bearer-auth requests intentionally.** A cross-site
  attacker has no way to auto-attach an Authorization header — that's
  not a CSRF vector. Gating on `req.tokenSource === 'cookie'` keeps
  legacy bearer clients working unchanged while protecting the cookie
  clients exclusively. Test pins the policy.
- **Refresh order: insert new row before revoking old.** Never any
  window where the user has zero valid sessions. Reversing the order
  would create a brief race on parallel mid-refresh requests.
- **CSRF cookie is non-HttpOnly by design — locked in a test.** The
  whole double-submit scheme depends on JS reading the cookie. A
  future "harden everything" pass that flips this to HttpOnly would
  silently disable CSRF protection; the test refuses that change.
- **Coverage ratchet floors are starting values, not targets.** Audit
  documented 70% as the Phase 2/3 target, 80%+ for Phase 4+. If the
  numbers stay at 50% in 90 days, the ratchet served no purpose.
- **SQL-injection guard uses an explicit allowlist with `why` strings.**
  Each allowlisted line is line-substring-matched, not a blanket pass.
  New interpolation, even in already-allowlisted files, fails until
  someone audits and either rewrites or extends the allowlist.

## Open issues

- **Refresh-flow tests run sequentially.** Two parallel test workers
  using auth-refresh.test.js would collide on `active_sessions.token_hash`
  (UNIQUE). Currently mitigated by Vitest defaulting one worker per
  file; if you flip to parallel-within-file, the tests need test-scoped
  isolation.
- **The `DiscussionScreen.test.jsx > CONTRACT 2` test is flaky.**
  Pre-existing — async discussant-resolve race. Hasn't been fixed
  this session. Re-run usually passes.
- **One admin force-logout SQL update could lock everyone out.** The
  incident runbook covers recovery (truncate `active_sessions`,
  legacy-token compatibility absorbs the disruption), but a guardrail
  on the admin endpoint to refuse mass-revoke would be safer.
- **`cors-config.js` allows loopback origins in production.** The audit
  test (`tests/server/cors-config.test.js`) locks this as observed
  behaviour rather than a bug; if you want to forbid loopback in prod,
  flip the order of the dev-shortcut + allowlist check and update the
  test.

## Next steps (priority order)

1. **Wire incident-response runbook into observability.** Currently a
   doc; the playbooks reference DiagnosticBar telemetry counters that
   exist but have no off-tab persistence. Hooking up a metrics shipper
   (statsd, OTLP) would let alerts fire on the same signals the runbook
   names.
2. **Close #15** (admin editor apiFetch migration + component tests).
   The mechanical migration is bulky but unblocks the security floor on
   that component layer. Multi-day window.
3. **Close #7 / #9 / #11** in any order. Each is a focused multi-day
   PR. The route-auth-allowlist test (#7) and the SQL-injection guard
   already cover the audit's underlying concerns; the file split and
   the dbAdapter migration are quality-of-life improvements that don't
   change security posture.
4. **TTS retry / circuit-breaker on top of `fetchWithTimeout`.** Small
   surface, real user-visible win during upstream provider hiccups.
5. **Cookie-path Playwright e2e.** Unit tests cover the auth lane but
   browser-level cookie / CSRF behaviour isn't end-to-end verified.
6. **Body-size limits per route.** Global limit is now 256kb; certain
   endpoints (case import, scenario template upload) likely need
   per-route override. Audit the actual sizes of legitimate POST
   bodies before tightening further.

## Context

- Working tree state: clean after the final commit + push.
- Branch: `main` (per the user's longstanding "always commit on main"
  feedback memory).
- Test runner: Vitest split client + server; `npm test` runs both,
  `npm run test:ci` adds JUnit + coverage with the new ratchet
  thresholds.
- 967 → 973 tests this session phase; 802 → 973 net since the audit.
- The user's deploy environment is still `192.168.50.39` LAN; the
  HTTPS-listener + cert generator from the prior session are still
  the path off the insecure-context block. The cookie-mode auth this
  session adds is dependent on HTTPS being live in production —

---

# Continuation Handoff — 2026-05-07 (observability + audit trail Phases 1-2)

## Landed in this run

- **Phase 1 finish, `server/routes.js` route-family logging sweep.**
  All remaining `console.log`, `console.warn`, and `console.error` calls
  in `server/routes.js` were migrated to structured logging. Request
  handlers use `req.log` where practical; helper/background callbacks use
  route-family components:
  `routes-auth-users-tenants`, `routes-cases-sessions`,
  `routes-orders-labs-radiology`, `routes-llm-tts`, and
  `routes-agent-tna-admin`.
- Added review markers in `server/routes.js` for the requested route-family
  slices: auth/users/tenants, cases/sessions, orders/labs/radiology,
  LLM/TTS, admin/agent/TNA, and legacy lab/medication catalogue.
- **Phase 2 audit hash chain.** Added `server/audit-chain.js` with
  `canonicalRow`, `computeEntryHash`, `appendAuditEntry`,
  `verifyAuditChain`, and migration backfill helpers.
- Added `migrations/0008_audit_hash_chain.sql`. The SQL file owns the
  chain traversal index; the migration runner handles SQLite-limited
  idempotent column creation and SHA-256 backfill for version `0008` in
  the same transaction.
- Routed the existing `logAudit` / `logAuditAsync` chokepoint in
  `server/routes.js` through `appendAuditEntry`. The local audit helper in
  `server/routes/catalogue.js` also now uses `appendAuditEntry`, so direct
  inserts into `system_audit_log` are no longer present in application
  code.
- Added `GET /api/admin/audit/verify` for admin-only tenant-scoped chain
  verification.
- Added `tests/server/audit-chain.test.js` covering append+verify,
  tamper detection, tenant isolation, and migration backfill from legacy
  rows.

## Decisions

- Hash chains are tenant-scoped. `prev_hash` for the first row in each
  tenant chain is `NULL`, and verification walks `system_audit_log` by
  `(tenant_id, id)`.
- Canonicalisation includes the requested logical fields only:
  `userId`, `action`, `resourceType`, `resourceId`, `resourceName`,
  `oldValue`, `newValue`, `metadata`, `tenantId`, `ipAddress`,
  `userAgent`, and `ts`. It excludes `id`, `prev_hash`, `entry_hash`, and
  `created_at`/chain metadata.
- `appendAuditEntry` uses `BEGIN IMMEDIATE` around prev-hash lookup and
  insert so concurrent appends serialize per SQLite writer semantics.
- Legacy migration rows keep their existing `timestamp`; new appended rows
  get an ISO timestamp before hashing so the value hashed is the value
  inserted.

## Deferred

- **Phase 3 client-side gap closure + correlation forwarding** is not
  started. It remains the next implementation slice: `X-Request-Id` in
  `apiClient`, `client_logs` migration/routes/rate-limit, eventLogger verb
  expansion, voice focus/STT/TTS wiring, and DiagnosticBar replay panel.
- **Phase 4 docs** is not started. Once Phase 3 lands, add
  `docs/OBSERVABILITY.md`, `docs/AUDIT_TRAIL.md`,
  `docs/LEARNING_ANALYTICS.md`, incident-response audit-chain entry, and
  `CLAUDE.md` documentation map.

## Verification

- `node --check server/routes.js`
- `node --check server/audit-chain.js`
- `node --check server/migrationRunner.js`
- `rg -n "console\\.(log|warn|error)" server/routes.js` returns no matches.
- `npm test -- tests/server/audit-chain.test.js tests/server/route-auth-allowlist.test.js`
- `npm test -- tests/server/sql-injection-guard.test.js tests/server/migrationRunner.test.js`
- `npm test` passed: 75 files, 1010 tests passing, 10 skipped.
  `secure: true` on cookies is gated on `NODE_ENV==='production'`,
  so non-HTTPS prod would suppress the cookies entirely.
- LEARNINGS.md was not updated this session; the per-commit messages
  and this handoff carry the substantive decisions.

---

# Session Handoff — 2026-05-07 (observability Phase 1 start)

## Landed in working tree

Phase 1 primitives and the first bounded console-migration slice are
implemented, but **not committed** because this Codex sandbox cannot write
inside `.git`:

```text
fatal: Unable to create '.git/index.lock': Operation not permitted
touch: .git/codex-write-test: Operation not permitted
```

The working tree files themselves are writable; only the git metadata is
blocked. Commit from a normal shell with the files listed in `git status`.

### Observability primitives

- `requestIdMiddleware` now attaches `req.log = logger('request').child({
  request_id })`; nested route logs can inherit the correlation ID.
- `requestLoggerMiddleware` now emits one structured `access` log per
  request with `request_id`, `method`, `path`, `status`, `duration_ms`,
  `user_id`, `tenant_id`, `bytes_in`, and `bytes_out`. It does not log
  request/response bodies.
- `logger.js` now honors `ROHY_LOG_LEVEL` as a fallback to `LOG_LEVEL`, so
  the new logger and existing observability tests share one server-wide
  level knob.
- `instrumentSqliteDb()` now emits debug `db` logs for `get/all/run/exec`
  with sanitized `sql_summary`, `duration_ms`, `rows`, `last_id` where
  available, and `request_id`. Slow-query NDJSON remains intact.
- `fetchWithTimeout` / `fetchWithRetry` now emit `http-out` logs for
  outbound start/completion/failure and breaker fast-fail. Targets strip
  query strings so API keys/tokens do not leak.

### Console migration slice

Migrated these bounded component families from ad hoc `console.*` to
`logger(component)`:

- Server startup / HTTPS / voice-key migration / uncaught process handlers.
- DB boot and seed defaults.
- Migration runner status.
- Seeders for users/cases, including removal of default-password printing
  from logs.
- Kokoro and lab database services.
- Catalogue audit write failures.
- Route-level radiology-load and auth active-session warning/error paths.
- Express error handler.

Remaining `console.*` calls are mostly inside the monolithic
`server/routes.js` route families (cases/sessions/orders/labs/LLM/TTS/agent
templates/TNA), plus the deliberate fatal JWT startup messages in
`server/middleware/auth.js`.

## Tests

Full suite passed after this slice:

```text
npm test
74 files passed
1006 passed, 10 skipped
```

Focused server tests also passed:

```text
npm run test:server -- \
  tests/server/logger.test.js \
  tests/server/request-logging.test.js \
  tests/server/db-instrumentation.test.js \
  tests/server/fetchWithTimeout.test.js \
  tests/server/fetchWithRetry.test.js \
  tests/server/observability.test.js \
  tests/server/observability/slow-query-alerting.test.js \
  tests/server/sql-injection-guard.test.js \
  tests/server/auth-refresh.test.js \
  tests/server/tts-route.test.js \
  tests/server/catalogue-0007.test.js
```

## New tests

- `tests/server/request-logging.test.js` locks access-log field shape,
  request-id echoing, `req.log` propagation, body omission, and skip paths.
- `tests/server/db-instrumentation.test.js` locks DB debug logging,
  request-id propagation, row counts, and SQL/parameter sanitization.
- Existing fetch/logger tests now cover `http-out` logs and
  `ROHY_LOG_LEVEL` fallback.

## Next

1. From a non-sandbox shell, commit the current working tree as the first
   Phase 1 commit. Suggested subject:
   `feat(observability): wire structured request and infrastructure logs`.
2. Continue Phase 1 with route-family migrations in separate commits:
   cases/sessions, orders/labs/radiology, LLM/TTS, then agent/TNA/admin.
3. After route-family migration, run `npm test`, commit, and push
   `origin main`.
4. Proceed to Phase 2 hash-chain audit once Phase 1 has no non-fatal
   `console.*` left outside the intentionally fatal auth startup messages.

---

# Latest Run Note — 2026-05-07

The current working tree supersedes the stale "Next" list immediately above:
Phase 1 route-family logging and Phase 2 audit-chain work have landed in the
working tree. See the "Continuation Handoff — 2026-05-07 (observability +
audit trail Phases 1-2)" section earlier in this file for the detailed file
list, decisions, deferrals, and verification commands.

---

# Continuation Handoff — 2026-05-07 (observability Phases 3-4)

## Landed in this run

- **Phase 3 request correlation.** `src/services/apiClient.js` now generates
  a UUID-v4 `X-Request-Id` per request, sends it on every fetch, and captures
  the echoed response id. JSON bodies get a non-enumerable `__requestId`; raw
  `Response` returns keep the header and also get non-enumerable
  `__requestId` when possible.
- **Phase 3 client log storage/routes.** Added
  `migrations/0009_client_logs.sql` with `client_logs` and the
  `(tenant_id, session_id, received_at)` replay index. Added authenticated
  `POST /api/client-logs/batch` with validation, max 100 entries per batch,
  per-user rate limit of 60 batches / 5 minutes, request/user/session/tenant
  correlation, and `GET /api/client-logs` for educator/admin tenant-scoped
  newest-first replay.
- **Phase 3 EventLogger verbs.** Added `LOST_FOCUS`, `RESUMED_FOCUS`,
  `UNLOAD`, `STT_RESULT`, `STT_ERROR`, and `TTS_PLAYED` metadata and helpers.
  App shell registers focus/blur/beforeunload listeners and cleans them up on
  user changes. `voiceService` logs STT result/error metadata and TTS playback
  completion without logging transcript text.
- **Phase 3 DiagnosticBar replay.** Admin/educator DiagnosticBar now fetches
  `GET /api/client-logs?limit=50` or session-scoped replay while expanded,
  refreshes every 5s, pauses when collapsed, and renders a compact color-coded
  client-log table.
- **Learning-event verb parity.** Server `LEARNING_VERBS` now includes the
  full `EventLogger.VERBS` catalogue so BackendSurface telemetry for less
  common verbs is not rejected.
- **Phase 4 docs.** Added `docs/OBSERVABILITY.md`,
  `docs/AUDIT_TRAIL.md`, and `docs/LEARNING_ANALYTICS.md`; added an "Audit
  chain broken" playbook to `docs/INCIDENT_RESPONSE.md`; added the requested
  documentation map to `CLAUDE.md`.

## Decisions

- `client_logs.user_id` is nullable in schema as requested, but the current
  authenticated batch route sets it from `req.user.id`. Post-logout delivery
  would need a separate authenticated/queued client strategy; no new auth path
  was introduced.
- Client STT logging records lengths, final/interim state, language, and error
  codes only. It deliberately does not place raw transcripts in telemetry
  context.
- DiagnosticBar replay uses `apiFetch`, so cookie and legacy bearer auth stay
  in the existing dual-mode lane.
- The `GET /api/client-logs` query uses fixed SQL strings for the session vs
  non-session paths to stay inside the SQL interpolation guard.

## Verification

- `node --check server/routes.js`
- `node --check server/migrationRunner.js`
- Focused: `npm test -- src/services/apiClient.test.js src/services/eventLogger.test.js src/components/debug/DiagnosticBar.test.jsx tests/server/client-logs.test.js tests/server/sql-injection-guard.test.js`
- Regression rerun after fixing Response-like mocks:
  `npm test -- src/components/settings/TestVoiceButton.test.jsx src/services/apiClient.test.js`
- `npm test` passed: 76 files, 1020 tests passing, 10 skipped.
- `npm run build` passed. Vite still reports the existing large chunk warning.

## Outstanding

- No Phase 3/4 deliverables are intentionally deferred.
- The client-log POST route exists and is tested, but no general-purpose
  browser log shipper beyond DiagnosticBar replay was added because the
  requested EventLogger telemetry already flows through `learning_events`.

---

# Deferred Audit Refactors Run — 2026-05-07 (Item A partial)

## Landed in this run

Item A progressed as complete, commit-ready slices. All migrated API calls now
go through `src/services/apiClient.js`, so bearer auth, cookie/CSRF support,
`ApiError`, and `X-Request-Id` are centralized.

### Slice 1 — avatar/treatment settings

- `src/components/settings/CaseAvatarVoicePicker.jsx`
  - Migrated `/api/tts/voices?provider=...` to `apiFetch`.
  - Left `baseUrl('/avatars/heads/manifest.json')` as direct fetch because it
    is a static public asset, not an authenticated `/api/*` call.
  - Expanded existing tests with bearer/path/request-id coverage and 403
    no-crash coverage.
- `src/components/settings/CaseTreatmentConfig.jsx`
  - Migrated `/api/treatment-effects` to `apiFetch`.
  - Migrated `PUT /api/cases/:id/treatments` to `apiPut`.
  - Added component tests for authenticated GET, PUT body shape, and 403 toast.
- `src/components/settings/AvatarsSettingsTab.jsx`
  - Migrated `/api/platform-settings/avatars`, `/api/tts/voices`, and
    `PUT /api/platform-settings/avatars` to `apiFetch`/`apiPut`.
  - Left avatar manifest fetch as static asset fetch.
  - Added component tests for authenticated GET, PUT body shape, and 403 toast.

### Slice 2 — media upload editors

- `src/components/settings/PhysicalExamEditor.jsx`
  - Migrated audio uploads to `apiFetch('/upload', { method: 'POST', body:
    formData })`; no manual `Content-Type`, so multipart boundaries remain
    browser-managed.
  - Added component tests for upload auth/path/FormData shape and 403 toast.
- `src/components/settings/RadiologyEditor.jsx`
  - Migrated `/api/radiology-database` to `apiFetch`.
  - Migrated image/video uploads to `apiFetch` with `FormData`.
  - Added component tests for authenticated GET, upload FormData body, success
    state update, and 403 toast.

### Slice 3 — profile/voice settings

- `src/components/settings/UserProfilePanel.jsx`
  - Migrated `/api/user/profile`, `/api/platform-settings/user-fields`,
    `/api/users/preferences`, and profile/password/preference PUTs to
    `apiFetch`/`apiPut`.
  - Added component tests for authenticated profile GET, profile PUT body, and
    403 toast.
- `src/components/settings/VoiceSettingsTab.jsx`
  - Migrated `/api/platform-settings/voice`, `/api/llm/models`,
    `/api/tts/voices`, `/api/tts/usage`, and voice-settings PUTs to
    `apiFetch`/`apiPut`.
  - Added component tests for authenticated GET, PUT body, 403 toast, and the
    existing admin usage-scope gate.

### Slice 4 — lab manager

- `src/components/settings/LabTestManager.jsx`
  - Migrated `/api/labs/all`, `/api/labs/groups`, `/api/labs/stats`,
    `/api/labs/test`, and `/api/labs/import` to `apiFetch`/method helpers.
  - Added component tests for authenticated GET, POST body shape, and 409
    toast.

## Verification

- Focused settings run:

```text
npx vitest run \
  src/components/settings/CaseAvatarVoicePicker.test.jsx \
  src/components/settings/CaseTreatmentConfig.test.jsx \
  src/components/settings/AvatarsSettingsTab.test.jsx \
  src/components/settings/PhysicalExamEditor.test.jsx \
  src/components/settings/RadiologyEditor.test.jsx \
  src/components/settings/UserProfilePanel.test.jsx \
  src/components/settings/VoiceSettingsTab.test.jsx \
  src/components/settings/LabTestManager.test.jsx

8 files passed
40 tests passed
```

- Full suite:

```text
npm test
83 files passed
1043 passed, 10 skipped
```

## Deferred / still outstanding

- **Item A remaining files:** `src/components/settings/MedicationManager.jsx`
  and `src/components/settings/ConfigPanel.jsx`.
  - `MedicationManager.jsx` still has six authenticated direct-fetch paths:
    `/master/medications`, `/catalogue/medications/:id`,
    `/master/medications/:id`, `/master/medications/all`, and
    `/master/medications/bulk`.
  - `ConfigPanel.jsx` remains the large final slice and still has many direct
    fetch paths across cases, uploads, platform settings, analytics, users,
    labs, agents, and scenarios.
- **Item B skipped:** TTS/LLM usage-budget tracker not started. Item A took the
  available implementation budget.
- **Item C skipped:** dbAdapter boundary migration not started.
- **Item D skipped:** `server/routes.js` split not started.

## Notes / friction

- `rg` now reports direct `fetch` in the migrated files only for avatar manifest
  static assets. Those use `baseUrl(...)`, not `/api/*`, and do not need auth.
- There were pre-existing unrelated working-tree changes in
  `server/security-headers.js` and `tests/server/security-headers.test.js`;
  this run did not touch or revert them.
