# Enterprise DB audit roadmap (Codex-led)

This is the executive view of the enterprise-grade audit. Codex executes
each stage; the orchestrator (Claude in this repo) defines mission, validates
the diff, runs the audit script, and commits.

The 9 staged audits in `HANDOFF.md` covered wiring correctness (snapshot
binding, IDOR, idempotency, partial guards). This roadmap is the next layer:
**enterprise-grade access control + schema structure**, plus the architectural
deferrals that earlier audits surfaced.

## Sequencing rule

- One stage = one Codex run = one commit.
- Each stage carries a mission statement + acceptance criteria + allow/deny list.
- Codex returns a diff; orchestrator validates, runs the relevant audit script,
  then commits with a message that names the deferred items.
- FP triage by orchestrator (pattern matures across stages, prior audits ran
  30 → 18 → 11 → 0 → 0 → 0 → 8 → 0 → 0%).

| # | Stage | Severity | Estimated effort | Why |
|---|---|---|---|---|
| E1 | **Schema integrity sweep** | HIGH | 90–120 min | FK consistency, ON DELETE CASCADE coverage, orphan-row detection, missing indexes on hot query paths. Stage 2 added cascades for case_investigations; sweep the rest of the schema systematically. |
| E2 | **Migration framework** | HIGH | 120–180 min | Replace ad-hoc `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN` pattern with a real migration tool (Knex, Drizzle, or hand-rolled with version tracking). Pre-fix: rolling back a column requires manual schema surgery. |
| E3 | **RBAC beyond admin/student** | HIGH | 90–120 min | Currently `users.role` is a binary CHECK constraint (`admin` / `student`). Enterprise asks for role hierarchies (admin → educator → reviewer → student → guest) and per-resource permissions. `req.user.role === 'admin'` checks are scattered; centralize. |
| E4 | **Audit-log coverage** | MED | 60–90 min | `logAudit()` exists but is called inconsistently. Stage 7 added it for password/role; sweep every sensitive mutation (case edit, agent template edit, scenario delete, alarm threshold change, lab/treatment master edits). Centralize via middleware. |
| E5 | **Data classification + redaction policy** | MED | 60–90 min | Stage 4 + Stage 7 redacted `apiKey` in two places. Generalize: tag every column carrying secrets/PII (apiKey, password_hash, email, phone, alternative_email, address, etc.); enforce redaction at the response middleware level so new endpoints inherit the policy. |
| E6 | **Multi-tenant readiness** | MED | 90–120 min | Add `tenant_id` (or `organization_id`) column to user-owned tables; default to a "default" tenant; wire scoping to all per-user queries. Educational platform's nominal scope is single-tenant, but this is the structural prerequisite for enterprise deployment. |
| E7 | **Soft delete + retention policy** | MED | 60–90 min | `cases.deleted_at` exists for soft delete; sweep other user-scoped tables. Retention rules: how long do `event_log`, `learning_events`, `interactions` rows live? GDPR's right-to-erasure means a per-user purge must work. |
| E8 | **Connection pooling + portability** | LOW | 60–90 min | Currently `better-sqlite3` (or `sqlite3`?) on a single file. Enterprise asks for Postgres compatibility; the SQL is *mostly* portable but `INSERT OR REPLACE`, `datetime('now')`, and JSON shorthand will break. Inventory + flag, don't migrate. |
| E9 | **Observability hooks** | LOW | 30–60 min | Slow-query log, error tracking, request-id propagation, structured logs. Currently `console.log` is the entire observability stack. |

## Out of scope

- Actual Postgres migration (Stage E8 inventories; doesn't migrate).
- Encryption at rest / column-level encryption (separate stage if needed later).
- API gateway / rate-limit per-tenant (the existing `express-rate-limit` is
  enough for educational deployment).
- Federation / SSO (separate identity-provider audit if needed).

## Mission template per stage

Each Codex hand-off uses this template. Orchestrator fills in the stage-specific
fields before invoking `codex:rescue`.

```
MISSION: <one-line goal>

CONTEXT:
- Repo at <abs path>, branch main.
- Read HANDOFF.md, LEARNINGS.md, and ENTERPRISE_AUDIT.md (this file)
  before starting. They contain recurring patterns + prior fixes.
- Current state: <summary of relevant existing surface>

DELIVERABLES:
- Schema diff (server/db.js) and route changes (server/routes.js) +
  any new migration files.
- New audit script `scripts/audit-<stage>.sh` that proves the fix
  end-to-end. Bash 3.2 compat (macOS default).
- Update CHANGES.md with a top entry, replace HANDOFF section,
  append LEARNINGS.

ACCEPTANCE:
- All 8 prior audit scripts still pass (the `audit-*.sh` files in scripts/).
- The new audit script passes 100%.
- Build passes (`npx vite build`).
- Browser smoke on :5173 mounts cleanly (no React error boundary).

CONSTRAINTS:
- main branch only (no feature branches).
- No emoji in code or commit messages.
- Don't run git commands; orchestrator commits.
- Don't restart the server; orchestrator manages it.
- If a finding is architectural and >2h, defer with rationale.
- Attribution rule: NEVER add Co-Authored-By Claude in commit messages
  (per global CLAUDE.md).
```

## Status

- E1: shipped 2026-05-05
- E2: shipped 2026-05-05
- E3: shipped 2026-05-05
- E4: shipped 2026-05-05
- E5: shipped 2026-05-05 (central response redaction policy,
  including key-aware `platform_settings.setting_value` redaction)
- E6: shipped 2026-05-05 (default tenant, tenant_id structural columns,
  tenant-aware auth context, high-risk route scoping, tenant audit script)
- E7-E9: pending

Updated: 2026-05-05.
