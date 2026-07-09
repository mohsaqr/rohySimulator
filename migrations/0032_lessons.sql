-- 0032: lessons (lectures + sections + progress) and surveys, bound to cohorts.
--
-- Ports the LAILA/chatoyon lesson + survey model into rohy. A "lesson"
-- (chatoyon `Lecture`) attaches straight to a cohort (rohy's "course"); a
-- lesson is built from ordered `lesson_sections`; `lesson_progress` records
-- per-student completion. Surveys attach to a cohort via `cohort_surveys`.
--
-- Convention (matches 0025/0027/0030):
--   * INTEGER PK AUTOINCREMENT; INTEGER cohort_id / tenant_id / user FKs.
--   * FKs declared inline WITHOUT ON DELETE CASCADE — dependent cleanup is at
--     the application layer via soft-delete (`deleted_at`) + retention sweeps.
--   * Strictly additive: brand-new tables only, nothing existing is altered.
--
-- The chatbot section type from the source is intentionally omitted (deferred).

PRAGMA foreign_keys=OFF;

BEGIN;

-- ---------------------------------------------------------------------------
-- Lessons (= chatoyon Lecture)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort_id       INTEGER NOT NULL REFERENCES cohorts(id),
    tenant_id       INTEGER NOT NULL DEFAULT 1,
    title           TEXT NOT NULL,
    description     TEXT,
    content         TEXT,
    content_type    TEXT NOT NULL DEFAULT 'text',
    video_url       TEXT,
    duration        INTEGER,
    order_index     INTEGER NOT NULL DEFAULT 0,
    is_published    INTEGER NOT NULL DEFAULT 0,
    is_free         INTEGER NOT NULL DEFAULT 0,
    available_from  DATETIME,
    available_until DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lessons_cohort_id ON lessons(cohort_id);
CREATE INDEX IF NOT EXISTS idx_lessons_tenant_id ON lessons(tenant_id);

-- ---------------------------------------------------------------------------
-- Lesson sections (= chatoyon LectureSection). `order_index` maps to the
-- client's `order` field ("order" is a SQL reserved word).
-- type ∈ 'text' | 'file' | 'ai-generated' (chatbot omitted).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id   INTEGER NOT NULL REFERENCES lessons(id),
    title       TEXT,
    type        TEXT NOT NULL DEFAULT 'text',
    content     TEXT,
    file_name   TEXT,
    file_url    TEXT,
    file_type   TEXT,
    file_size   INTEGER,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at  DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lesson_sections_lesson_id ON lesson_sections(lesson_id);

-- ---------------------------------------------------------------------------
-- Lesson progress (= chatoyon LectureProgress). rohy keys by user_id (the
-- cohort_members analog of chatoyon's enrollmentId); one row per (user, lesson).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_progress (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    lesson_id    INTEGER NOT NULL REFERENCES lessons(id),
    cohort_id    INTEGER NOT NULL REFERENCES cohorts(id),
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at DATETIME,
    time_spent   INTEGER NOT NULL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_progress_user_lesson
    ON lesson_progress(user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);

-- ---------------------------------------------------------------------------
-- Surveys (= chatoyon Survey)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surveys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL DEFAULT 1,
    title         TEXT NOT NULL,
    description   TEXT,
    created_by_id INTEGER NOT NULL REFERENCES users(id),
    is_published  INTEGER NOT NULL DEFAULT 0,
    is_anonymous  INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME
);
CREATE INDEX IF NOT EXISTS idx_surveys_created_by_id ON surveys(created_by_id);
CREATE INDEX IF NOT EXISTS idx_surveys_tenant_id ON surveys(tenant_id);

-- Survey ↔ cohort attachment (= chatoyon ClassroomSurvey).
CREATE TABLE IF NOT EXISTS cohort_surveys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort_id   INTEGER NOT NULL REFERENCES cohorts(id),
    survey_id   INTEGER NOT NULL REFERENCES surveys(id),
    order_index INTEGER NOT NULL DEFAULT 0,
    added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at  DATETIME
);
-- One live attachment per (cohort, survey); partial so a detached survey can
-- be re-attached without a unique clash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_surveys_live
    ON cohort_surveys(cohort_id, survey_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cohort_surveys_cohort_id ON cohort_surveys(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_surveys_survey_id ON cohort_surveys(survey_id);

-- Survey questions. question_type ∈ single_choice | multiple_choice | free_text
-- (app-enforced). options is a JSON-stringified string[].
CREATE TABLE IF NOT EXISTS survey_questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id     INTEGER NOT NULL REFERENCES surveys(id),
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,
    options       TEXT,
    is_required   INTEGER NOT NULL DEFAULT 1,
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at    DATETIME
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey_id ON survey_questions(survey_id);

-- Survey responses. user_id NULL when the survey is anonymous.
CREATE TABLE IF NOT EXISTS survey_responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id    INTEGER NOT NULL REFERENCES surveys(id),
    user_id      INTEGER REFERENCES users(id),
    cohort_id    INTEGER,
    context      TEXT NOT NULL DEFAULT 'standalone',
    context_id   INTEGER,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_user_id ON survey_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_cohort_id ON survey_responses(cohort_id);

-- Survey answers. answer_value is a scalar string, OR JSON.stringify(string[])
-- for multiple_choice.
CREATE TABLE IF NOT EXISTS survey_answers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    response_id  INTEGER NOT NULL REFERENCES survey_responses(id),
    question_id  INTEGER NOT NULL REFERENCES survey_questions(id),
    answer_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response_id ON survey_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question_id ON survey_answers(question_id);

COMMIT;

PRAGMA foreign_keys=ON;
