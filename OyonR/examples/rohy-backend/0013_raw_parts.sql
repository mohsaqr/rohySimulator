-- Raw-only envelopes and split windows (Oyon 3.5.11, docs/ROHY_INTEGRATION.md §4.3a).
-- HttpEmotionTransport keeps every POST under transport_max_post_bytes
-- (240 KiB by default) without cutting rows: a window too large for one POST
-- continues in raw-only parts (modality 'raw', raw_reason 'continuation') that
-- share raw_part_id; raw-only envelopes also carry rows left on stop
-- ('stop', 'track_ended') or sent early at the recorder's row bound ('row_bound').
-- Store every part as its own row; readers rebuild windows with joinRawParts().

ALTER TABLE emotion_windows ADD COLUMN modality TEXT;
ALTER TABLE emotion_windows ADD COLUMN raw_reason TEXT;
ALTER TABLE emotion_windows ADD COLUMN raw_part_id TEXT;
ALTER TABLE emotion_windows ADD COLUMN raw_part_index INTEGER;
ALTER TABLE emotion_windows ADD COLUMN raw_part_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_emotion_windows_raw_part
  ON emotion_windows(tenant_id, raw_part_id, raw_part_index);
