-- 0026: backfill a "Base Class" cohort so existing activity is visible.
--
-- Before this, every session predates the cohort feature and belongs to
-- no class, so the teacher dashboard is empty out of the box. This seeds,
-- per tenant that has sessions, one cohort named "Base Class" owned by
-- that tenant's lowest-id admin (falling back to its lowest-id educator),
-- and enrolls every distinct user who has a live session in that tenant.
--
-- Strictly additive: only INSERTs into cohorts / cohort_members. No
-- schema change, nothing altered/dropped/narrowed. NOT EXISTS guards +
-- the partial-unique indexes from 0025 keep it safe if ever re-run.
--
-- A tenant with sessions but no admin/educator is skipped (cohorts
-- .owner_user_id is NOT NULL and must reference a real same-tenant
-- staff user) — those are throwaway RBAC test tenants with one session.

BEGIN;

INSERT INTO cohorts (name, owner_user_id, tenant_id)
SELECT 'Base Class',
       (SELECT u.id
          FROM users u
         WHERE u.tenant_id = t.tenant_id
           AND u.deleted_at IS NULL
           AND u.role IN ('admin', 'educator')
         ORDER BY (u.role = 'admin') DESC, u.id ASC
         LIMIT 1),
       t.tenant_id
  FROM (SELECT DISTINCT tenant_id
          FROM sessions
         WHERE deleted_at IS NULL) t
 WHERE EXISTS (SELECT 1
                 FROM users u
                WHERE u.tenant_id = t.tenant_id
                  AND u.deleted_at IS NULL
                  AND u.role IN ('admin', 'educator'))
   AND NOT EXISTS (SELECT 1
                     FROM cohorts c
                    WHERE c.tenant_id = t.tenant_id
                      AND c.name = 'Base Class'
                      AND c.deleted_at IS NULL);

INSERT INTO cohort_members (cohort_id, user_id)
SELECT c.id, s.user_id
  FROM cohorts c
  JOIN (SELECT DISTINCT tenant_id, user_id
          FROM sessions
         WHERE deleted_at IS NULL
           AND user_id IS NOT NULL) s
    ON s.tenant_id = c.tenant_id
 WHERE c.name = 'Base Class'
   AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1
                     FROM cohort_members m
                    WHERE m.cohort_id = c.id
                      AND m.user_id = s.user_id
                      AND m.deleted_at IS NULL);

COMMIT;
