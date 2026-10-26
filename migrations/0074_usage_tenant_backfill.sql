-- 0074: llm_usage and tts_usage rows carry the tenant of the user who spent.
--
-- Security audit 2026-10-26 (F-18 / L3-08). Migration 0004 added `tenant_id`
-- to both tables with DEFAULT 1, and the proxy's INSERTs never set it, so
-- every row of every tenant landed in tenant 1: tenant 1's administrators saw
-- other tenants' usernames and spend in GET /llm/usage/all, every other
-- tenant's administrators saw nothing, and a per-tenant limit could not be
-- enforced. The INSERTs now stamp the tenant (server/routes/proxy-routes.js);
-- this backfills the rows already written from users.tenant_id.
--
-- Only rows whose user still exists and belongs to another tenant change. A
-- single-tenant install (every user in tenant 1) is untouched: the WHERE
-- matches nothing. Re-running is a no-op. No schema change.

UPDATE llm_usage
   SET tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = llm_usage.user_id)
 WHERE EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = llm_usage.user_id
           AND u.tenant_id IS NOT NULL
           AND u.tenant_id != llm_usage.tenant_id
 );

UPDATE tts_usage
   SET tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = tts_usage.user_id)
 WHERE EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = tts_usage.user_id
           AND u.tenant_id IS NOT NULL
           AND u.tenant_id != tts_usage.tenant_id
 );
