-- 0033: opt-in auto-enrollment flag on cohorts.
--
-- `auto_enroll = 1` marks a cohort every tenant user should be enrolled in
-- automatically on register/login (ensureAutoEnrollMemberships in
-- server/routes/_helpers.js). Before this flag the login hook was hardcoded
-- to the "Basic course" name; the per-case dedicated courses (seeded by
-- server/seedStemiCourse.js) need the same treatment, so the rule becomes
-- data instead of a name match.
--
-- Strictly additive: one defaulted ADD COLUMN (existing rows get 0 = no
-- auto-enrollment, i.e. exactly the pre-migration behaviour for teacher-made
-- cohorts), plus a data step flagging the existing "Basic course" rows so
-- the login hook keeps enrolling into them.

BEGIN;

ALTER TABLE cohorts ADD COLUMN auto_enroll INTEGER NOT NULL DEFAULT 0;

UPDATE cohorts SET auto_enroll = 1 WHERE name = 'Basic course';

COMMIT;
