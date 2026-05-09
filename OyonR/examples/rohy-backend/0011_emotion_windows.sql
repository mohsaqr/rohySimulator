-- Attach-ready migration template for aggregated FER telemetry.
-- Copy into Rohy's migrations folder only after ethics/legal approval.
-- No raw frames, images, landmarks, or video are stored.

CREATE TABLE IF NOT EXISTS emotion_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  case_id TEXT,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  dominant_emotion TEXT,
  probabilities TEXT,
  valence REAL,
  arousal REAL,
  confidence REAL,
  entropy REAL,
  valid_frames INTEGER NOT NULL DEFAULT 0,
  missing_face_ratio REAL NOT NULL DEFAULT 0,
  quality TEXT,
  model_name TEXT,
  model_version TEXT,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('local-browser')),
  consent_version TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emotion_windows_tenant_session
  ON emotion_windows(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_emotion_windows_tenant_user_time
  ON emotion_windows(tenant_id, user_id, window_start DESC);
