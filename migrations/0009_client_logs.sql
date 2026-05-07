CREATE TABLE IF NOT EXISTS client_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER,
    session_id INTEGER,
    request_id TEXT,
    level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
    component TEXT NOT NULL,
    msg TEXT NOT NULL,
    fields_json TEXT,
    ts DATETIME NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_logs_tenant_session_received
    ON client_logs(tenant_id, session_id, received_at);
