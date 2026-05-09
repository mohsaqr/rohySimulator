-- 0018: wide vitals snapshot on every learning_events row.
--
-- Goal: every recorded student action (and every IDLE physiology sample)
-- carries the patient's vitals AT THAT MOMENT. Researchers can then ask
-- "what were vitals when the student ordered the IV?" without joining
-- against a separate vitals timeseries.
--
-- All columns are nullable. Older rows (pre-migration) stay NULL.
-- New rows that don't have a session yet (pre-session events) also stay NULL.

ALTER TABLE learning_events ADD COLUMN vital_hr REAL;
ALTER TABLE learning_events ADD COLUMN vital_spo2 REAL;
ALTER TABLE learning_events ADD COLUMN vital_bp_sys REAL;
ALTER TABLE learning_events ADD COLUMN vital_bp_dia REAL;
ALTER TABLE learning_events ADD COLUMN vital_rr REAL;
ALTER TABLE learning_events ADD COLUMN vital_temp REAL;
ALTER TABLE learning_events ADD COLUMN vital_etco2 REAL;
ALTER TABLE learning_events ADD COLUMN vital_rhythm TEXT;
