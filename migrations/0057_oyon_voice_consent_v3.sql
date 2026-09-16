-- Oyon voice: the tenant switch, and a consent contract that actually names it.
--
-- 0041 introduced consent v2 for the host-driven modalities and put `voice` and
-- `ai_assist` in the same set as typing, interaction and discourse. The v2 card
-- a learner sees lists only those three. So accepting v2 authorized microphone
-- capture from a card that never mentions audio — latent only because the client
-- forced voice off. Wiring voice would have made it live.
--
-- The fix is server code, not schema: server/routes/oyon-routes.js now maps each
-- modality to the OLDEST contract that names it (typing/interaction/discourse ->
-- v2; voice/ai_assist -> oyon-consent-v3) and derives the version a tenant asks
-- for from the modalities it has switched ON. This migration supplies the two
-- pieces of data that code needs.

-- 1. The tenant switch for voice. It gates microphone HARDWARE, so it defaults
--    OFF: an administrator turns it on deliberately, and only then does the
--    tenant start asking learners for v3.
ALTER TABLE oyon_settings ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;

-- 2. ai_assist off. It records an AI-suggestion cycle (offered, shown, accepted,
--    rejected, dismissed) that only the HOST can emit, and Rohy has no such
--    cycle — nothing in the client produces an ai_assist event. The flag was on
--    and captured nothing. Under the new contracts it would also raise the
--    tenant's required version to v3, asking learners to consent to voice
--    capture that does not exist. This cannot tell 0041's default from an admin
--    who switched it on deliberately — both read 1 — so it turns off every row.
--    That is acceptable here because the flag had no effect in Rohy either way,
--    and an admin who wants it back can switch it on in Settings -> Oyon.
UPDATE oyon_settings SET ai_assist_enabled = 0 WHERE ai_assist_enabled = 1;
