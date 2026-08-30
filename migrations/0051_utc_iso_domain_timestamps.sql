-- 0051 — finish the UTC ISO-8601 contract on the DOMAIN tables.
--
-- Migration 0050 normalised the LOG tables and, for the order tables, the rows
-- that existed at the time. It did not fix the WRITERS for those tables, and it
-- never touched `users.last_login` at all. Two consequences, both live:
--
--   1. `users.last_login` stayed in sqlite's legacy "YYYY-MM-DD HH:MM:SS"
--      shape. It has no timezone marker but IS UTC, and V8 reads that shape as
--      LOCAL — so the Users tab's "Last Active" was stale by exactly the
--      viewer's UTC offset. Reported from the field as "3 hours behind".
--
--   2. `investigation_orders` and `treatment_orders` were migrated by 0050 and
--      then written to again with `datetime('now')`, so a single column now
--      holds BOTH shapes. That is worse than uniformly legacy: `ORDER BY`
--      sorts them as strings (' ' = 0x20 sorts before 'T' = 0x54, so every
--      legacy row sorts before every ISO row regardless of when it happened),
--      and the client's `available_at + 'Z'` produced '...ZZ' — an Invalid Date
--      — for every row 0050 had already normalised.
--
-- The writers are fixed in the same release (server/shared/time.js sqlNowPlus,
-- and every INSERT/UPDATE in auth-routes and orders-routes now names its time
-- column). This migration brings the stored rows in line.
--
-- SAFETY. Both guards from 0050 are kept on every statement:
--   * NOT GLOB '...Z'  — skip rows already in the contract, so this is
--     idempotent and re-running it is free.
--   * strftime(...) IS NOT NULL — skip anything sqlite cannot parse, so a
--     corrupt row is left exactly as it is rather than being nulled out.
-- No instant changes meaning: sqlite's date functions read both shapes as the
-- same UTC instant, so julianday() over any of these columns is identical
-- before and after.
--
-- NOT INCLUDED, deliberately:
--   * `system_audit_log.timestamp` — inside the tamper-evident hash chain; 0050
--     gave it a generated `ts_utc` sort key instead, and that still stands.
--   * `*.deleted_at` on soft-delete tables — only ever tested `IS NULL`, never
--     rendered, never sorted. Converting them would be churn without a reader.
--   * durations (`time_elapsed`, `response_time_ms`, `duration_ms`) — not
--     instants.

-- ---------------------------------------------------------------------------
-- users. `last_login` is the one the field report was about; `locked_until` is
-- a deadline the login path compares, and is converted so the column cannot
-- end up holding both shapes the way the order tables did.
-- ---------------------------------------------------------------------------
UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ', last_login)
 WHERE last_login IS NOT NULL
   AND last_login NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', last_login) IS NOT NULL;

UPDATE users SET locked_until = strftime('%Y-%m-%dT%H:%M:%fZ', locked_until)
 WHERE locked_until IS NOT NULL
   AND locked_until NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', locked_until) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Order tables. 0050 converted the rows that existed then; these are the ones
-- written since by the legacy writers now fixed. Same statements, re-run.
-- ---------------------------------------------------------------------------
UPDATE investigation_orders SET ordered_at = strftime('%Y-%m-%dT%H:%M:%fZ', ordered_at)
 WHERE ordered_at IS NOT NULL
   AND ordered_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', ordered_at) IS NOT NULL;

UPDATE investigation_orders SET available_at = strftime('%Y-%m-%dT%H:%M:%fZ', available_at)
 WHERE available_at IS NOT NULL
   AND available_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', available_at) IS NOT NULL;

UPDATE investigation_orders SET viewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', viewed_at)
 WHERE viewed_at IS NOT NULL
   AND viewed_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', viewed_at) IS NOT NULL;

UPDATE treatment_orders SET ordered_at = strftime('%Y-%m-%dT%H:%M:%fZ', ordered_at)
 WHERE ordered_at IS NOT NULL
   AND ordered_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', ordered_at) IS NOT NULL;

UPDATE treatment_orders SET administered_at = strftime('%Y-%m-%dT%H:%M:%fZ', administered_at)
 WHERE administered_at IS NOT NULL
   AND administered_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', administered_at) IS NOT NULL;

UPDATE treatment_orders SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', completed_at)
 WHERE completed_at IS NOT NULL
   AND completed_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) IS NOT NULL;

UPDATE treatment_orders SET discontinued_at = strftime('%Y-%m-%dT%H:%M:%fZ', discontinued_at)
 WHERE discontinued_at IS NOT NULL
   AND discontinued_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', discontinued_at) IS NOT NULL;
