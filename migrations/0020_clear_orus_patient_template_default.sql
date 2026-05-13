-- Clear the `en-US-Chirp3-HD-Orus` case_voice override from the default
-- patient persona template(s). This value was the cause of a three-week
-- "wrong voice everywhere" chase: when set on an is_default=1 patient
-- template, every case without its own override silently inherited the
-- Orus voice and shadowed the platform's gendered voice_<provider>_<slot>
-- slots — including for female patients who then spoke in a male voice.
--
-- Targeted on purpose: matches ONLY rows where case_voice is literally
-- "en-US-Chirp3-HD-Orus" so any admin who deliberately set a different
-- per-template voice via the persona editor is left alone. Other values
-- continue to surface in the boot-time audit
-- (server/healthChecks/voiceCatalogueAudit.js); admins can decide each
-- one case-by-case from the warning log.
--
-- json_remove drops the case_voice field; the rest of the voice object
-- (gender, tts_provider, tts_rate, tts_pitch) is preserved. Idempotent —
-- no-op once cleared.

UPDATE agent_templates
SET config = json_remove(config, '$.voice.case_voice'),
    updated_at = CURRENT_TIMESTAMP
WHERE agent_type = 'patient'
  AND is_default = 1
  AND json_extract(config, '$.voice.case_voice') = 'en-US-Chirp3-HD-Orus';
