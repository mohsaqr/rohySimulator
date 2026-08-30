-- 0052 — the last naive writers on the identity + session tables (RPS-1 §17).
--
-- 0050 normalised the log surface and 0051 the domain tables. Both fixed rows;
-- 0051 also fixed the writers it knew about. Three writers were missed, and
-- each of them re-armed the trap the moment the migration finished:
--
--   1. `sessions.start_time` — the INSERT in sessions-routes named no time
--      column, so `DEFAULT CURRENT_TIMESTAMP` wrote the legacy naive shape
--      into a column 0050 had already normalised. `PUT /sessions/:id/end`
--      then did `new Date(session.start_time)`, which V8 reads as LOCAL time
--      for that shape: on a UTC+3 host a 15-second session was persisted as
--      a duration of 3h00m15s. Every debrief, cohort report and time-on-task
--      figure computed from `sessions.duration` inherited the host's offset.
--
--   2. `users.created_at` — five INSERTs (auth-routes register, users-routes
--      create/batch/import, registration-routes approve) plus the first-boot
--      seeder all omitted the column. 0051 converted `last_login` and
--      `locked_until` on this same table but not `created_at`, so one table
--      ended up holding conforming and legacy shapes side by side.
--
--   3. `oyon_settings.updated_at` — written as a bare `CURRENT_TIMESTAMP` by
--      `PUT /addons/oyon/settings`, and returned to the admin UI as-is.
--
-- All three writers are fixed in this release; this migration brings the
-- stored rows in line so no column holds two shapes at once — the state 0050
-- records as strictly worse than uniformly legacy, because `ORDER BY` on a
-- TEXT column sorts ' ' (0x20) before 'T' (0x54) and every legacy row sorts
-- ahead of every ISO row regardless of the instants involved.
--
-- SAFETY. The two guards from 0050/0051 are on every statement:
--   * NOT GLOB '...Z'          — skip rows already conforming (idempotent).
--   * strftime(...) IS NOT NULL — skip anything sqlite cannot parse, so a
--     corrupt value is left exactly as it is rather than nulled out.
-- Purely a reformat: `strftime('%Y-%m-%dT%H:%M:%fZ', v)` returns the same
-- instant sqlite already read out of `v`, so no `julianday()`/`date()`
-- comparison anywhere changes result. The runner backs the database up
-- before applying anything.
--
-- NOT INCLUDED, deliberately:
--   * `users.updated_at` — around ten UPDATE statements across users-routes
--     still write it as a bare `CURRENT_TIMESTAMP`. Converting the stored
--     rows while the writers stay naive would MANUFACTURE the mixed-shape
--     column this migration exists to remove. It is converted in the release
--     that converts those writers, not before.
--   * `system_audit_log.timestamp` — inside the tamper-evident hash chain;
--     0050's generated `ts_utc` sort key still stands.
--   * `*.deleted_at` — only ever tested `IS NULL`, never rendered or sorted.
--   * `sessions.duration` — a DURATION in seconds, not an instant. Rows
--     written before this release carry the inflated value; they are left
--     untouched because the true end instant is unknowable after the fact
--     (`end_time - start_time` cannot be recovered once `start_time` was
--     misread at write time) and inventing a number would be worse than a
--     visibly wrong one. New sessions are correct from this release on.

-- ---------------------------------------------------------------------------
-- sessions. `start_time` is the one the duration bug was about; `updated_at`
-- shares the same naive default and its only writers are the INSERT fixed in
-- this release and 0050's reformat, so it cannot end up mixed.
-- ---------------------------------------------------------------------------
UPDATE sessions SET start_time = strftime('%Y-%m-%dT%H:%M:%fZ', start_time)
 WHERE start_time IS NOT NULL
   AND start_time NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', start_time) IS NOT NULL;

UPDATE sessions SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ', end_time)
 WHERE end_time IS NOT NULL
   AND end_time NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', end_time) IS NOT NULL;

UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE updated_at IS NOT NULL
   AND updated_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- users.created_at. Rendered in the Users tab and the student profile, and
-- sorted by the admin list — the same three things that made `last_login`
-- read three hours stale before 0051.
-- ---------------------------------------------------------------------------
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE created_at IS NOT NULL
   AND created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- oyon_settings. Both columns; the only writers are the lazy-materialising
-- INSERT in server/lib/oyonSettings.js and PUT /addons/oyon/settings, both
-- converted in this release.
-- ---------------------------------------------------------------------------
UPDATE oyon_settings SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE created_at IS NOT NULL
   AND created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL;

UPDATE oyon_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE updated_at IS NOT NULL
   AND updated_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL;
