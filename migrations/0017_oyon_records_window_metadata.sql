-- Oyon: persist the full aggregate-window contract emitted by EmotionRuntime.
-- Earlier Rohy storage kept the core emotion values but dropped duration,
-- sample-count, dispersion, settings, and dynamics fields. The standalone
-- dashboard and Oyon platform schema both expect those values to survive a
-- backend round-trip.

ALTER TABLE oyon_emotion_records ADD COLUMN duration_ms INTEGER;
ALTER TABLE oyon_emotion_records ADD COLUMN expected_samples INTEGER;

ALTER TABLE oyon_emotion_records ADD COLUMN valence_std REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN valence_min REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN valence_max REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN arousal_std REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN arousal_min REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN arousal_max REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN confidence_std REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN entropy_std REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN stability_score REAL;
ALTER TABLE oyon_emotion_records ADD COLUMN label_switch_count INTEGER;

ALTER TABLE oyon_emotion_records ADD COLUMN model_profile TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN settings_hash TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN settings_snapshot_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN dynamics_json TEXT;
