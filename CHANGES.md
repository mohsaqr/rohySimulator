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
