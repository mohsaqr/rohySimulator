-- Rohy add-on migration template for Oyon.
-- Additive only: do not modify existing Rohy tables.
-- No raw frames, images, video, pixels, or landmarks are stored.

CREATE TABLE IF NOT EXISTS oyon_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  emotion_capture_enabled INTEGER NOT NULL DEFAULT 0,
  admin_emotion_view_enabled INTEGER NOT NULL DEFAULT 0,
  educator_emotion_view_enabled INTEGER NOT NULL DEFAULT 0,
  student_emotion_view_enabled INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER,
  consent_version TEXT NOT NULL DEFAULT 'oyon-consent-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

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

CREATE TABLE IF NOT EXISTS oyon_emotion_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Rohy identity/context. These values are attached server-side.
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  student_id TEXT,
  session_id TEXT NOT NULL,
  case_id TEXT,
  record_id TEXT,
  course_id TEXT,
  cohort_id TEXT,

  -- Historical context snapshots for later review/export.
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
  dominant_emotion TEXT,
  emotion_probabilities_json TEXT,
  valence REAL,
  arousal REAL,
  confidence REAL,
  entropy REAL,
  valid_frames INTEGER NOT NULL DEFAULT 0,
  missing_face_ratio REAL NOT NULL DEFAULT 0,
  quality_json TEXT,

  -- Model/runtime metadata.
  model_name TEXT,
  model_version TEXT,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('local-browser')),
  capture_status TEXT NOT NULL DEFAULT 'captured',

  -- Consent and visibility.
  student_consent_enabled INTEGER NOT NULL DEFAULT 0,
  student_can_view INTEGER NOT NULL DEFAULT 0,
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,
  consent_recorded_at DATETIME,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_session_time
  ON oyon_emotion_records(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_user_time
  ON oyon_emotion_records(tenant_id, user_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_case_time
  ON oyon_emotion_records(tenant_id, case_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_course_time
  ON oyon_emotion_records(tenant_id, course_id, window_start DESC);
