-- Oyon: lower min_valid_frames default from 6 → 3 for existing tenants.
-- Why: with default 1Hz sampling on a 10s window we get ~10 samples per
-- window. Requiring 6/10 valid frames meant a single blink + a brief
-- off-camera glance dropped the entire window to dominant_emotion=null,
-- which then disappears from analytics (server filters WHERE
-- dominant_emotion IS NOT NULL on the roll-up endpoint). 3/10 stays
-- robust against transient occlusion while still rejecting noise-only
-- windows.
--
-- Idempotent: only touches rows still on the legacy 6 so any admin who
-- intentionally tuned it is left alone.

UPDATE oyon_settings
SET min_valid_frames = 3,
    updated_at = CURRENT_TIMESTAMP
WHERE min_valid_frames = 6;
