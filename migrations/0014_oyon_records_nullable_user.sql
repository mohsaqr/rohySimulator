-- Oyon: allow `oyon_emotion_records.user_id` to be NULL.
-- Why: user-purge anonymises records (rows kept for aggregate analytics value)
-- by setting user_id = NULL, mirroring how the existing executeUserPurge
-- handles sessions.user_id, event_log.user_id, etc. The original 0011 schema
-- declared user_id TEXT NOT NULL, which blocked anonymisation. SQLite cannot
-- ALTER COLUMN to drop NOT NULL, so we rebuild the table.
--
-- All other columns and CHECK constraints are preserved. Indexes are
-- recreated explicitly because SQLite drops them when the underlying
-- table is dropped.

CREATE TABLE oyon_emotion_records_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  tenant_id TEXT NOT NULL,
  user_id TEXT,
  student_id TEXT,
  session_id TEXT NOT NULL,
  case_id TEXT,
  record_id TEXT,
  course_id TEXT,
  cohort_id TEXT,

  student_name_snapshot TEXT,
  student_role_snapshot TEXT,
  case_title_snapshot TEXT,
  case_category_snapshot TEXT,
  course_title_snapshot TEXT,
  cohort_title_snapshot TEXT,
  session_type TEXT,
  attempt_number INTEGER,
  started_from_page TEXT,

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

  model_name TEXT,
  model_version TEXT,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('local-browser')),
  capture_status TEXT NOT NULL DEFAULT 'captured',

  student_consent_enabled INTEGER NOT NULL DEFAULT 0,
  student_can_view INTEGER NOT NULL DEFAULT 0,
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,
  consent_recorded_at DATETIME,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO oyon_emotion_records_new (
  id, tenant_id, user_id, student_id, session_id, case_id, record_id,
  course_id, cohort_id,
  student_name_snapshot, student_role_snapshot,
  case_title_snapshot, case_category_snapshot,
  course_title_snapshot, cohort_title_snapshot,
  session_type, attempt_number, started_from_page,
  window_start, window_end, dominant_emotion, emotion_probabilities_json,
  valence, arousal, confidence, entropy, valid_frames, missing_face_ratio,
  quality_json, model_name, model_version, capture_mode, capture_status,
  student_consent_enabled, student_can_view, admin_can_view, educator_can_view,
  consent_version, consent_recorded_at, created_at
)
SELECT
  id, tenant_id, user_id, student_id, session_id, case_id, record_id,
  course_id, cohort_id,
  student_name_snapshot, student_role_snapshot,
  case_title_snapshot, case_category_snapshot,
  course_title_snapshot, cohort_title_snapshot,
  session_type, attempt_number, started_from_page,
  window_start, window_end, dominant_emotion, emotion_probabilities_json,
  valence, arousal, confidence, entropy, valid_frames, missing_face_ratio,
  quality_json, model_name, model_version, capture_mode, capture_status,
  student_consent_enabled, student_can_view, admin_can_view, educator_can_view,
  consent_version, consent_recorded_at, created_at
FROM oyon_emotion_records;

DROP TABLE oyon_emotion_records;
ALTER TABLE oyon_emotion_records_new RENAME TO oyon_emotion_records;

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_session_time
  ON oyon_emotion_records(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_user_time
  ON oyon_emotion_records(tenant_id, user_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_records_tenant_case_time
  ON oyon_emotion_records(tenant_id, case_id, window_start DESC);
