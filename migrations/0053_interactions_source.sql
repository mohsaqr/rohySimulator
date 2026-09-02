-- 0053: where a patient-conversation turn came from.
--
-- `interactions` is the session's ONE patient thread, and it is now written
-- from two surfaces: the chat room (keyboard or microphone) and the 3D room
-- (spoken). Without a marker the educator's transcript and every analytics
-- query treat them as undifferentiated chat. Nullable, so every row written
-- before this release reads as "unknown" rather than being relabelled.
ALTER TABLE interactions ADD COLUMN source TEXT;
