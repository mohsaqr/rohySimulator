-- Stage E7 soft-delete + retention readiness.
--
-- Adds deleted_at to user-authored/domain rows that previously hard-deleted,
-- adds retention indexes for time-bounded logs, and rebuilds users so purge can
-- set email to NULL while preserving the anonymized ownership anchor row.

PRAGMA foreign_keys=OFF;

BEGIN;

ALTER TABLE agent_templates ADD COLUMN deleted_at DATETIME;
ALTER TABLE scenarios ADD COLUMN deleted_at DATETIME;
ALTER TABLE medications ADD COLUMN deleted_at DATETIME;
ALTER TABLE case_investigations ADD COLUMN deleted_at DATETIME;
ALTER TABLE lab_definitions ADD COLUMN deleted_at DATETIME;

CREATE TABLE llm_request_log_retention_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id INTEGER,
    model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    estimated_cost REAL,
    status TEXT CHECK(status IN ('success', 'error', 'rate_limited')) DEFAULT 'success',
    error_message TEXT,
    request_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);

INSERT INTO llm_request_log_retention_new (
    id, user_id, session_id, model, prompt_tokens, completion_tokens,
    total_tokens, estimated_cost, status, error_message, request_timestamp,
    response_time_ms, tenant_id
)
SELECT
    id, user_id, session_id, model, prompt_tokens, completion_tokens,
    total_tokens, estimated_cost, status, error_message, request_timestamp,
    response_time_ms, tenant_id
FROM llm_request_log;

DROP TABLE llm_request_log;
ALTER TABLE llm_request_log_retention_new RENAME TO llm_request_log;

CREATE TABLE users_retention_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('guest', 'student', 'reviewer', 'educator', 'admin')) DEFAULT 'student',
    role_rank INTEGER GENERATED ALWAYS AS (
        CASE role
            WHEN 'guest' THEN 0
            WHEN 'student' THEN 1
            WHEN 'reviewer' THEN 2
            WHEN 'educator' THEN 3
            WHEN 'admin' THEN 4
        END
    ) STORED,
    department TEXT,
    status TEXT CHECK(status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
    last_login DATETIME,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    institution TEXT,
    address TEXT,
    phone TEXT,
    alternative_email TEXT,
    education TEXT,
    grade TEXT,
    tenant_id INTEGER NOT NULL DEFAULT 1
);

INSERT INTO users_retention_new (
    id, username, name, password_hash, email, role, department, status,
    last_login, failed_login_attempts, locked_until, created_at, updated_at,
    deleted_at, institution, address, phone, alternative_email, education,
    grade, tenant_id
)
SELECT
    id, username, name, password_hash, email, role, department, status,
    last_login, failed_login_attempts, locked_until, created_at, updated_at,
    deleted_at, institution, address, phone, alternative_email, education,
    grade, tenant_id
FROM users;

DROP TABLE users;
ALTER TABLE users_retention_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_role_rank ON users(role_rank);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

CREATE INDEX IF NOT EXISTS idx_cases_deleted_at ON cases(deleted_at);
CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at);
CREATE INDEX IF NOT EXISTS idx_interactions_deleted_at ON interactions(deleted_at);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_deleted_at ON clinical_notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_agent_templates_deleted_at ON agent_templates(deleted_at);
CREATE INDEX IF NOT EXISTS idx_scenarios_deleted_at ON scenarios(deleted_at);
CREATE INDEX IF NOT EXISTS idx_medications_deleted_at ON medications(deleted_at);
CREATE INDEX IF NOT EXISTS idx_case_investigations_deleted_at ON case_investigations(deleted_at);
CREATE INDEX IF NOT EXISTS idx_lab_definitions_deleted_at ON lab_definitions(deleted_at);

CREATE INDEX IF NOT EXISTS idx_retention_event_log_timestamp ON event_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_retention_learning_events_timestamp ON learning_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_retention_interactions_timestamp ON interactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_retention_system_audit_log_timestamp ON system_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_retention_alarm_events_triggered_at ON alarm_events(triggered_at);
CREATE INDEX IF NOT EXISTS idx_retention_llm_request_log_timestamp ON llm_request_log(request_timestamp);
CREATE INDEX IF NOT EXISTS idx_llm_request_log_tenant_user ON llm_request_log(tenant_id, user_id, request_timestamp);

COMMIT;

PRAGMA foreign_keys=ON;
