-- 0056: the learning-event quarantine, plus the two read indexes every
-- tenant-scoped aggregate was missing.
--
-- A dropped event used to be a counter in the batch response — visible to
-- the client that sent it and to nobody else. Every rejected row now lands
-- here with its reason, so "where did the clicks go" is a query, not a guess.
-- `payload_json` is NULL for a forgery (not_owner / cross_tenant): the shape
-- summary is kept in its place, because attacker-supplied prose must not be
-- persisted under a victim's tenant.

CREATE TABLE IF NOT EXISTS learning_events_rejected (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id    INTEGER NOT NULL DEFAULT 1,
    user_id      INTEGER,               -- the PRINCIPAL who posted it, never a derived victim
    session_id   INTEGER,               -- as posted; deliberately NOT validated
    received_at  TEXT NOT NULL,         -- contract shape (RPS-1 §17), written by the ingest core
    reason       TEXT NOT NULL CHECK(reason IN (
                   'missing_required_field', 'unknown_verb', 'invalid_metadata',
                   'server_only_verb', 'not_owner', 'cross_tenant',
                   'payload_too_large', 'db_error')),
    source       TEXT,                  -- 'single' | 'batch' | 'plugin:<id>' | 'server:<verb>'
    verb         TEXT,
    object_type  TEXT,
    payload_json TEXT,                  -- <= 4 KB; shape-only for a forgery
    client_time  TEXT,
    plugin_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lev_rejected_tenant_time
    ON learning_events_rejected (tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_lev_rejected_reason
    ON learning_events_rejected (tenant_id, reason, received_at DESC);

-- Every aggregate leads with `tenant_id = ?` and then either ranges on
-- `timestamp` or groups on `verb`; neither pair had a composite index.
CREATE INDEX IF NOT EXISTS idx_learning_events_tenant_time
    ON learning_events (tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_learning_events_tenant_verb
    ON learning_events (tenant_id, verb);
