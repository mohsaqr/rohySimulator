# Oyon Research Instrument — App Shell (Phase A)

This directory is the **new enterprise-grade UI** for Oyon. It runs alongside the
legacy `standalone/index.html` and `standalone/logs.html` while we migrate.
Phase A landed the shell only; capture and analytics will be ported in
Phases B–E.

## Stack

- **Vite 7 + React 18 + TypeScript** — strict mode, no `any` outside route-tree
  workarounds documented inline.
- **Tailwind CSS** driven by CSS variables in `src/styles/tokens.css`. Light and
  dark themes are selected with `<html data-theme="light|dark">` — no rebuild.
- **Radix Primitives + `class-variance-authority`** in the shadcn pattern. The
  six primitives in `src/components/ui/` (Card, Metric, StatusPill, Section,
  EmptyState, Button) replace the ad-hoc `.card / .panel / .kpi / .badge`
  classes scattered across the legacy HTML.
- **TanStack Router** for typed code-based routing. Seven workflow domains
  (`/capture`, `/calibrate`, `/live`, `/analyze/*`, `/sessions`, `/settings`,
  `/help`) match the Tier-2 plan.
- **TanStack Query** for any IndexedDB reads (cache, invalidation, devtools).
- **Zustand** for the session-context store (`useSessionContext`) consumed by
  the TopBar.
- **Lucide** icons.

## Run

From the repo root:

```bash
npm run app            # dev server at http://127.0.0.1:5174
npm run app:typecheck  # tsc --noEmit
npm run app:build      # production build
```

The legacy `npm start` still serves the original `standalone/index.html` at
`5173`. The two ports coexist during the migration; pick `:5174` to use the
new shell.

## What is here

```
standalone/app
├── index.html
├── tailwind.config.ts
├── vite.config.ts
└── src
    ├── main.tsx                       — entry; mounts RouterProvider + QueryClient
    ├── router.ts                      — assembles the route tree
    ├── styles/
    │   ├── tokens.css                 — single source of truth for design tokens
    │   └── globals.css                — base + reset
    ├── lib/
    │   ├── cn.ts                      — clsx + tailwind-merge helper
    │   └── sessionContext.ts          — Zustand store for the TopBar context strip
    ├── components/
    │   ├── ui/                        — design system primitives (six)
    │   └── shell/                     — AppShell, TopBar, LeftRail, PageHeader
    └── routes/                        — one file per workflow domain (stubs)
```

## What is **not** here yet

Everything below is intentional Phase B–E scope:

- Camera preview, MediaPipe pipeline, ONNX classifier integration.
- Gaze calibration overlay mounting and history.
- Live timeline / affect pad / spatial gaze tile actual data wiring.
- Analyze sub-views (the existing logs-dashboard.js views are not yet ported).
- Settings forms — currently the page lists section headers but no controls.
- Sessions list, reproducibility export, comparison mode, annotations.

See the top-level migration plan in the conversation that produced this scaffold
(or whichever planning doc currently lives in `docs/`).

## Boundary

This app is a **consumer** of the Oyon library that lives in `../../src`. The
library's `src/` remains framework-agnostic vanilla JS + ESM + hand-written
`.d.ts` files — that contract is unchanged. TypeScript and React live only
inside this directory and under `../../src/react/*` (which already existed).
