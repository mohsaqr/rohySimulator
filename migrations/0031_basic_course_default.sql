-- 0031: seed a per-tenant "Basic course" default class holding the tenant
-- default case, and enrol every existing user into it.
--
-- This is the safety net for enforced, class-centric case access (0030 + the
-- `enforce_cohort_case_access` flag). With enforcement ON a student sees only
-- cases assigned to a class they're a live member of — so everyone must belong
-- to a class that carries at least the default case. "Basic course" is that
-- class: every user is a member and the tenant's default case
-- (cases.is_default=1) is assigned to it with open windows, so anyone who logs
-- in always has that one case and can never be locked out.
--
-- Strictly additive: only INSERTs into cohorts / cohort_cases /
-- cohort_members. No schema change. NOT EXISTS guards + the 0025/0027
-- partial-unique indexes make it safe to re-run. A tenant with no
-- admin/educator is skipped (cohorts.owner_user_id is NOT NULL and must point
-- at a real same-tenant staff user). Users created AFTER this migration are
-- enrolled by ensureBasicCourseMembership() on register/login (auth-routes.js).

BEGIN;

-- One "Basic course" cohort per tenant that has a staff user to own it.
-- Tenants are derived from live users (robust against orphan tenant ids),
-- mirroring the 0026 Base Class backfill pattern.
INSERT INTO cohorts (name, owner_user_id, tenant_id, description)
SELECT 'Basic course',
       (SELECT u.id
          FROM users u
         WHERE u.tenant_id = t.tenant_id
           AND u.deleted_at IS NULL
           AND u.role IN ('admin', 'educator')
         ORDER BY (u.role = 'admin') DESC, u.id ASC
         LIMIT 1),
       t.tenant_id,
       'Default class — every user is enrolled and receives the default case.'
  FROM (SELECT DISTINCT tenant_id FROM users WHERE deleted_at IS NULL) t
 WHERE EXISTS (SELECT 1
                 FROM users u
                WHERE u.tenant_id = t.tenant_id
                  AND u.deleted_at IS NULL
                  AND u.role IN ('admin', 'educator'))
   AND NOT EXISTS (SELECT 1
                     FROM cohorts c
                    WHERE c.tenant_id = t.tenant_id
                      AND c.name = 'Basic course'
                      AND c.deleted_at IS NULL);

-- Assign each tenant's default case to its Basic course, with open windows.
-- Skipped for a tenant with no default case (nothing to fall back to yet).
INSERT INTO cohort_cases (cohort_id, case_id)
SELECT c.id, ca.id
  FROM cohorts c
  JOIN cases ca
    ON ca.tenant_id = c.tenant_id
   AND ca.is_default = 1
   AND ca.deleted_at IS NULL
 WHERE c.name = 'Basic course'
   AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1
                     FROM cohort_cases cc
                    WHERE cc.cohort_id = c.id
                      AND cc.case_id = ca.id
                      AND cc.deleted_at IS NULL);

-- Enrol every non-deleted user of the tenant into its Basic course.
INSERT INTO cohort_members (cohort_id, user_id)
SELECT c.id, u.id
  FROM cohorts c
  JOIN users u
    ON u.tenant_id = c.tenant_id
   AND u.deleted_at IS NULL
 WHERE c.name = 'Basic course'
   AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1
                     FROM cohort_members m
                    WHERE m.cohort_id = c.id
                      AND m.user_id = u.id
                      AND m.deleted_at IS NULL);

COMMIT;
