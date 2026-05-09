-- Oyon: tenant-level runtime configuration.
-- Adds the model + capture knobs to oyon_settings so admins can pick the
-- emotion model and aggregation window once, and have it apply everywhere
-- (the Rohy miniature, the standalone analytics dashboard when launched
-- from Rohy, future surfaces). Single source of truth.
-- Additive only: defaults match the values previously hard-coded in the
-- frontends so behaviour is unchanged for tenants that don't touch this.

ALTER TABLE oyon_settings ADD COLUMN model_profile TEXT NOT NULL DEFAULT 'hse-emotion-mtl';
ALTER TABLE oyon_settings ADD COLUMN sample_interval_ms INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE oyon_settings ADD COLUMN window_ms INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE oyon_settings ADD COLUMN min_valid_frames INTEGER NOT NULL DEFAULT 6;
ALTER TABLE oyon_settings ADD COLUMN smoothing_alpha REAL NOT NULL DEFAULT 0.28;
ALTER TABLE oyon_settings ADD COLUMN min_hold_ms INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE oyon_settings ADD COLUMN min_switch_confidence REAL NOT NULL DEFAULT 0.5;
