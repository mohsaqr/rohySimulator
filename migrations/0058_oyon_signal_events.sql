-- Oyon's per-event state log for typing and voice.
--
-- oyon_signal_windows (0039) stores one SUMMARY per typing episode or voice
-- turn. A summary cannot support sequence analysis: a transition network, a
-- process map or sequence clustering needs one ordered, state-labelled row per
-- event (insert -> pause -> delete -> submit; speech -> silence -> pause). Oyon's
-- SignalCapture already produces exactly that log and hands each event to the
-- host through `onEvent`; this table is where Rohy keeps it.
--
-- Content-free by construction. A typing event is a state plus a caret offset,
-- a length and an edit kind; a voice event is a state plus a pause length. The
-- words typed and the audio never exist in this shape. The ingest route keeps
-- only the whitelisted detail keys below, so anything else a client sends is
-- dropped rather than stored.
--
-- Same consent gate as the windows: typing needs oyon-consent-v2, voice v3.

CREATE TABLE IF NOT EXISTS oyon_signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  case_id TEXT,
  student_name_snapshot TEXT,
  case_title_snapshot TEXT,

  -- One capture is one ordering domain: `sequence_index` restarts at 0 for each
  -- capture, so a sequence is (session_id, capture_id) ordered by sequence_index.
  capture_id TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,

  modality TEXT NOT NULL CHECK (modality IN ('typing', 'voice')),
  state TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'ai', 'system')),
  state_vocabulary TEXT,

  occurred_at DATETIME NOT NULL,
  -- Pause length where the event carries one (typing pause, voice pause).
  duration_ms INTEGER,
  -- Whitelisted scalars only: offset, length, op, phase.
  detail_json TEXT,

  -- Frozen per-role visibility, same semantics as oyon_signal_windows.
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent ingest: a retried batch re-sends the same (capture, index) pairs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oyon_signal_events_dedup
  ON oyon_signal_events(tenant_id, session_id, capture_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_events_tenant_modality_time
  ON oyon_signal_events(tenant_id, modality, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_events_tenant_case_time
  ON oyon_signal_events(tenant_id, case_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_events_tenant_user_time
  ON oyon_signal_events(tenant_id, user_id, occurred_at DESC);
