-- Tamper-evident audit chain.
--
-- SQLite cannot express the idempotent ADD COLUMN checks or SHA-256
-- canonical-row backfill in portable SQL. The migration runner handles those
-- steps for version 0008 via server/audit-chain.js, then executes this
-- idempotent index creation in the same transaction.

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id_chain ON system_audit_log(tenant_id, id);
