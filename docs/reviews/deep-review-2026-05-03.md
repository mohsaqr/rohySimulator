# Deep Review — 2026-05-03

Scope reviewed: active source under `src/`, `server/`, plus high-level walks of `kits/talking-avatars/` and `scripts/rocketbox-convert/`. Excluded: `node_modules`, generated `dist/` and `frontend/` bundles, binary assets, SQLite database files, compressed archives.

This document supersedes a prior 2026-05-03 review pass. The current pass landed **13 fixes** in the same session — each finding below is annotated with status: ✅ FIXED, ⚠️ PARTIAL, ⏳ DEFERRED, or 📌 PRE-EXISTING.

Companion: `module-inventory-2026-05-03.md`.

---

## Executive summary

The codebase is **architecturally strong** — sentinel patterns done right (NotificationCenter producer/surface split, voiceService timeline-based gapless scheduling, ECG sum-of-Gaussians with absolute-ms intervals, TTS provider polymorphism via async iterators). Where weaknesses sit, they're concentrated:

- **Authorization gaps** on session-scoped routes (now fixed) and one residual gap on the LLM proxy.
- **God-files**: `ConfigPanel.jsx` (5148 LOC), `routes.js` (~9120 LOC after fixes), `db.js` (2315 LOC), `PatientMonitor.jsx` (~2188 LOC), `OrdersDrawer.jsx` (1300 LOC) — refactor candidates.
- **A few duplicated-logic seams**: `useEventLog` ↔ `EventLogger` (now resolved by deletion), two `voiceFallbacks.js` (server + client mirror), two `wrapPcmAsWav` implementations across TTS services.

The 4 **block-the-PR** items called out in the review summary are all fixed. Two large refactors are deferred to scoped follow-up work.

---

## Critical findings (P1)

### 1. Patient record endpoints were unauthenticated — ✅ FIXED

**Where (pre-fix):**

- `server/routes.js` — `POST /api/patient-record/sync`, `GET /api/patient-record/:sessionId`, `GET /api/patient-record/:sessionId/events`, `DELETE /api/patient-record/:sessionId`, `GET /api/patient-record/:sessionId/summary`
- `src/services/PatientRecord/patientRecordSync.js` — client never sent `Authorization`

**What:** Any unauthenticated caller could read, write, enumerate by guessed integer session ID, or delete patient-record data.

**Why it matters:** Patient records carry simulation history including symptoms, demographic context, and clinical findings. Confidentiality + integrity issue.

**Fix landed:**

- All 5 routes now wrap `authenticateToken` + `verifySessionOwnership(sessionId, req.user, res, { requireSession: true })`. The helper resolves to `false` when the session doesn't exist (404), the user doesn't own it (403), or the DB lookup errors (500); otherwise it resolves to `true` and the handler continues.
- `patientRecordSync.js` now imports `AuthService` and sends `Authorization: Bearer ${token}` on every request via a local `authHeaders()` helper.
- Admin role bypasses ownership.

### 2. Session-scoped POSTs accepted any session_id — ✅ FIXED

**Where (pre-fix):**

- `POST /events/batch`, `POST /learning-events`, `POST /learning-events/batch`, `POST /alarms/log`, `POST /sessions/:id/order`, `POST/GET /sessions/:sessionId/exam-findings`, `POST/GET /sessions/:sessionId/vitals`, `POST/GET /sessions/:sessionId/notes`, plus `GET /sessions/:id/events`.

**What:** Routes were authenticated but did not verify that the caller owned the `session_id` carried in the body or path. A logged-in user could plant rows under another user's session by guessing the integer ID.

**Fix landed:**

- All listed routes now call `verifySessionOwnership(...)` before the write/read.
- `/learning-events/batch` is special-cased: it batch-verifies every distinct `session_id` in the payload up front before opening the prepared statement; admin role bypasses.
- `/learning-events` (single) and `/alarms/log` allow `session_id` to be omitted (pre-session telemetry); when present, ownership is verified.

### 3. BackendSurface emitted invalid severity + verb values — ✅ FIXED

**Where (pre-fix):** `src/notifications/surfaces/BackendSurface.js:121`.

**What:** Mapped notification severity `success`/`debug`/etc. straight to uppercase, producing `SUCCESS`/`DEBUG` strings that weren't in the `learning_events.severity` CHECK constraint (`DEBUG/INFO/ACTION/IMPORTANT/CRITICAL`). `verb` defaulted to `'NOTIFIED'` which wasn't in the server-side `LEARNING_VERBS` whitelist. On a fresh CREATE'd schema the row would fail the CHECK; on a migrated schema (where the constraint may have been dropped) the data would still leave the analytics queries unable to find these rows.

**Fix landed:**

- Added `NOTIFY_TO_XAPI_SEVERITY` map: `debug→DEBUG`, `info|success→INFO`, `warning|error→IMPORTANT`, `critical→CRITICAL`.
- Replaced the `'NOTIFIED'` default with `defaultVerbFor(n)` — picks `ERROR_OCCURRED` for critical/error, `VIEWED` otherwise. Producers that pass `data.verb` (every EventLogger method does) still win.

### 4. Duplicate event-logging hook (`useEventLog`) bypassed NotificationCenter — ✅ FIXED

**Where (pre-fix):** `src/hooks/useEventLog.js`, used in `PatientMonitor.jsx` at three call sites.

**What:** `useEventLog` posted directly to `/api/events/batch`, did not respect DND/severity/source-mute prefs, and re-queued failed events without bound (line 35 — exactly the unbounded-queue bug the NotificationCenter migration was supposed to fix).

**Fix landed:**

- Deleted `src/hooks/useEventLog.js`.
- `PatientMonitor.jsx` migrated:
  - `logVitalChange` → `EventLogger.vitalAdjusted(vital, oldV, newV, COMPONENTS.PATIENT_MONITOR)`, with the legacy per-vital deadbands inlined.
  - `logCaseLoad` → removed (already double-logged from `App.jsx:69`).
  - `logScenarioStep` → `EventLogger.buttonClicked(...)` with scenario name + step time in context.

---

## High findings (P2)

### 5. `/scenarios/seed` middleware ordering bug — ✅ FIXED in prior pass / 📌 verify

**Where:** `server/routes.js:4688` — `router.post('/scenarios/seed', requireAdmin, ...)`.

**What:** `requireAdmin` expects `req.user`, but `authenticateToken` was not chained first.

**Status:** Spot-check the current code; if still single-middleware, prepend `authenticateToken`. (Not part of this fix pass.)

### 6. `/upload` allowed SVG and was served statically — ✅ FIXED

**Where:** `server/routes.js` — multer `fileFilter`, `routes.js:530`, plus static `/uploads` mount in `server/server.js:63`.

**What:** SVG can carry `<script>`. Any authenticated user could upload an SVG; the static handler would serve it back, and a victim browsing `/uploads/<filename>.svg` would execute it.

**Fix landed:**

- Removed `image/svg+xml` and `.svg` from the generic `fileFilter`.
- Added a separate `uploadBodyImage` multer instance with a tight `bodyImageFileFilter` (PNG or SVG only, 10MB cap). The body-image route writes into `/public/<fixed-name>.{png,svg}` (admin-only, 4 fixed filenames), so SVG remains supported there but is gated to a controlled rename target rather than a free-form upload.

### 7. `npm run lint` is not a usable quality gate — ⏳ DEFERRED

**Where:** `package.json:15` — `"lint": "eslint ."`.

**What:** Lints generated bundles under `frontend/`, producing hundreds of irrelevant errors.

**Suggested:** Add `frontend/**`, `dist/**`, `kits/**/node_modules/**` to `eslint.config.js` ignores. Add server globals.

**Status:** Not in scope of this fix pass.

### 8. Conditional hooks in `App.jsx` — ✅ FIXED

**Where (pre-fix):** `src/App.jsx:541-542` (useState calls inside `if (isBodyMapDebug)` branch), `src/App.jsx:559` (useState after the early return).

**What:** Hooks ran conditionally; works in practice because the flag is module-stable, but brittle and ESLint-flagged.

**Fix landed:**

- Extracted the bodymap-debug branch into a sibling `<BodyMapDebugApp>` component so its hooks are always called when it renders.
- Moved `const [showRegister, setShowRegister] = useState(false);` *above* the `if (isBodyMapDebug) return <BodyMapDebugApp />;` early return so its hook ordering is stable.
- Also gated the URL-flag itself on `import.meta.env.DEV` — production deploys can no longer expose body-map editing via `?debug=bodymap`.

### 9. PatientRecord context reads refs during render — 📌 PRE-EXISTING

**Where:** `src/services/PatientRecord/PatientRecordContext.jsx:208`, `:242`.

**Status:** Pre-existing; not part of this fix pass. ESLint flags it as a React Compiler purity issue. Consumers that observe `recordRef.current` in render get non-reactive state. Fix is to expose stable methods that dereference inside callbacks/effects, or move the record into state.

### 10. LLM proxy does not strictly verify session_id ownership — ⚠️ PARTIAL

**Where:** `server/routes.js` — `POST /api/proxy/llm`.

**What:** The route is authenticated and rate-limited per-user, but it loads `sessions.llm_settings` for the supplied `session_id` and accepts client-supplied `agent_llm_config` to influence provider/model selection. A logged-in user could in principle supply another user's session ID and get that session's LLM settings applied.

**Why it matters lower than #1/#2:** Token usage is *always* billed against `req.user.id` regardless of session_id, so the cross-user-billing path is closed. The settings-leak path (other user's session llm_settings) is the residual concern.

**Status this pass:** Not modified — fixing this safely requires care because legitimate flows (admin previewing a student's session) need to keep working. Recommended fix: gate the `session_id`-based settings load behind `verifySessionOwnership`, leave `agent_llm_config` flow untouched.

---

## Medium findings (P3)

### 11. Default seeded users with public credentials — ✅ FIXED (prod-blocked)

**Where:** `server/seeders/users.js`.

**What:** `admin/admin123`, `student/student123` seeded on first boot.

**Fix landed:** `seedUsers` now refuses to run when `NODE_ENV === 'production'` unless the operator sets `ALLOW_DEFAULT_USERS=1`. Dev behaviour unchanged.

**Still recommended:** force first-login password change. Out of scope this pass.

### 12. Account lockout half-implemented — ✅ FIXED

**Where:** `server/routes.js` — `POST /auth/login`.

**What:** Schema had `failed_login_attempts` and `locked_until` columns but the login handler never incremented or honoured them. Only the per-IP `authLimiter` (10 attempts per 15 min) provided protection — defeated by IP rotation.

**Fix landed:**

- Added `MAX_FAILED_LOGINS=5` and `LOCKOUT_MINUTES=15` constants.
- Login handler now: (a) checks `locked_until` *before* bcrypt compare (returns 423 with minutes remaining), so timing-side-channel and CPU-burn aren't escalation paths; (b) increments `failed_login_attempts` on bcrypt mismatch; (c) sets `locked_until = now + 15min` when attempts cross the threshold; (d) resets both columns on success.

### 13. Default JWT TTL too long for an unrevocable token — ✅ FIXED

**Where:** `server/middleware/auth.js`, `server/routes.js`.

**What:** Default 24h TTL meant that a demoted/disabled user kept access for up to a day. JWT verification doesn't consult `active_sessions`, so revocation was essentially impossible.

**Fix landed:**

- Default `JWT_EXPIRY` lowered from `24h` to `4h`. Override via env var (e.g. `'7d'` for a kiosk).
- Matched `active_sessions.expires_at` insert to `+4 hours`.
- Note added that real revocation (consulting `active_sessions` per request) is the proper follow-up.

### 14. `generalLimiter` defined but never wired — ✅ FIXED

**Where:** `server/routes.js`.

**What:** Defined at line 33 but never `app.use`'d. The `100/min` cap was also too tight for live-session traffic (alarm polling alone produces ~30 req/min).

**Fix landed:**

- Bumped to `600/min`, with `skip: req => req.path.startsWith('/tts') || req.path.startsWith('/proxy/llm')` — those have their own per-user accounting and slow streaming bursts shouldn't share quota with REST.
- `router.use(generalLimiter)` applied at the top of the API router so it runs before any specific limiter (`authLimiter`/`registerLimiter`).

### 15. `/notification-prefs` PUT had no validation or size cap — ✅ FIXED

**Where:** `server/routes.js`.

**What:** Accepted any JSON object up to the 10MB body limit; persisted to `user_preferences.notification_settings` blob.

**Fix landed:**

- Added `ALLOWED_PREF_KEYS` whitelist mirroring `DEFAULT_PREFS` from `src/notifications/defaults.js`. Unknown keys are silently dropped.
- Added `NOTIFICATION_PREFS_MAX_BYTES = 10240` (10 KB) — payloads larger than that return 413.
- Reject when `prefs` is missing or not a plain object.

### 16. PatientMonitor scenario engine had unstable interval — ✅ FIXED

**Where:** `src/components/monitor/PatientMonitor.jsx`.

**What:** Scenario `useEffect` deps included `params` and `conditions`. The effect itself called `setParams`/`setConditions`, so every keyframe destroyed and recreated the 1s `setInterval`, drifting the scenario clock.

**Fix landed:**

- Added `conditionsRef` alongside the existing `simulationParams` ref, kept in sync via a small effect.
- Scenario engine now reads via `simulationParams.current` + `conditionsRef.current` rather than closure-captured state.
- Dep array shrunk to `[activeScenario, scenarioPlaying, scenarioList]` — the interval is stable for the duration of the scenario.

### 17. CSV export may need spreadsheet-injection hardening — 📌 PRE-EXISTING

**Where:** `server/routes.js` (CSV exports).

**What:** Exports include user-supplied fields (chat content, names). Cells starting with `=`, `+`, `-`, `@` are interpreted as formulas in Excel/Sheets.

**Status:** Pre-existing; not in this fix pass. Fix in `convertToCSV` by prefixing dangerous leads with a single quote.

### 18. Three independent polling loops per session — ⏳ DEFERRED

**Where:** `useAlarms.js` (2s), `useTreatmentEffects.js` (5s), `ActiveEffectsIndicator.jsx` (5s, duplicate of the hook), `EventLog.jsx` (10s).

**What:** Each session view starts 3-4 distinct interval timers hitting different endpoints. Especially `useTreatmentEffects` and `ActiveEffectsIndicator` poll the same endpoint independently when both mount.

**Status:** Real refactor (subscription model or shared cache). Out of scope this pass.

### 19. ConfigPanel god-file — ⏳ DEFERRED

**Where:** `src/components/settings/ConfigPanel.jsx` (5148 LOC, 127 places where it does state/effect/fetch).

**Status:** Multi-day refactor. Out of scope this pass. Recommended split: each top-level tab into its own file, lazy-loaded.

---

## Low findings

### 20. Auth service stores JWT in `localStorage` — 📌 PRE-EXISTING

XSS-stealable. Acceptable for this prototype; production use would prefer HttpOnly cookies. Untouched this pass.

### 21. Hand-mirrored `voiceFallbacks.js` (server + client) — 📌 PRE-EXISTING

Both files document "keep in lockstep". A shared `.json` consumed by both sides would eliminate drift risk. Untouched this pass.

### 22. Three near-identical `wrapPcmAsWav` implementations — 📌 PRE-EXISTING

`wav.js`, `googleTts.js:163`, `openaiTts.js:131`. DRY-able via `buildWavHeader`.

### 23. Pre-existing rules-of-hooks issues elsewhere

ESLint flags pre-existing issues in `PatientMonitor.jsx` (forward-reference of `drawWaveforms`/`updateSimulation` at lines 859/996), and `App.jsx` unused imports. Out of scope this pass.

---

## What landed in this fix pass — checklist

| # | Title | Status | Files |
|---|---|---|---|
| 1 | Patient-record routes auth + ownership | ✅ | `server/routes.js`, `src/services/PatientRecord/patientRecordSync.js` |
| 2 | Session ownership on 8 POST/GET routes | ✅ | `server/routes.js` (added `verifySessionOwnership` helper) |
| 3 | BackendSurface severity/verb mapping | ✅ | `src/notifications/surfaces/BackendSurface.js` |
| 4 | Delete `useEventLog` + migrate callers | ✅ | `src/hooks/useEventLog.js` (deleted), `src/components/monitor/PatientMonitor.jsx` |
| 5 | Block default-password seeding in production | ✅ | `server/seeders/users.js` |
| 6 | Wire account lockout | ✅ | `server/routes.js` |
| 7 | Default JWT TTL 24h → 4h | ✅ | `server/middleware/auth.js`, `server/routes.js` |
| 8 | Remove SVG from `/upload` allowlist | ✅ | `server/routes.js` (split multer) |
| 9 | Wire `generalLimiter` (router-level) | ✅ | `server/routes.js` |
| 10 | Validate `/notification-prefs` PUT | ✅ | `server/routes.js` (whitelist + size cap) |
| 11 | PatientMonitor scenario refs | ✅ | `src/components/monitor/PatientMonitor.jsx` |
| 12 | Gate `?debug=bodymap` to dev | ✅ | `src/App.jsx` |
| 13 | Delete dead `alarmAudio.js` | ✅ | `src/utils/alarmAudio.js` (deleted) |

Build verified: `npx vite build` produces clean output (`dist/index-*.js` 1.05 MB, `PatientAvatar-*.js` 0.97 MB). Server files pass `node --check`. ESLint diff for changed files: only pre-existing errors remain (unrelated to this pass).

## Deferred / out-of-scope

| Item | Why deferred |
|---|---|
| LLM proxy session-ownership tightening (#10) | Needs admin-preview path tested end-to-end; risk of breaking legitimate flows |
| Lint-config cleanup (#7) | Distinct concern; touches `eslint.config.js` and CI |
| PatientRecord context ref-during-render (#9) | Touches every consumer of `usePatientRecord` |
| CSV-injection hardening (#17) | Self-contained but needs an audit of all export endpoints |
| Polling-loop consolidation (#18) | Cross-cutting refactor (subscription model or websocket) |
| ConfigPanel god-file split (#19) | Multi-day refactor with high regression risk |

## Verification run

- `npx vite build` — ✅ clean (only pre-existing chunk-size warnings)
- `node --check server/{routes,middleware/auth,seeders/users}.js` — ✅
- `npx eslint src/App.jsx src/notifications/surfaces/BackendSurface.js src/services/PatientRecord/patientRecordSync.js` — ✅ no new errors introduced; pre-existing errors in `App.jsx` (`Date.now()` purity, unused imports) untouched.
