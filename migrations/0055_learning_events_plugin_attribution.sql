-- 0055: which plugin produced a learning-event row, and which version of it.
-- RPS-1 §14.3 ("no plugin/version attribution on rows").
--
-- Additive: two nullable columns, one partial index, one guarded backfill.
-- Pre-migration code never selects these columns; existing rows read NULL
-- except where `room` already identified a plugin, which is the whole of the
-- historical plugin corpus.

ALTER TABLE learning_events ADD COLUMN plugin_id TEXT;
ALTER TABLE learning_events ADD COLUMN plugin_version TEXT;

-- The analytics filter this exists for: "everything plugin X produced for this
-- tenant, in order". Partial so the index carries only plugin rows — the same
-- shape 0021 used for `room`.
CREATE INDEX IF NOT EXISTS idx_learning_events_plugin
    ON learning_events (tenant_id, plugin_id, timestamp)
    WHERE plugin_id IS NOT NULL;

-- Backfill from `room`, which has BEEN the plugin id since 0021 for every
-- plugin row. Version is left NULL: it is genuinely unknown for a historical
-- row, and inventing the currently-installed version would be a lie that
-- version attribution exists to prevent.
-- The id list is literal because a migration cannot import a manifest;
-- tests/server/learning-events-plugin-attribution.test.js asserts every
-- manifest id is either listed here or newer than this migration.
UPDATE learning_events
   SET plugin_id = room
 WHERE plugin_id IS NULL
   AND room IN ('pacs', 'ecg', 'pathology', 'room3d');
