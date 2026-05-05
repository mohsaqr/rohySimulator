# Session Handoff — 2026-05-05

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
