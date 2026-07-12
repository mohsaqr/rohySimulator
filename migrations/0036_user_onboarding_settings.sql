-- 0036: per-user onboarding/first-run preferences.
--
-- One nullable JSON column on user_preferences, following the table's
-- domain-scoped JSON-column idiom (notification_settings, accessibility_settings, …).
-- Shape (all keys optional, merged client-side):
--   { "first_run_done": 1,          -- first-run screen completed (version number)
--     "voice_mode": true,           -- student wants voice mode on by default
--     "oyon_consent": true }        -- emotion-capture consent default (moves the
--                                   -- old per-browser localStorage flag server-side)
-- NULL = user has never seen the first-run screen (pre-migration users are
-- deliberately treated as NOT onboarded — the screen shows once for everyone).
-- Strictly additive: nullable ADD COLUMN only; pre-migration code never
-- selects the column.

ALTER TABLE user_preferences ADD COLUMN onboarding_settings JSON;
