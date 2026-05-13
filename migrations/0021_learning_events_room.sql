-- 0021: active in-session room on every learning_events row.
--
-- Goal: every recorded student action carries the room it happened in
-- ('chat' | 'examination' | 'lab' | 'radiology' | 'consultant'),
-- matching the bottom RoomNavigator. Lets the analytics layer ask
-- "what did the student do in the lab?" without joining against a
-- separate navigation table or parsing the context JSON blob.
--
-- The previous release stuffed room inside the context JSON column as
-- a transitional measure; the BackendSurface helper that wrote it
-- there is updated to also write the dedicated column. Reads can move
-- to the column whenever analytics queries are rewritten.
--
-- Column is nullable: pre-migration rows + events that fire before any
-- room has been entered (login screen, settings) stay NULL.

ALTER TABLE learning_events ADD COLUMN room TEXT;

-- Index supports the typical analytics filter "all events in lab" and
-- "all events for this session in this room". Partial so the index only
-- carries rows that have a room set — keeps it small.
CREATE INDEX IF NOT EXISTS idx_learning_events_room
    ON learning_events (room)
    WHERE room IS NOT NULL;
