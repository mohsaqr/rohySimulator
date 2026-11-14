-- Group alignment + per-sample raw streams (Oyon 3.5.11, docs/GROUP_SYNCHRONY.md).
-- group_id / member_id / seat arrive as host context keys on every window.
-- clock_* and window_anchor_ms say how well members' clocks were aligned.
-- raw_streams is the columnar per-sample series JSON
-- ({ "<stream>": { "fields": ["ts_ms","ts_group_ms",...], "rows": [[...]] } }).

ALTER TABLE emotion_windows ADD COLUMN group_id TEXT;
ALTER TABLE emotion_windows ADD COLUMN member_id TEXT;
ALTER TABLE emotion_windows ADD COLUMN seat TEXT;
ALTER TABLE emotion_windows ADD COLUMN clock_offset_ms REAL;
ALTER TABLE emotion_windows ADD COLUMN clock_rtt_ms REAL;
ALTER TABLE emotion_windows ADD COLUMN window_anchor_ms INTEGER;
ALTER TABLE emotion_windows ADD COLUMN raw_streams TEXT;

CREATE INDEX IF NOT EXISTS idx_emotion_windows_group_time
  ON emotion_windows(tenant_id, group_id, window_start);
