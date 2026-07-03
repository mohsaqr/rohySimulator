# Agent Note - Admin color refresh and theme normalization

Date: 2026-07-03
Context: Rohy admin/settings surfaces, light theme cleanup, teal-only accent pass.

## Summary

The admin and analytics UI now uses a single darker off-white background with
teal as the only active accent family. The main goals were:

- remove purple/violet/pink leakage across backend/admin screens
- replace the old mixed off-white / gray / tinted panel look with a consistent
  neutral surface system
- keep destructive states red and leave informational badges/buttons readable

## What Changed

- Updated the shared theme tokens in `src/index.css`.
  - Background, surface, border, hover, and accent colors now resolve to one
    neutral palette plus teal accents.
  - Added shared utility classes for cards, stat cards, subtler buttons,
    badges, menus, tables, and danger actions.
  - Added compatibility rules so older purple/violet/pink utilities resolve to
    teal instead of leaking into the UI.
  - Added neutralization rules for legacy dark tinted section panels and form
    borders.

- Updated `src/components/settings/AgentTemplateManager.jsx`.
  - Reworked Agent Personas list cards to use the shared neutral card system.
  - Removed the purple-tinted standard template panel styling.
  - Normalized the standard/custom labels, action buttons, and the reset modal.

- Updated `src/components/settings/AgentPersonaEditor.jsx`.
  - Moved the full-screen editor onto the shared light admin wrapper so the
    persona editor no longer renders as a standalone dark screen.

- Updated the broader settings and analytics surfaces earlier in the pass.
  - Cases, Medications, Logs, Oyon analytics, and related admin surfaces now
    inherit the same background and accent system.

- Bumped the app version to `2.4.1` in `package.json` and `package-lock.json`.

## Verification

Run locally:

```sh
git diff --check
npx vitest run \
  src/components/settings/MedicationManager.test.jsx \
  src/components/settings/ConfigPanel.test.jsx \
  src/components/settings/TestVoiceButton.test.jsx \
  src/components/settings/AgentPersonaEditor.test.jsx \
  src/components/analytics/OyonDataLogs.test.jsx \
  src/components/analytics/tna/TnaDashboardV2.test.jsx \
  src/components/oyon/OyonAffectView.test.jsx \
  src/components/oyon/OyonGazeView.test.jsx \
  src/components/oyon/OyonSessionsView.test.jsx \
  src/components/oyon/OyonAttentionView.test.jsx \
  src/components/oyon/OyonEngagementView.test.jsx \
  src/components/oyon/OyonCompareView.test.jsx
npm run build
```

Results:

- `git diff --check` passed.
- Focused Vitest suite passed: 11 files, 139 tests.
- `npm run build` passed.

Browser checks were also run against the local Vite server at
`http://127.0.0.1:5173/` for:

- Agent Personas
- Persona Editor
- Cases
- Medications
- Logs
- Avatars
- Voice
- Cohorts
- Scenarios
- Oyon settings

## Caveats

- The repo still contains existing untracked note files:
  - `AGENT-NOTE-OYON-GAZE-LOGS.md`
  - `CLAUDE.md`
- The shared CSS compatibility layer is intentionally broad so the old class
  names keep working while the remaining screens are normalized.
- Some legacy purple class names still exist in source files, but the rendered
  UI now resolves them to teal or neutral surfaces in the admin shell.
