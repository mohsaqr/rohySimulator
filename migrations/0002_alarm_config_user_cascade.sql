-- Rebuild alarm_config so user-owned alarm thresholds are removed by SQLite
-- when a user is hard-deleted.

PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE alarm_config_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    vital_sign TEXT,
    high_threshold REAL,
    low_threshold REAL,
    enabled BOOLEAN DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO alarm_config_new (id, user_id, vital_sign, high_threshold, low_threshold, enabled)
SELECT id, user_id, vital_sign, high_threshold, low_threshold, enabled
FROM alarm_config;

DROP TABLE alarm_config;
ALTER TABLE alarm_config_new RENAME TO alarm_config;

CREATE INDEX IF NOT EXISTS idx_alarm_config_user_vital ON alarm_config(user_id, vital_sign);

COMMIT;

PRAGMA foreign_keys=ON;
