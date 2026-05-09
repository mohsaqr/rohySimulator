-- Oyon core persistence schema for SQLite hosts.
-- Stores aggregate facial-expression analytics and operational records.
-- Does not store raw frames, images, audio, video, landmarks, or biometric templates.

CREATE TABLE IF NOT EXISTS oyon_captures (
  capture_id TEXT PRIMARY KEY,
  host_app TEXT,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  status TEXT NOT NULL,
  consent_version TEXT,
  settings_snapshot TEXT NOT NULL,
  settings_hash TEXT,
  model_profile TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-capture-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oyon_emotion_windows (
  window_id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  duration_ms INTEGER NOT NULL,
  expected_samples INTEGER,
  valid_frames INTEGER NOT NULL,
  missing_face_ratio REAL NOT NULL,
  dominant_emotion TEXT,
  probabilities TEXT,
  valence REAL,
  valence_std REAL,
  valence_min REAL,
  valence_max REAL,
  arousal REAL,
  arousal_std REAL,
  arousal_min REAL,
  arousal_max REAL,
  confidence REAL,
  confidence_std REAL,
  entropy REAL,
  entropy_std REAL,
  stability_score REAL,
  label_switch_count INTEGER,
  quality TEXT,
  model_name TEXT,
  model_version TEXT,
  model_profile TEXT,
  runtime_backend TEXT,
  settings_hash TEXT,
  settings_snapshot TEXT,
  capture_mode TEXT NOT NULL DEFAULT 'local-browser',
  consent_version TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-window-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (capture_id) REFERENCES oyon_captures(capture_id)
);

CREATE TABLE IF NOT EXISTS oyon_runtime_events (
  event_id TEXT PRIMARY KEY,
  capture_id TEXT,
  timestamp DATETIME NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  event_name TEXT NOT NULL,
  context TEXT,
  details TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-log-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oyon_metrics (
  metric_id TEXT PRIMARY KEY,
  capture_id TEXT,
  timestamp DATETIME NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metric_unit TEXT,
  tags TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-metric-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oyon_settings_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT,
  settings_json TEXT NOT NULL,
  settings_hash TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-settings-v1',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oyon_consents (
  consent_id TEXT PRIMARY KEY,
  capture_id TEXT,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  timestamp DATETIME NOT NULL,
  action TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_text_hash TEXT,
  context TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-consent-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oyon_dynamics (
  dynamics_id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  tenant_id TEXT,
  user_id TEXT,
  session_id TEXT,
  case_id TEXT,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  valence_velocity REAL,
  arousal_velocity REAL,
  valence_acceleration REAL,
  arousal_acceleration REAL,
  affect_speed REAL,
  affect_volatility REAL,
  confidence_trend REAL,
  entropy_trend REAL,
  missingness_trend REAL,
  phase_quadrant TEXT,
  transition_from TEXT,
  transition_to TEXT,
  instability_score REAL,
  features_json TEXT,
  schema_version TEXT NOT NULL DEFAULT 'oyon-dynamics-v1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (capture_id) REFERENCES oyon_captures(capture_id),
  FOREIGN KEY (window_id) REFERENCES oyon_emotion_windows(window_id)
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
