-- 0048: per-tenant plugin settings (RPS-1 1.4, the settings slot).
--
-- §14.4 of the plugin standard listed "no per-tenant enable/disable" as its
-- fourth open gap, naming `oyon_settings` as the pattern to copy. This copies
-- the pattern's SHAPE (one row per tenant, unique on tenant) but not its
-- columns: oyon_settings names each knob as its own column, which is right for
-- one built-in add-on and wrong for a slot any plugin may declare — a new
-- plugin would mean a new migration, and RPS-1's whole claim is that a plugin
-- is added by declaring, not by editing the host.
--
-- So the values live in one JSON column, and the SCHEMA that gives them meaning
-- lives in the manifest (`manifest.settings`, validated at plugins:gen time by
-- server/shared/pluginSettings.js). The database stores a flat map of dotted
-- keys — {"imports.enabled": true} — never a nested object: the PUT is a
-- key-presence merge, and "which keys did the caller send" has exactly one
-- answer on a flat map and several defensible ones on a nested one.
--
-- Reading a tenant with no row is NOT an error and must never be: a tenant that
-- has never opened the settings page runs on the manifest's declared defaults,
-- which is why every field is required to declare one. A row appears on the
-- first save, so the absence of a row means "never configured" rather than
-- "configured to nothing" — the distinction `setSettingIfEmpty` exists to
-- protect elsewhere in rohy.
--
-- Strictly additive: one new table, referenced by nothing that exists.

CREATE TABLE IF NOT EXISTS plugin_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  plugin_id TEXT NOT NULL,
  -- A flat JSON object of dotted setting keys. Not validated by sqlite; every
  -- read passes through readSettings(), which drops keys the manifest no
  -- longer declares and falls back to the default for a value the schema now
  -- rejects. That is what a plugin upgrade looks like from here.
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  UNIQUE (tenant_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_settings_tenant
  ON plugin_settings(tenant_id, plugin_id);
