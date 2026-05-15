-- 0025: teacher-owned cohorts (classes).
--
-- Goal: a teacher (educator-rank user) owns one or more "cohorts" and
-- students are members of them, so analytics / roster reads can be
-- scoped to "only this teacher's students" instead of every learner on
-- the platform. Phase 2 is the schema only — two new additive tables.
-- No endpoints, no UI; later phases wire those.
--
-- Strictly additive: two brand-new tables, nothing on existing tables is
-- altered, dropped, or narrowed. Pre-migration code keeps running because
-- it never touches these tables.
--
-- FKs are declared inline with REFERENCES but WITHOUT ON DELETE CASCADE,
-- matching repo convention (see 0003/0004): dependent cleanup is handled
-- at the application layer (soft-delete + retention sweep), not by the DB.

PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE IF NOT EXISTS cohorts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    tenant_id INTEGER NOT NULL DEFAULT 1,
    join_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- A join_code, when present, must be unique among live cohorts. Partial
-- so NULL codes don't collide and a soft-deleted cohort frees its code
-- for reuse (mirrors the partial-unique pattern in 0004_tenants.sql).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_join_code_live
    ON cohorts(join_code)
    WHERE join_code IS NOT NULL AND deleted_at IS NULL;

-- Scoped reads later: "all cohorts owned by this teacher" and the
-- tenant-isolation filter applied by requireSameTenant().
CREATE INDEX IF NOT EXISTS idx_cohorts_owner_user_id ON cohorts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cohorts_tenant_id ON cohorts(tenant_id);

CREATE TABLE IF NOT EXISTS cohort_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- A user is in a cohort at most once. Partial so excluding soft-deleted
-- rows lets a removed member be re-added later without a unique clash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_members_cohort_user_live
    ON cohort_members(cohort_id, user_id)
    WHERE deleted_at IS NULL;

-- Scoped reads later: "members of this cohort" and "cohorts this user
-- belongs to".
CREATE INDEX IF NOT EXISTS idx_cohort_members_cohort_id ON cohort_members(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members_user_id ON cohort_members(user_id);

COMMIT;

PRAGMA foreign_keys=ON;
