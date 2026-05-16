# Rohy Documentation — Stage 1 Content Audit & Gap Matrix

> Status: **ratified**. This is the master backlog for Stages 2–5. Derived
> from the three-agent codebase sweep (existing docs / product surface /
> platform surface). Update as items are closed. Build-excluded (internal).

---

## A1 — Reuse / retire ledger (existing material)

| Source | Disposition | Where it goes |
|---|---|---|
| `README.md` feature catalogue | **Reuse** as source for guides; do not link users to it | mined by G1–G6 |
| `docs/INSTALL.md` | **Reuse**, re-home | Operator (G4) — convert VitePress-safe |
| `docs/DEPLOY.md` | **Reuse**, re-home | Operator (G4) |
| `docs/UPDATING.md` | **Reuse**, re-home | Operator (G4) |
| `docs/UPDATE-STRATEGY.md` | **Reuse** as design appendix | Operator (G4) |
| `migrations/MANIFEST.md` | **Reuse** verbatim-link | Operator/Security |
| `docs/ADMIN_FIRST_RUN.md` | **Reuse**, expand | Admin (G3) first-week |
| `CLAUDE.md` | **Reference only**, never publish | Integrator (G5) source |
| OyonR doc set (9 files) | **Reuse selectively** | Security (G6) + Integrator |
| `docs/audits/*` | **Retire from site** (point-in-time) | keep in repo only |
| `landing/README.md` | **Out of scope** (marketing) | unchanged |
| Session artifacts (HANDOFF/LEARNINGS/CHANGES) | **Never publish** | local-only |

## A2 — Task-to-screen matrix (product surface → guide pages)

**Trainee (G1, M1)**

| Task | Screen / component | Page |
|---|---|---|
| Log in, pick & start a case | LoginPage, ConfigPanel Cases tab | getting-started |
| Navigate rooms | RoomNavigator, `currentRoom` | rooms |
| Take a history | ChatInterface, STT/TTS | history |
| Examine | BodyMap / ManikinPanel, findings | examination |
| Order labs/imaging | OrdersDrawer (Labs/Radiology) | investigations |
| Treat | OrdersDrawer (Meds/IV), contraindications | treatments |
| Read monitor / alarms | Vitals panel, NotificationCenter | vitals |
| Voice mode | avatar + voice toggle | voice |
| Debrief | Consultant room | debrief |

**Educator (G2, M1)**

| Task | Screen / component | Page |
|---|---|---|
| Create/manage class, join codes | CohortsManagementTab, cohorts-routes | cohorts |
| Assign cases | CohortPickers, `cohort_cases` | assigning-cases |
| Author a case | 12-step case wizard | case-wizard |
| Edit agents | Agent persona editor | agents |
| Scenario timeline | scenarioTemplates | scenarios |
| Read reports | CohortReports (4 views) | reporting |
| TNA analytics | TnaDashboard | tna |
| Oyon analytics | OyonLearningAnalyticsTab | oyon-analytics |
| Classroom policy | CohortSettings | classroom-policy |

(Admin/Operator/Integrator/Security task maps tracked with G3–G6 in M2/M3.)

## A3 — Reference manifest (generation scope, Stage 2)

- **R1 API**: 21 routers, ~260 endpoints. Largest: admin (46), analytics
  (45), orders (36), cohorts (26), agents (23). Auth model: 5 ranks,
  JWT/cookie, CSRF, `active_sessions` revocation. Error envelope +
  `redaction.js` policy must be documented inline.
- **R2 data**: ~65 tables; soft-delete (`deleted_at`), tenant (`tenant_id`),
  audit-chain columns; 27 migrations + MANIFEST classification.
- **R3 config**: env vars enumerated by recon (PORT, JWT_SECRET, ROHY_DB,
  OYON_ENABLED, ROHY_LOG_LEVEL, retention, rohy-update vars, …) +
  platform_settings.
- **R4 CLI**: `bin/rohy-update` (check/apply/rollback/list/restore, exit
  codes 0/10/1/2/3), `scripts/migrate.js`, `seed*.{js,cjs}`,
  `retention-sweep.js`, ~18 `audit-*.sh`, `tech-test.sh`.

---

## Ratified gap matrix

✅ exists & good · 🟡 partial/stale · ❌ missing · ⚠ wrong

| Topic | Trainee | Educator | Admin | Operator | Integrator | Sec/Comp |
|---|---|---|---|---|---|---|
| Getting started | ❌ | ❌ | 🟡 | ✅ | 🟡 | n/a |
| Core task walkthroughs | ❌ | ❌ | ❌ | ✅ | n/a | n/a |
| Feature reference | 🟡 | 🟡 | 🟡 | ✅ | 🟡 | n/a |
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

**Conclusion:** Operator/engineer well-served; the four end-user audiences
and all in-app help are greenfield. M1 (Trainee+Educator + their in-app
help) attacks the largest ❌ cluster first.
