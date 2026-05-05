-- Stage E6 multi-tenant readiness.
--
-- Existing single-tenant data is assigned to tenant_id=1 ("default").
-- Tenant deletion is intentionally RESTRICT at the application boundary for
-- E6; SQLite cannot add a REFERENCES column with a non-NULL default via
-- ALTER TABLE, and deleting a tenant is a retention/destructive-data policy
-- decision deferred to E7. The NOT NULL tenant_id plus indexes are the
-- structural isolation primitive introduced here.

PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_default BOOLEAN DEFAULT 0
);

INSERT OR IGNORE INTO tenants (id, slug, name, is_default)
VALUES (1, 'default', 'Default Tenant', 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_default_one
    ON tenants(is_default)
    WHERE is_default = 1;

ALTER TABLE users ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cases ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE interactions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE login_logs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings_logs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE session_settings ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE event_log ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alarm_events ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alarm_config ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE case_investigations ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE investigation_orders ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scenarios ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE learning_events ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE physical_exam_findings ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE patient_information ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE case_versions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE system_audit_log ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vital_sign_history ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE export_records ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE active_sessions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scenario_events ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinical_notes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE llm_usage ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE llm_request_log ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE patient_record_events ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE patient_record_documents ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_templates ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE case_agents ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_conversations ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_session_state ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE team_communications_log ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE treatment_orders ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE active_treatments ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE case_treatments ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE emotion_logs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE questionnaire_responses ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tts_usage ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE session_notes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE session_vitals ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_cases_tenant_available ON cases(tenant_id, is_available, is_default, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_tenant_id ON cases(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user ON sessions(tenant_id, user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_case ON sessions(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_session ON interactions(tenant_id, session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_login_logs_tenant_user ON login_logs(tenant_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_settings_logs_tenant_user ON settings_logs(tenant_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_session_settings_tenant_user ON session_settings(tenant_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_tenant_session ON event_log(tenant_id, session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_alarm_events_tenant_session ON alarm_events(tenant_id, session_id, triggered_at);
CREATE INDEX IF NOT EXISTS idx_alarm_config_tenant_user_vital ON alarm_config(tenant_id, user_id, vital_sign);
CREATE INDEX IF NOT EXISTS idx_case_investigations_tenant_case ON case_investigations(tenant_id, case_id, investigation_type);
CREATE INDEX IF NOT EXISTS idx_investigation_orders_tenant_session ON investigation_orders(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_tenant_created ON scenarios(tenant_id, created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_tenant_user ON learning_events(tenant_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_tenant_session ON learning_events(tenant_id, session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_physical_exam_tenant_session ON physical_exam_findings(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_case_versions_tenant_case ON case_versions(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_timestamp ON system_audit_log(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vital_history_tenant_session ON vital_sign_history(tenant_id, session_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_export_records_tenant_user ON export_records(tenant_id, user_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_sessions_tenant_user ON active_sessions(tenant_id, user_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_preferences_tenant_user ON user_preferences(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_tenant_session ON clinical_notes(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_tenant_user_date ON llm_usage(tenant_id, user_id, date);
CREATE INDEX IF NOT EXISTS idx_llm_request_log_tenant_user ON llm_request_log(tenant_id, user_id, request_timestamp);
CREATE INDEX IF NOT EXISTS idx_patient_record_events_tenant_session ON patient_record_events(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_patient_record_documents_tenant_session ON patient_record_documents(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_templates_tenant_type ON agent_templates(tenant_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_case_agents_tenant_case ON case_agents(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_agent_conv_tenant_session ON agent_conversations(tenant_id, session_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_state_tenant_session ON agent_session_state(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_team_log_tenant_session ON team_communications_log(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_treatment_orders_tenant_session ON treatment_orders(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_active_treatments_tenant_session ON active_treatments(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_case_treatments_tenant_case ON case_treatments(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_emotion_logs_tenant_user ON emotion_logs(tenant_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_questionnaire_tenant_user ON questionnaire_responses(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tts_usage_tenant_user_date ON tts_usage(tenant_id, user_id, date);
CREATE INDEX IF NOT EXISTS idx_session_notes_tenant_user ON session_notes(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_session_vitals_tenant_session ON session_vitals(tenant_id, session_id, timestamp);

COMMIT;

PRAGMA foreign_keys=ON;
