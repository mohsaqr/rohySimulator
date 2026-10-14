-- How a learner read the pathology slides, scored on the server.
--
-- The pathology room's "How this slide was read" feedback (per-slide coverage,
-- key and critical findings reached, magnification, time, missed findings)
-- needs the case's rubric — every ROI and dwell threshold, i.e. the answer
-- key — which the server strips from everything a learner receives. So the
-- learner's browser records the read WITHOUT the rubric and, when a report is
-- submitted, posts it to POST /api/sessions/:sessionId/pathology-reads; the
-- server loads the rubric from the session's case snapshot, scores it with the
-- vendored package's own scorer (assessPackedRead), keeps the full result here
-- and returns only the learner-safe summary.
--
-- One row per session and activity: the FIRST submitted read of a task is the
-- one assessed and kept. A later submission returns the same feedback rather
-- than re-scoring a different read, so the missed-findings list cannot be used
-- to probe where the findings are.
--
-- Erased with the user (HARD_DELETE_ON_PURGE_TABLES, hard user delete).
--
-- Strictly additive: one new table and one index.

CREATE TABLE IF NOT EXISTS pathology_read_assessments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL DEFAULT 1,
    session_id    INTEGER NOT NULL REFERENCES sessions(id),
    user_id       INTEGER REFERENCES users(id),
    case_id       INTEGER,
    activity_id   TEXT NOT NULL,
    report_id     TEXT NOT NULL,
    sample_count  INTEGER NOT NULL,
    read_score    REAL,
    result        TEXT NOT NULL,
    feedback      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (session_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_pathology_read_assessments_tenant_session
    ON pathology_read_assessments (tenant_id, session_id);
