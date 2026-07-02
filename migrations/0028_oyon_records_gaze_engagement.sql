-- Oyon v2: persist the gaze and engagement blocks the element's windows
-- carry. The v1 ingest projected each window into fixed columns and silently
-- dropped `gaze` (zone shares, AOI dwell, centroid stats — aggregates only,
-- never a raw point stream) and `engagement` (eye-openness / blink / on-task
-- aggregates). Without them the server-side pool can't feed the v2 Analyze
-- dashboards (gaze tiles, engagement KPIs).

ALTER TABLE oyon_emotion_records ADD COLUMN gaze_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN engagement_json TEXT;
