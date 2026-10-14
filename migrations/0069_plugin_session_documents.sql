-- A learner's work inside a plugin room, kept on the server.
--
-- Plugin rooms (pathology, PACS, ECG) persist the learner's own work — reports,
-- annotations, measurements — through the host's `ctx.store`. Until now that
-- store was the browser's localStorage, so a submitted pathology report lived
-- on one device only: lost across devices, overwritten last-writer-wins by a
-- second tab of the same session, and invisible to the educator reviewing the
-- session. The store now writes here (server/routes/plugin-session-state-routes.js)
-- and keeps localStorage only as an offline draft cache.
--
-- One document per session, plugin and name. `revision` is the optimistic
-- concurrency counter: a write names the revision it was based on and is
-- refused (409) when another tab or device has written since. The document is
-- opaque JSON owned by the plugin; the host stores it as a unit.
--
-- Erased with the user (HARD_DELETE_ON_PURGE_TABLES, hard user delete): it is
-- the learner's own prose and marks, not an anonymisable trace.
--
-- Strictly additive: one new table and one index.

CREATE TABLE IF NOT EXISTS plugin_session_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   INTEGER NOT NULL DEFAULT 1,
    session_id  INTEGER NOT NULL REFERENCES sessions(id),
    user_id     INTEGER REFERENCES users(id),
    plugin_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    document    TEXT NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (session_id, plugin_id, name)
);

CREATE INDEX IF NOT EXISTS idx_plugin_session_documents_tenant_session
    ON plugin_session_documents (tenant_id, session_id);
