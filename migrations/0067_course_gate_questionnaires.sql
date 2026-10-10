-- Course materials that open after the case, and case questionnaires (3.0.0-rc.29).
--
-- A lesson can now be locked behind a case: `lessons.unlock_case_id` names
-- the case whose course gate (cases.config.courseGate — minutes since the
-- learner started the case, all slides opened) must be met before the server
-- sends that learner the lesson's content. NULL keeps a lesson open, as every
-- existing lesson is.
--
-- The questionnaires themselves live in cases.config.questionnaires (so they
-- travel with the case); their answers are stored here, one row per learner,
-- case, questionnaire and attempt ('single', or 'pre'/'post' for a pre/post
-- test). `questionnaire` snapshots the questions as they were answered, so an
-- author's later edit does not change what an old answer meant.
--
-- Strictly additive: one nullable column and one new table.

ALTER TABLE lessons ADD COLUMN unlock_case_id INTEGER REFERENCES cases(id);
CREATE INDEX IF NOT EXISTS idx_lessons_unlock_case_id ON lessons(unlock_case_id);

CREATE TABLE IF NOT EXISTS case_questionnaire_responses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id        INTEGER NOT NULL DEFAULT 1,
    case_id          INTEGER NOT NULL REFERENCES cases(id),
    questionnaire_id TEXT NOT NULL,
    attempt          TEXT NOT NULL CHECK (attempt IN ('single', 'pre', 'post')),
    user_id          INTEGER NOT NULL REFERENCES users(id),
    session_id       INTEGER REFERENCES sessions(id),
    answers          TEXT NOT NULL,
    questionnaire    TEXT NOT NULL,
    score            INTEGER,
    max_score        INTEGER,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_questionnaire_responses_once
    ON case_questionnaire_responses(tenant_id, case_id, questionnaire_id, attempt, user_id);
CREATE INDEX IF NOT EXISTS idx_case_questionnaire_responses_case
    ON case_questionnaire_responses(tenant_id, case_id);
