-- Rohy add-on migration template for Oyon — consolidated production schema.
-- Equivalent to applying migrations 0011 + 0012 + 0014 + 0015 + 0016 + 0017
-- in one shot, for fresh hosts (skips the intermediate sample-rate retuning).
--
-- Additive only: do not modify existing Rohy tables.
-- No raw frames, images, video, pixels, or landmarks are stored.
-- See docs/ROHY_INTEGRATION.md for the full contract.

-- ────────────────────────────────────────────────────────────────────
-- oyon_settings — tenant-level configuration
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oyon_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,

  -- master kill switch + per-role view gates
  emotion_capture_enabled INTEGER NOT NULL DEFAULT 0,
  admin_emotion_view_enabled INTEGER NOT NULL DEFAULT 1,
  educator_emotion_view_enabled INTEGER NOT NULL DEFAULT 1,
  student_emotion_view_enabled INTEGER NOT NULL DEFAULT 1,

  -- runtime tuning (added in migration 0012; defaults updated in 0015)
  -- 500 ms is the production-stable sample interval; do not drop below
  -- without moving inference off the React main thread.
  model_profile TEXT NOT NULL DEFAULT 'hsemotion-enet-b0-8-va-mtl',
  sample_interval_ms INTEGER NOT NULL DEFAULT 500,
  window_ms INTEGER NOT NULL DEFAULT 8000,
  min_valid_frames INTEGER NOT NULL DEFAULT 4,
  smoothing_alpha REAL NOT NULL DEFAULT 0.6,
  min_hold_ms INTEGER NOT NULL DEFAULT 1500,
  min_switch_confidence REAL NOT NULL DEFAULT 0.55,

  -- governance
  retention_days INTEGER DEFAULT 365,
  consent_version TEXT NOT NULL DEFAULT 'fer-consent-v1',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

-- ────────────────────────────────────────────────────────────────────
-- oyon_emotion_consents — per-session consent audit
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oyon_emotion_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  student_id TEXT,
  session_id TEXT,
  case_id TEXT,
  consent_granted INTEGER NOT NULL,
  consent_version TEXT NOT NULL,
  source_page TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oyon_consents_tenant_user_time
  ON oyon_emotion_consents(tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_consents_tenant_session
  ON oyon_emotion_consents(tenant_id, session_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- oyon_emotion_records — aggregate windows (anonymizable)
--
-- user_id is nullable (migration 0014) to support GDPR Art. 17 erasure
-- by tombstoning identity while preserving aggregate signal.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oyon_emotion_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Rohy identity/context. Server-attached, never trusted from client.
  tenant_id TEXT NOT NULL,
  user_id TEXT,                   -- nullable for anonymization (0014)
  student_id TEXT,
  session_id TEXT NOT NULL,
  case_id TEXT,
  record_id TEXT,                 -- client-supplied or server-derived hash
  course_id TEXT,
  cohort_id TEXT,

  -- Historical context snapshots (server-attached at write time).
  student_name_snapshot TEXT,
  student_role_snapshot TEXT,
  case_title_snapshot TEXT,
  case_category_snapshot TEXT,
  course_title_snapshot TEXT,
  cohort_title_snapshot TEXT,
  session_type TEXT,
  attempt_number INTEGER,
  started_from_page TEXT,

  -- Capture window.
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  duration_ms INTEGER,            -- added in 0017
  expected_samples INTEGER,       -- added in 0017
  valid_frames INTEGER NOT NULL DEFAULT 0,
  missing_face_ratio REAL NOT NULL DEFAULT 0,

  -- Emotion values.
  dominant_emotion TEXT,
  emotion_probabilities_json TEXT,
  valence REAL,
  arousal REAL,
  confidence REAL,
  entropy REAL,

  -- Dispersion / stability (added in 0017). Lets the standalone
  -- dashboard render full analytics (TNA, distribution plots).
  valence_std REAL,    valence_min REAL,    valence_max REAL,
  arousal_std REAL,    arousal_min REAL,    arousal_max REAL,
  confidence_std REAL, confidence_min REAL, confidence_max REAL,
  entropy_std REAL,    entropy_min REAL,    entropy_max REAL,
  stability_score REAL,
  label_switch_count INTEGER,

  quality_json TEXT,

  -- Model + runtime provenance.
  model_name TEXT,
  model_version TEXT,
  settings_snapshot_json TEXT,    -- added in 0017
  dynamics_json TEXT,             -- added in 0017, optional

  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('local-browser')),
  capture_status TEXT NOT NULL DEFAULT 'captured',

  -- Consent + visibility (server-authoritative).
  student_consent_enabled INTEGER NOT NULL DEFAULT 0,
  student_can_view INTEGER NOT NULL DEFAULT 0,
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,
  consent_recorded_at DATETIME,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent batch deduplication (migration 0016).
-- Combine with `INSERT … ON CONFLICT DO NOTHING` in the route handler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oyon_records_unique_record
  ON oyon_emotion_records(tenant_id, session_id, record_id)
  WHERE record_id IS NOT NULL;

-- Common read paths.
CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_session_time
  ON oyon_emotion_records(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_user_time
  ON oyon_emotion_records(tenant_id, user_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_case_time
  ON oyon_emotion_records(tenant_id, case_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_course_time
  ON oyon_emotion_records(tenant_id, course_id, window_start DESC);

-- ────────────────────────────────────────────────────────────────────
-- 0.3.0 — optional engagement metrics column for eye tracking.
-- See docs/EYE_TRACKING.md. This is an EXAMPLE; production hosts
-- choose their own schema (column type, retention, indexing).
-- The dialect here is SQLite (`TEXT` holding JSON); Postgres hosts
-- typically use `JSONB`, MySQL hosts `JSON`.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE oyon_emotion_records ADD COLUMN engagement_metrics TEXT;
