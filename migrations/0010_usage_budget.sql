CREATE TABLE IF NOT EXISTS usage_budget (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER,
    provider TEXT NOT NULL,
    metric TEXT NOT NULL,
    window_start DATETIME NOT NULL,
    window_end DATETIME NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, user_id, provider, metric, window_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_budget_tenant_user ON usage_budget(tenant_id, user_id, provider);
