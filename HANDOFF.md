# Session Handoff — 2026-05-06 (TNA analytics rebuild on dynajs)

## Completed

Replaced the thin tnaj-based TNA dashboard with a LAILA-grade six-tab
analytics page powered by dynajs. No reinvention — sixteen TNA components
were lifted verbatim from LAILA-v3 via esbuild type-strip; a 200-line
ProcessMap tab uses dynajs's `buildDFGFromSequences` + dagre + Carmdash's
cumulative-95% pruning.

- `package.json`: dropped `tnaj` (v0.1.0, smaller surface), added `dynajs`
  and `dagre`.
- `server/routes.js`: rewrote `/api/analytics/tna-sequences` to LAILA's
  contract (parallel sequences + objectTypeSequences arrays, P95 chunking,
  actor / actor-session grouping, rich metadata). Added six sibling
  endpoints: `/daily-counts`, `/hourly-counts`, `/summary`, `/stats`,
  `/top-resources`, `/filter-options`.
- `src/components/analytics/tna/laila/` (NEW, 18 files): the verbatim
  LAILA TNA components (TS-stripped + i18n shimmed) plus three local shims
  (i18nShim, Loading, useTheme) and the new ProcessMap.jsx.
- `src/components/analytics/tna/clinicalStates.js`: 10-state simulator
  resolver chain (assessing / examining / investigating / treating /
  communicating / documenting / monitoring / regulating / reflecting /
  navigating) with explicit-pair → object-type → verb-fallback precedence.
- `src/components/analytics/tna/TnaDashboardV2.jsx`: 480-line LAILA-style
  page; six tabs (Activity / Network / Clusters / Patterns / Process Map /
  Settings); 4 sequence modes; 4 model types; 9 layouts; verb editor.
- `src/App.jsx`: TnaDashboard import flipped to V2.
- Tests: 15 server-integration + 10 unit tests, all 25 green.
- `CHANGES.md`, `LEARNINGS.md`, `HANDOFF.md` updated.

## Current State

| Layer | Before | After |
|---|---|---|
| Engine | tnaj 0.1.0 | dynajs (full surface incl. DFG, patterns, layout) |
| Server endpoints | 1 thin TNA endpoint | 7 endpoints (TNA + 6 activity / filter sources) |
| Client tabs | 1 (network only) | 6 (Activity / Network / Clusters / Patterns / Process Map / Settings) |
| Sequence modes | verb only | verb / object / combined / raw |
| Model types | relative only | relative / frequency / co-occurrence / attention |
| Layouts | hand-rolled circle | 9 (dynajs.layout) |
| Cluster methods | PAM × Levenshtein only | 5 methods × 4 dissimilarities (dynajs.clusterData) |
| Patterns | none | discoverPatterns short (2–3) + long (4–7) |
| Process mining | none | DFG + cumulative-95% pruning + dagre layout |
| Activity timeline | none | Daily timeline + hourly heatmap + verb donut + object donut + top-resources |

Test counts: 752 → 746 passing in full parallel suite (parallel flakes
expanded — same SQLITE_READONLY macOS issue), 25 new analytics tests all
green in isolation. Catalogue tests (57): all green. Build clean.

What works:
- All six tabs render against the seeded DB (5 sessions, 760 events,
  14 verb:object combos visible after filtering).
- Sequence-mode toggle re-derives states client-side without re-fetching.
- ProcessMap with start/end gates + cumulative-coverage slider.
- Verb renames + excludes editor in Settings tab.
- All endpoints respect case_id / user_id / start_date / end_date filters.

What is unfinished:
- The legacy `TnaDashboard.jsx` + 9 sibling charts under `src/components/
  analytics/tna/*.jsx` remain on disk but unused. Delete after one cycle of
  V2 in production.
- `tnaUtils.js` no longer used. Same — delete after a cycle.
- macOS parallel-test flake now also catches the new analytics-tna test.
  Fix is per-worker DB isolation (separate concern).
- Per-student / cohort comparison view (LAILA has it under Activity tab
  with `mode='student'`) is deferred — the simulator only has one user
  in the seed DB so cohort views aren't useful yet.

## Key Decisions

- **Copy-paste, not re-derive**. Per the user's directive ("0 reinvention").
  All 16 LAILA TNA components copied verbatim via `esbuild.transformSync`
  with `loader: 'tsx', jsx: 'preserve'`. Type strip only, no logic edits.
- **i18n via 50-line shim**, not adding `react-i18next` to a single-locale
  project. The shim exposes `useTranslation()` returning `{ t }` so call
  sites stay unchanged; humanises unknown keys + overrides ~50 user-facing
  labels.
- **Process Map = `buildDFGFromSequences` + dagre + cumulative-95% prune**.
  Same recipe Carmdash documents in its CLAUDE.md. ~200 lines including SVG.
- **Ten clinical states, not LAILA's twelve educational states**. The
  domain is clinical reasoning, not course consumption. Reflects the
  encounter loop, not the LMS.
- **Side-by-side V1 / V2 dashboard** for one cycle. Old code stays on
  disk; App.jsx flipped to V2. Delete the legacy tree after a successful
  in-production demo.
- **`skip_merges=true` from V2 client**, server-side merging skipped.
  The new clinical resolver chain on the client supersedes the
  `TNA_VERB_MERGE_MAP`; sending `skip_merges` keeps the legacy V1 path
  working unchanged for any external caller.

## Open Issues

- **macOS parallel-test SQLITE_READONLY flake** is now hitting three
  test files (`auth.test.js`, `discussion-screen.test.jsx`,
  `analytics-tna.test.js`). All pass in isolation. Per-worker DB
  isolation in `tests/utils/seedDb.js` would fix it cleanly.
- **Empty seed data on Activity tab in a fresh DB** — the simulator
  needs at least one completed session before the timeline / heatmap
  render anything useful. Document this in the user-facing onboarding
  text on the Activity tab if it confuses people.
- **Bundle size grew by ~600 KB** (from the verbatim LAILA + dynajs
  imports). Acceptable for an internal admin page; if we ever expose
  the dashboard to students at scale, dynamic-import the page.

## Next Steps

1. **Smoke-test V2 in a real browser** — load Settings → toggle TNA
   button → drive through Activity / Network / Process Map. Catch any
   runtime breaks in the verbatim-copied components (TS strip + i18n
   shim are the most likely failure surfaces).
2. **Delete the legacy V1 tree** once V2 is verified — `TnaDashboard.jsx`
   and the 9 sibling charts under `src/components/analytics/tna/*.jsx`
   plus `tnaUtils.js`. About 1500 lines of removable code.
3. **Per-worker DB isolation** in `tests/utils/seedDb.js` — fixes the
   macOS parallel-test flake permanently.
4. **Catalogue Session 3** (settings UI lift to 3-tab Curated/My/Search,
   group builder, OrdersDrawer surface) — the original plan from
   `project_drug_lab_catalogue_plan.md` is still parked.
5. **Cohort comparison view** — LAILA's `mode='student'` analogue. Add a
   "compare to cohort" toggle on the Activity tab that overlays the
   selected student against the case-level mean. Needs more than one
   student in the DB to be meaningful.

## Context

- Test runners (in isolation):
  - Server TNA: `npx vitest run tests/server/analytics-tna.test.js`
  - Resolver: `npx vitest run src/components/analytics/tna/clinicalStates.test.js`
  - Catalogue: `npx vitest run tests/server/catalogue-*.test.js`
- Client smoke (manual): `npm run client` → log in as admin → bottom-bar
  Activity icon → six tabs across the top.
- `dynajs` lives at `~/Documents/Github/dynajs` — same sibling as
  `LAILA-v3` and `Carmdash` use. `npm i file:../dynajs` rebinds.
- Build: `npx vite build` (clean, ~8s).
- All commercial-safe sources except CALIPER (CC BY-NC-SA), still
  isolated as before.
