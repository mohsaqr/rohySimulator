-- 0076: Oyon per-sample streams (`raw_streams`), raw-only envelopes and split
-- windows (Oyon 3.5.11; Oyon docs/ROHY_INTEGRATION.md §4.3a).
--
-- From Oyon 3.5.11 every window carries `raw_streams`: the per-sample series
-- behind its aggregates (affect, eye, head, posture, heart rate, IBI,
-- respiration, illumination, screen gaze, host samples), columnar
-- `{ fields: ['ts_ms', 'ts_group_ms', ...], rows: [[...], ...] }`. Two new
-- record shapes travel beside the windows:
--   * raw-only envelopes, `modality: 'raw'`: rows no window carried — sent at
--     stop (`raw_reason: 'stop'`), when a face track ends ('track_ended') or
--     early at the recorder's row bound ('row_bound');
--   * continuation parts (`raw_reason: 'continuation'`): the rest of a window
--     too large for one POST. Every part, the window included, carries
--     `raw_part: { id, index, count }`; index 0 is the window itself.
--
-- All of these live HERE, one row per received payload, and nowhere else:
--   * the emotion record / signal window keeps its aggregates where it always
--     did, so no existing count, distribution or list changes, and a list read
--     (SELECT r.*) never drags megabytes of samples along;
--   * a raw-only envelope or part is not a window: it never reaches
--     oyon_emotion_records or oyon_signal_windows, so it cannot be counted as one.
-- GET /addons/oyon/raw-streams reads a session's rows back, split windows
-- joined (owner window + its parts, by raw_part_id).
--
-- Visibility columns mirror oyon_emotion_records so oyonReadScope applies
-- unchanged. Strictly additive: a new table, nothing rewritten.

CREATE TABLE IF NOT EXISTS oyon_raw_streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  case_id TEXT,

  -- Identity of this payload (see rawStreamRecordId in server/shared/oyonRawParts.js):
  -- the window's span plus modality, raw_reason, track and part index/count, so
  -- a window's own rows, a raw-only envelope and every continuation part stay
  -- distinct, while a retried POST collapses onto the row already stored.
  record_id TEXT NOT NULL,

  -- 'emotion' | 'signal' — the rows rode on that window (owner_record_id is its
  -- record_id); 'raw' — a raw-only envelope or a continuation part.
  owner_kind TEXT NOT NULL,
  owner_record_id TEXT,
  -- The window's modality ('emotion', a signal modality) or 'raw'.
  modality TEXT NOT NULL,
  raw_reason TEXT,
  raw_parent_modality TEXT,
  track_id TEXT,
  raw_part_id TEXT,
  raw_part_index INTEGER,
  raw_part_count INTEGER,

  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,

  -- The streams, verbatim (after the tenant's per-modality switches and the
  -- learner's physiological consent, exactly as the window blocks are gated).
  streams_json TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,

  student_can_view INTEGER NOT NULL DEFAULT 0,
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent ingest: a retried batch is a no-op (INSERT ... ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS idx_oyon_raw_streams_dedup
  ON oyon_raw_streams(tenant_id, session_id, record_id);

CREATE INDEX IF NOT EXISTS idx_oyon_raw_streams_tenant_session_time
  ON oyon_raw_streams(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_oyon_raw_streams_tenant_user_time
  ON oyon_raw_streams(tenant_id, user_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_raw_streams_raw_part
  ON oyon_raw_streams(tenant_id, raw_part_id, raw_part_index);
