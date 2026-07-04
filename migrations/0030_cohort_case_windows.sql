-- 0030: per-assignment date windows + enrollment lifecycle for enforced,
-- date-scoped, class-centric case access.
--
-- Adds nullable date-window columns to cohort_cases (open when NULL) and an
-- enrollment lifecycle to cohort_members. `status` DEFAULT 'active' classifies
-- every existing membership row as a live enrolment with no data step; the
-- enrolled_from/until windows are nullable = open.
--
-- Strictly additive: every add is nullable or defaulted, nothing dropped,
-- renamed, or narrowed. Pre-migration code never selects these columns, and
-- the access enforcement that reads them is gated behind the platform flag
-- `enforce_cohort_case_access` (default OFF) — so APPLYING this migration
-- changes no behaviour until an admin opts in.
--
-- The app constrains cohort_members.status to 'active' | 'completed' |
-- 'dropped' (SQLite can't ALTER-add a CHECK to an existing column), mirroring
-- the member_role convention from 0027.
--
-- FKs already exist on these tables (0025/0027); no new table, so no new FK.

PRAGMA foreign_keys=OFF;

BEGIN;

-- Per-case availability window inside a cohort. NULL on a side = open on that
-- side; both NULL (every existing / backfilled row) = always available, which
-- preserves today's behaviour.
ALTER TABLE cohort_cases ADD COLUMN available_from DATETIME;
ALTER TABLE cohort_cases ADD COLUMN available_until DATETIME;

-- Enrollment lifecycle. DEFAULT 'active' classifies every existing
-- cohort_members row (incl. the ~10 Base Class rows from 0026) as a live,
-- enrolled student with no data step. enrolled_from/until nullable = open.
ALTER TABLE cohort_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE cohort_members ADD COLUMN enrolled_from DATETIME;
ALTER TABLE cohort_members ADD COLUMN enrolled_until DATETIME;

-- Enforcement JOIN support: "live, active memberships for this user".
CREATE INDEX IF NOT EXISTS idx_cohort_members_user_status
    ON cohort_members(user_id, status)
    WHERE deleted_at IS NULL;

-- Enforcement JOIN support: "live assignments for this case" (0027 already has
-- cohort_id/case_id lookup indexes; this adds the case-anchored live lookup
-- used by GET /cases/:id and the POST /sessions launch gate).
CREATE INDEX IF NOT EXISTS idx_cohort_cases_case_live
    ON cohort_cases(case_id, cohort_id)
    WHERE deleted_at IS NULL;

COMMIT;

PRAGMA foreign_keys=ON;
