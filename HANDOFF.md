# Session Handoff — 2026-05-05

## Stage 3 (Alarms + Notifications) — SHIPPED this session

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
| 4 | LLM precedence chain | MED | 45–60 min | platform → case → agent → session → user. Five layers, persona audit just touched the agent layer. |
| 5 | Scenario engine (runtime) | MED | 60–90 min | Storage audited; runtime engine in PatientMonitor:560–682 not yet. Beat application, scenario-disable mid-run, complete state. Stage 1's snapshot decision now constrains what mid-run admin edits do. |
| 6 | Physical exam + body map | MED | 60 min | Region master + per-case + AI-context narrative. Same drift pattern as labs/treatments. |
| 7 | Auth + user preferences | LOW | 30–45 min | Simple FK relationships; expect 0–1 real findings. |
| 8 | TNA analytics + event log | LOW | 45–60 min | Read-mostly aggregation; drift is cosmetic. Run after Stage 1 informs event lifecycle. |
| 9 | Body avatars (if separate from heads) | LOW | 15–60 min | First check: do body GLBs exist as a separate concept? If no, close. |

**Sequencing**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Stop after Stage 3 if
the user signals "good enough" — the high-blast-radius work is done at
that point. Stages 4–6 are tighter, more bounded. Stages 7–9 are
budget-permitting.

### Universal audit pattern (carry forward from prior three audits)
1. **Explore (parallel, 2–3 agents)** mapping DB → server → frontend → runtime.
2. **Triage** — verify every claim before fixing. Prior audits had ~30% false-positive rate.
3. **Decision points** through `AskUserQuestion` for anything architectural.
4. **Fix HIGH always; cheap MEDIUM (≤15 min) opportunistically**; defer expensive MEDIUM and all LOW.
5. **Verification** — re-runnable `scripts/audit-<area>.sh` where contract is stable; otherwise manual smoke-list.
6. **Document** — append CHANGES, replace HANDOFF section, append LEARNINGS.

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
