-- On-call specialists (pathologist, cardiologist, radiologist): data layer.
--
-- agent_conversations gains a channel so a specialist's phone call can be told
-- apart from typed chat, a call_id that groups the turns of one call, and the
-- case agent that spoke (attribution; agent_type alone cannot distinguish two
-- case agents of the same type across case edits).
--
-- channel is 'chat' | 'call'. SQLite cannot add a CHECK constraint through
-- ALTER TABLE ADD COLUMN reliably, so the allowed values are enforced in code.
--
-- llm_request_log gains the agent a request spoke as. tenant_id already exists
-- on this table (0004_tenants.sql), so it is not added here.
--
-- Strictly additive: nullable columns plus one defaulted column; existing rows
-- read channel = 'chat' and NULL attribution. No seeding (the specialist
-- templates are seeded in server/db.js DEFAULT_AGENTS).
ALTER TABLE agent_conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE agent_conversations ADD COLUMN call_id TEXT;
ALTER TABLE agent_conversations ADD COLUMN case_agent_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_agent_conv_tenant_session_call
    ON agent_conversations(tenant_id, session_id, call_id)
    WHERE call_id IS NOT NULL;

ALTER TABLE llm_request_log ADD COLUMN agent_type TEXT;
ALTER TABLE llm_request_log ADD COLUMN case_agent_id INTEGER;
