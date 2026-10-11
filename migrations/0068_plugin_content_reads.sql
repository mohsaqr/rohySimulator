-- Which plugin content each user's browser has loaded, recorded by the server
-- (3.0.0-rc.34).
--
-- The course gate's "every pathology slide opened" condition used to count
-- OPENED_SLIDE learning events, which the learner's own browser posts — so a
-- learner could post them for slides they never opened and release the
-- course materials early. A slide reaches a learner only through rohy's
-- authenticated content proxy (GET /api/plugins/:pluginId/*), so the proxy now
-- records the first time it serves a user each slide descriptor (`.dzi`), and
-- the gate counts those rows instead.
--
-- One row per tenant, user, plugin and content path; only the first read is
-- kept. Erased with the user (HARD_DELETE_ON_PURGE_TABLES, hard user delete).
--
-- Strictly additive: one new table.

CREATE TABLE IF NOT EXISTS plugin_content_reads (
    tenant_id     INTEGER NOT NULL DEFAULT 1,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    plugin_id     TEXT NOT NULL,
    path          TEXT NOT NULL,
    first_read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, user_id, plugin_id, path)
);
