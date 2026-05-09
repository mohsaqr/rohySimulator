-- Oyon core persistence schema for PostgreSQL hosts.
-- Stores aggregate facial-expression analytics and operational records.
-- Does not store raw frames, images, audio, video, landmarks, or biometric templates.

CREATE TABLE IF NOT EXISTS oyon_captures (
  capture_id TEXT PRIMARY KEY,
  host_app TEXT,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  consent_version TEXT,
  settings_snapshot JSONB NOT NULL,
  settings_hash TEXT,
  model_profile TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-capture-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_emotion_windows (
  window_id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES oyon_captures(capture_id),
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,
  expected_samples INTEGER,
  valid_frames INTEGER NOT NULL,
  missing_face_ratio DOUBLE PRECISION NOT NULL,
  dominant_emotion TEXT,
  probabilities JSONB,
  valence DOUBLE PRECISION,
  valence_std DOUBLE PRECISION,
  valence_min DOUBLE PRECISION,
  valence_max DOUBLE PRECISION,
  arousal DOUBLE PRECISION,
  arousal_std DOUBLE PRECISION,
  arousal_min DOUBLE PRECISION,
  arousal_max DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  confidence_std DOUBLE PRECISION,
  entropy DOUBLE PRECISION,
  entropy_std DOUBLE PRECISION,
  stability_score DOUBLE PRECISION,
  label_switch_count INTEGER,
  quality JSONB,
  model_name TEXT,
  model_version TEXT,
  model_profile TEXT,
  runtime_backend TEXT,
  settings_hash TEXT,
  settings_snapshot JSONB,
  capture_mode TEXT NOT NULL DEFAULT 'local-browser',
  consent_version TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-window-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_runtime_events (
  event_id TEXT PRIMARY KEY,
  capture_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  event_name TEXT NOT NULL,
  context JSONB,
  details JSONB,
  schema_version TEXT NOT NULL DEFAULT 'oyon-log-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_metrics (
  metric_id TEXT PRIMARY KEY,
  capture_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  metric_unit TEXT,
  tags JSONB,
  schema_version TEXT NOT NULL DEFAULT 'oyon-metric-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_settings_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT,
  settings_json JSONB NOT NULL,
  settings_hash TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-settings-v1',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_consents (
  consent_id TEXT PRIMARY KEY,
  capture_id TEXT,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_text_hash TEXT,
  context JSONB,
  schema_version TEXT NOT NULL DEFAULT 'oyon-consent-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oyon_dynamics (
  dynamics_id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES oyon_captures(capture_id),
  window_id TEXT NOT NULL REFERENCES oyon_emotion_windows(window_id),
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  valence_velocity DOUBLE PRECISION,
  arousal_velocity DOUBLE PRECISION,
  valence_acceleration DOUBLE PRECISION,
  arousal_acceleration DOUBLE PRECISION,
  affect_speed DOUBLE PRECISION,
  affect_volatility DOUBLE PRECISION,
  confidence_trend DOUBLE PRECISION,
  entropy_trend DOUBLE PRECISION,
  missingness_trend DOUBLE PRECISION,
  phase_quadrant TEXT,
  transition_from TEXT,
  transition_to TEXT,
  instability_score DOUBLE PRECISION,
  features_json JSONB,
  schema_version TEXT NOT NULL DEFAULT 'oyon-dynamics-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oyon_windows_capture_start
  ON oyon_emotion_windows(capture_id, window_start);
CREATE INDEX IF NOT EXISTS idx_oyon_windows_session_start
  ON oyon_emotion_windows(tenant_id, session_id, window_start);
CREATE INDEX IF NOT EXISTS idx_oyon_events_capture_time
  ON oyon_runtime_events(capture_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_oyon_metrics_capture_time
  ON oyon_metrics(capture_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_oyon_dynamics_capture_start
  ON oyon_dynamics(capture_id, window_start);
