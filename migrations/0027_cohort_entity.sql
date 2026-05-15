-- 0027: flesh out the cohort entity (class metadata + roster roles + cases).
--
-- 0025 created the bare cohorts / cohort_members skeleton. This adds the
-- fields the teacher UI needs to actually describe and run a class:
--   * cohorts.description / starts_at / ends_at / settings — class
--     metadata; all nullable so existing "Base Class" backfill rows stay
--     valid (null = no description / open-ended / default settings).
--   * cohort_members.member_role — distinguishes a co-teacher from a
--     student in the roster. DEFAULT 'student' so every one of the ~10
--     rows seeded by the 0026 Base Class backfill is correctly classified
--     as a student without a data migration. SQLite cannot add a CHECK
--     constraint via ALTER, so the allowed set ('student' | 'teacher') is
--     enforced at the application layer; the partial index below supports
--     the "is the caller a teacher-member of this cohort?" lookup.
--   * cohort_cases — which cases are assigned to a cohort.
--
-- Strictly additive: every cohorts/cohort_members change is an ADD COLUMN
-- that is either nullable or carries a DEFAULT (member_role), and
-- cohort_cases is a brand-new table. Nothing is dropped, renamed, or
-- narrowed. Pre-migration code keeps running unchanged because it never
-- selects these new columns and never touches the new table; the
-- member_role DEFAULT only fills a column that no prior code reads.
--
-- FKs are declared inline with REFERENCES but WITHOUT ON DELETE CASCADE,
-- matching repo convention (see 0025/0004): dependent cleanup is handled
-- at the application layer (soft-delete + retention sweep), not the DB.

PRAGMA foreign_keys=OFF;

BEGIN;

-- Class metadata. All nullable: a Base Class backfill row legitimately
-- has no description, no fixed window, and default (NULL) settings.
ALTER TABLE cohorts ADD COLUMN description TEXT;
ALTER TABLE cohorts ADD COLUMN starts_at DATETIME;
ALTER TABLE cohorts ADD COLUMN ends_at DATETIME;
-- JSON blob the app reads/writes as JSON. SQLite has no native JSON type;
-- the schema-wide convention is the `JSON` affinity keyword (see
-- 0001_initial.sql: monitor_settings JSON, context JSON, ...). Match it.
ALTER TABLE cohorts ADD COLUMN settings JSON;

-- Roster role. DEFAULT 'student' so every existing cohort_members row
-- (the ~10 Base Class enrolments from 0026) is classified as a student
-- with no data step. App constrains the value to 'student' | 'teacher'
-- (a CHECK can't be added to an existing column via SQLite ALTER).
ALTER TABLE cohort_members ADD COLUMN member_role TEXT NOT NULL DEFAULT 'student';

-- Supports the "is this user a teacher-member of this cohort?" lookup.
-- Partial (live rows only), mirroring the 0025 partial-index style so a
-- soft-deleted membership doesn't keep matching.
CREATE INDEX IF NOT EXISTS idx_cohort_members_role
    ON cohort_members(cohort_id, user_id, member_role)
    WHERE deleted_at IS NULL;

-- Cases assigned to a cohort. Mirrors the 0025 table conventions:
-- autoincrement PK, inline REFERENCES without cascade, created_at /
-- deleted_at for soft-delete.
CREATE TABLE IF NOT EXISTS cohort_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
    case_id INTEGER NOT NULL REFERENCES cases(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- A case is assigned to a cohort at most once. Partial so excluding
-- soft-deleted rows lets a removed case be re-assigned without a clash
-- (same pattern as idx_cohort_members_cohort_user_live in 0025).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_cases_cohort_case_live
    ON cohort_cases(cohort_id, case_id)
    WHERE deleted_at IS NULL;

-- Scoped reads later: "cases assigned to this cohort" and "cohorts this
-- case is assigned to".
CREATE INDEX IF NOT EXISTS idx_cohort_cases_cohort_id ON cohort_cases(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_cases_case_id ON cohort_cases(case_id);

COMMIT;

PRAGMA foreign_keys=ON;
