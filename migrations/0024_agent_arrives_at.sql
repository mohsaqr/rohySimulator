-- 0024: server-anchored ETA for paged agents.
--
-- Background: when the learner pages an agent (e.g. the on-call
-- consultant), the wait used to be driven by a setTimeout living in
-- the chat component's local state. If the learner refreshed, switched
-- rooms, or remounted the chat, the timer was dropped — the server
-- still had status='paged' but nothing was scheduled to flip it to
-- 'present', so the agent appeared stuck "on the way…" forever.
--
-- Fix: store `arrives_at` on the session-state row when the agent is
-- paged. Reads can then compute remaining time from the server clock,
-- and the page handler / status handler can auto-flip 'paged' →
-- 'present' once we're past `arrives_at`. Survives reloads + room hops
-- without any client-side bookkeeping.
--
-- Nullable: pre-migration rows + agents that are 'present'/'absent'
-- (never paged) stay NULL. Old code paths that don't read this column
-- continue to work — strictly additive.

ALTER TABLE agent_session_state ADD COLUMN arrives_at DATETIME;
