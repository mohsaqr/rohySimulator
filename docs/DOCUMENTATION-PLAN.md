# Rohy Enterprise Documentation & Support — Execution Plan

> Status: **approved, ready to execute**. This is a tracked planning contract, not a session
> artifact — it is intended to live in `docs/` and be reviewed/updated as stages complete.
> Owner: docs lead. Last revised: 2026-05-16.

---

## 0. Locked decisions (do not relitigate)

| Decision | Choice | Consequence |
|---|---|---|
| Docs toolchain | **VitePress** | Vite-native, matches the React 19 / Vite 7 stack; Markdown-centric; lives in-repo |
| In-app Help & Support | **Full scope** | Stage 4 is a real React/Express build, not docs-only |
| First shippable milestone | **Trainee + Educator** | End-user-facing guides + the in-app help they need ship first |
| Plan artifact | **Tracked doc in `docs/`** | This file; updated as the source of truth for progress |

Out of the locked set, the load-bearing one is **full in-app scope**: it makes Stage 4
(Product track) a first-class workstream that runs in parallel with the docs track, not an
afterthought.

---

## 1. Why this shape (grounded in the codebase audit)

A three-agent recon of the repo established the real gap profile:

**Strong already** — operator/engineer docs: `README.md` (full feature catalogue),
`docs/INSTALL.md`, `docs/DEPLOY.md`, `docs/UPDATING.md`, `docs/UPDATE-STRATEGY.md`,
`migrations/MANIFEST.md`, `CLAUDE.md`, the OyonR doc set, 15+ `audit-*.sh` + `tech-test.sh`.

**Missing or thin** — everything the other four audiences need:

1. No trainee/student documentation, no user manual, no getting-started.
2. No educator/case-author guide (12-step wizard, agent editor, scenario design, the 4
   reporting views + TNA all undocumented for end users).
3. No consolidated admin guide (first-week checklist, settings reference, cohort ops).
4. No API reference — **~260 endpoints across 21 route files**, zero OpenAPI/Swagger.
5. No data-model reference — **~65 tables**, only migration policy documented.
6. **No in-app help surface at all** — no tour, no contextual help, no FAQ UI, no
   support/diagnostics path. This is an engineering gap, not a writing gap.
7. No docs build tooling (no site, no search, no versioning).

Enterprise documentation is organized by **audience journey**, not by feature. Six audiences:

| # | Audience | Success metric | Today |
|---|---|---|---|
| 1 | **Trainee / student** | Can run a case unaided | ❌ none |
| 2 | **Educator / teacher** | Can build a class + a case + read reports | ❌ none |
| 3 | **Administrator** | Can configure the platform safely | 🟡 partial (`ADMIN_FIRST_RUN.md` only) |
| 4 | **Operator / DevOps** | Can install, update, recover | ✅ strong |
| 5 | **Integrator / developer** | Can call the API / embed / extend | 🟡 architecture only, no API ref |
| 6 | **Security / compliance** | Can attest RBAC, PII, AI-Act posture | 🟡 scattered across audits |

---

## 2. Toolchain & information architecture (Stage 0 deliverables)

### 2.1 VitePress setup

- Site root: `docs/` (VitePress `srcDir`), config in `docs/.vitepress/config.mjs`.
- Reuse existing `docs/*.md` in place where possible (INSTALL/DEPLOY/UPDATING become
  pages under the Operator section — no content rewrite, just re-homed + cross-linked).
- Local search (VitePress built-in MiniSearch; no external service — matches the
  self-hosted, air-gapped deployment constraint).
- Versioned to releases via `CHANGELOG.md`; nav reflects the 6-audience IA.
- Build wired into CI in Stage 7 (`npm run docs:build`), published alongside the app.
- **Constraint:** must build offline (air-gapped self-hosters) — no CDN-only assets.

### 2.2 Navigation tree (the IA contract)

```
/                     Landing — what is Rohy, pick your path by role
/trainee/             Using the Simulator        (M1)
/educator/            Teaching with Rohy          (M1)
/admin/               Administering Rohy
/operator/            Running Rohy in Production   (re-homes existing docs)
/integrator/          Building on Rohy
/reference/api/       Generated OpenAPI reference
/reference/data/      Schema reference
/reference/config/    Env vars & platform settings
/reference/cli/       rohy-update, migrate, seed, audits
/security/            Security & Compliance
/release-notes/       Bound to CHANGELOG.md
```

### 2.3 Single-sourcing rule

- **Reference = generated** from source (Stage 2). Never hand-written, never drifts.
- **Guides = authored** (Stage 3), curated, link *into* reference.
- **In-app help (Stage 4)** consumes the *same* Markdown content where feasible (Help
  Center articles are the trainee/educator pages, role-filtered), so there is one source.
- Glossary + style guide is the terminology lock: `cohort` = teacher-owned class; the
  `educator` role is labelled **"Teacher"** in UI; "Base Class" = backfill cohort; etc.

---

## 3. Stage-by-stage execution

Agents within a stage run concurrently. Stages are sequenced only on real dependencies.
Every stage ends at a **gate** that must pass before dependents proceed.

### Stage 0 — Foundation *(serial, lead)*
VitePress scaffold + IA tree + style guide + glossary + docs-as-code contract
(CODEOWNERS, doc-rot guardrails, versioning).
**Gate:** site builds empty-but-navigable; IA + glossary approved.

### Stage 1 — Content audit & gap matrix *(3 agents ∥)*
- A1 audit-existing → reuse/retire ledger
- A2 audit-product → task-to-screen matrix (per role)
- A3 audit-platform → reference manifest (endpoints/tables/env/CLI)
**Gate:** signed gap matrix (Section 5) = the master backlog.

### Stage 2 — Generated reference *(4 agents ∥)*
- R1 OpenAPI 3.1 spec + rendered API docs (auth model, error envelope, redaction notes)
- R2 schema reference + ER overview (soft-delete/tenant/audit columns called out)
- R3 config reference (every env var + platform setting, default, required-ness)
- R4 CLI & ops reference (`rohy-update`, `migrate.js`, `seed*`, `retention-sweep`, audits)
**Gate:** spec validates; 100% surface coverage; sampled accuracy check vs. source passes.

### Stage 3 — Authored guides *(6 agents ∥; M1 = G1+G2 first)*
- **G1 Trainee** — 5 rooms, history, exams/body-map, ordering, vitals/alarms, voice,
  debrief, FAQ, troubleshooting **(M1)**
- **G2 Educator** — cohorts/join codes, assigning cases, 12-step wizard, agent personas,
  scenario timelines, 4 reporting views + TNA, Oyon analytics, classroom-policy semantics
  including the *stored-not-yet-enforced* honesty note **(M1)**
- G3 Admin — first-week checklist, users/RBAC, settings reference, editors, multi-tenant
- G4 Operator — reconcile existing INSTALL/DEPLOY/UPDATING into a runbook library
- G5 Integrator — architecture seams, API auth walkthrough, embed `talking-avatars`,
  add a TTS/LLM provider, contribution + coverage-ratchet
- G6 Security/Compliance — RBAC, audit chain, redaction/PII, retention, Oyon on-device +
  EU AI Act Art. 5, consent, medical-training disclaimers, hardening checklist
**Gate per guide:** task-coverage vs. Stage-1 matrix + technical review.

### Stage 4 — In-app Help & Support *(Product track, 4 agents ∥; starts after A2)*
Real engineering. Runs parallel to Stages 2/3.
- **P1 Help Center** — `src/help/` searchable, role-aware drawer; consumes the same
  single-sourced content; **must not** introduce a parallel notification path (register
  through the existing model per `CLAUDE.md`)
- **P2 Contextual help & onboarding tour** — first-run guided tour per role + `?`
  affordances on the 5 rooms / settings tabs / orders drawer; dismissible + persisted;
  honors role gates **(M1: trainee + educator tours)**
- **P3 Support & diagnostics** — "Get Support" → redacted diagnostics bundle (version,
  request-id, env health, recent errors). **Must route through `server/redaction.js`** —
  no PII/secret leak; new sensitive fields registered there, not deleted at call sites
- P4 Release notes & status — in-app surface bound to `CHANGELOG.md` + "what's new"
  badge + readiness indicator (closes UPDATE-STRATEGY Phase-F gap)
**Gate:** client+server vitest green (pass `--project`); coverage ratchet holds; lint
zero-error; redaction audited (`audit-redaction.sh`); e2e for support bundle.

### Stage 5 — Tutorials & media *(3 agents ∥)*
- T1 quickstarts (per-audience 10-min "first success")
- T2 end-to-end walkthroughs using the 12 pre-built acute cases
- T3 media kit — screenshot/diagram standards + scripted capture list + video outlines
**Gate:** every command/step **executed and verified**, not assumed. Rendered media
(screenshots/HTML) presented to the user for review — not self-judged.

### Stage 6 — QA, a11y, i18n readiness *(4 agents ∥)*
- Q1 technical accuracy re-verify + doc-tests run real commands
- Q2 editorial (style/glossary consistency, cross-links, dead-link sweep)
- Q3 accessibility — docs site + in-app Help to **WCAG 2.2 AA**
- Q4 i18n readiness — externalize strings, translation-ready structure (English at launch)
**Gate:** zero broken links, zero unverified commands, a11y pass.

### Stage 7 — Publish, CI, maintenance *(2 agents ∥ → serial cutover)*
- M1-ci docs CI: build + lint + link-check + OpenAPI-validate + screenshot-regen
- M2-rot doc-rot guardrails: CODEOWNERS, "touch a route → update the spec" check,
  contribution guide, ownership map, review cadence
**Gate:** docs build green in CI; ownership assigned; maintenance contract documented.

---

## 4. Critical path & milestones

```
Stage 0 ─┬─> Stage 1 ─┬─> Stage 2 (R1–R4) ───────┐
         │            ├─> Stage 3 (G1–G6) ───────┼─> Stage 6 ─> Stage 7
         │            └─> Stage 5 (T1–T3) ───────┤
         └─ (after A2) ─> Stage 4 (P1–P4) ───────┘   Product track ∥
```

**Milestone M1 (first ship) — Trainee + Educator:**
Stage 0 → Stage 1 → { G1, G2 } + { P1, P2 (trainee/educator tours) } +
the slices of R1/R2 those guides link into → Stage 6 (scoped to M1) → publish.
M1 is the demo-able, enterprise-rollout-credible cut.

**M2:** Admin + Operator (G3, G4) + P3/P4 + full reference (R1–R4).
**M3:** Integrator + Security/Compliance (G5, G6) + Stage 5 + Stage 7 hardening.

Up to **14 agents concurrently** at peak (Stages 2+3+5 plus the 4 Product agents).
Stage 4's P-agents are the long pole — start them the moment A2 (product audit) lands.

---

## 5. Stage-1 gap matrix (seeded from recon — to be ratified, not started from zero)

Legend: ✅ exists & good · 🟡 partial/stale · ❌ missing · ⚠ wrong/misleading

| Topic | Trainee | Educator | Admin | Operator | Integrator | Sec/Comp |
|---|---|---|---|---|---|---|
| Getting started | ❌ | ❌ | 🟡 | ✅ | 🟡 | n/a |
| Core task walkthroughs | ❌ | ❌ | ❌ | ✅ | n/a | n/a |
| Feature reference | 🟡(README) | 🟡 | 🟡 | ✅ | 🟡 | n/a |
| API reference | n/a | n/a | n/a | n/a | ❌ | 🟡 |
| Data model | n/a | n/a | 🟡 | 🟡 | ❌ | 🟡 |
| Config/env | n/a | n/a | 🟡 | ✅ | 🟡 | 🟡 |
| Install/deploy/update | n/a | n/a | 🟡 | ✅ | n/a | 🟡 |
| RBAC / auth | n/a | n/a | 🟡 | 🟡 | 🟡 | 🟡 |
| Audit / PII / retention | n/a | n/a | 🟡 | 🟡 | n/a | 🟡 |
| Oyon (emotion / AI Act) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| In-app help / tour | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Support / diagnostics | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Troubleshooting/FAQ | ❌ | ❌ | ❌ | 🟡 | ❌ | n/a |
| Tutorials / media | ❌ | ❌ | ❌ | 🟡 | ❌ | n/a |

---

## 6. Cross-cutting constraints (from CLAUDE.md — non-negotiable)

- In-app help **must not** spawn a new toast/banner/alarm path — register through the
  central `src/notifications/` model.
- Support/diagnostics bundle **must** pass through `server/redaction.js`; register any new
  sensitive field there.
- Coverage ratchet is real — Stage 4 code must keep `vitest.config.js` floors; raise,
  never lower.
- Vitest is split `client`(jsdom)/`server`(node) — always pass `--project`.
- Session artifacts (HANDOFF/LEARNINGS/CHANGES/CLAUDE) stay local-only and uncommitted.
  **This file is *not* a session artifact** — it is intended docs and may be committed
  when the user directs.
- Branch policy for the current working tree (`feat/teacher-cohorts`): stay on branch,
  do not commit until the user explicitly asks.
- No `Co-Authored-By` lines in commits.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Generated API ref drifts from code | Stage 7 CI check fails build if a route changes without spec regen |
| In-app help becomes a parallel notification path | Architectural review gate in Stage 4; reuse `src/notifications/` |
| Diagnostics bundle leaks PII | Mandatory `redaction.js` route + `audit-redaction.sh` in the Stage 4 gate |
| Screenshots can't be self-verified by the agent | T3 presents rendered output to the user for sign-off (per repo testing rule) |
| Docs can't build air-gapped | VitePress local search + bundled assets; verified offline in Stage 7 |
| Scope creep past M1 | Milestone gates; M1 is strictly Trainee+Educator + their in-app help |

---

## 8. Next actions

1. Stage 0: scaffold VitePress under `docs/`, commit IA tree + glossary + style guide
   (build empty-but-navigable site).
2. Stage 1: launch A1/A2/A3 in parallel; ratify the Section-5 matrix.
3. Kick the Product track (P1/P2) the moment A2 lands — it is the long pole for M1.
4. Report progress by updating this file's stage gates as they pass.
