-- 0034: Voice 2.0 — the voice owns its engine (VOICE2_PLAN.md).
--
-- The platform engine setting (`tts_provider`) is retired: /api/tts now
-- derives each voice's engine from the voice id itself by exact catalogue
-- membership, so a Kokoro-voiced persona and a Google-voiced persona play
-- side by side. The fallback safety net is per-LANGUAGE default voices
-- (`tts_default_voice_<lang>`, seeded by boot code — setSettingIfEmpty in
-- server/server.js) plus per-provider enable toggles
-- (`tts_provider_enabled_<p>`).
--
-- This migration only RETIRES settings rows no code reads after this
-- release. It is data-only (no schema change) and re-run-safe. Stored
-- case/persona `case_voice` values are untouched — they keep working
-- (better than before: their own engine now plays them).

-- ── 1. Carry-over: legacy kokoro persona-default → en default ──────────
-- The gendered `default_voice_<provider>_<gender>` family has been a
-- resolver no-op since the 2026-05 collapse, but the keys stayed writable
-- via hand-crafted PUTs. If an admin deliberately set a kokoro value and
-- it is unambiguous (one non-empty value, or both genders equal), preserve
-- it as the en default. Ambiguous (two different values) → no carry-over;
-- boot seeding fills `af_bella` and the admin re-picks in Settings → Voice.
-- This step lives HERE (not in boot seeding) because step 3 deletes the
-- legacy rows — boot code runs after migrations and would never see them.
-- Only kokoro is carried: the en seed is a kokoro voice, and no other
-- language's seed can inherit an English-speaking kokoro id.
INSERT INTO platform_settings (setting_key, setting_value, updated_at)
SELECT 'tts_default_voice_en', legacy.val, CURRENT_TIMESTAMP
FROM (
    SELECT MIN(setting_value) AS val
    FROM platform_settings
    WHERE setting_key IN ('default_voice_kokoro_female', 'default_voice_kokoro_male')
      AND setting_value IS NOT NULL
      AND setting_value != ''
    HAVING COUNT(DISTINCT setting_value) = 1
) AS legacy
WHERE legacy.val IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM platform_settings WHERE setting_key = 'tts_default_voice_en'
  );

-- ── 2. Retire the platform engine setting ───────────────────────────────
-- No reader remains: /api/tts derives, /tts/voices lists all providers,
-- the boot audit derives per voice, the settings endpoints dropped the
-- key, and the client hydrates from the providers array.
DELETE FROM platform_settings WHERE setting_key = 'tts_provider';

-- ── 3. Retire the legacy gendered defaults family ───────────────────────
-- Precise LIKE: the live keys are prefixed `tts_default_voice_` and the
-- avatars flat keys are `default_avatar_/default_rate_/default_pitch_`,
-- so `default_voice_%` matches exactly the retired family.
DELETE FROM platform_settings WHERE setting_key LIKE 'default_voice_%';

-- ── 4. Retire per-provider voice slot rows (defense in depth) ───────────
-- Migration 0022 deleted these once, but the /platform-settings/voice PUT
-- kept accepting `voice_<provider>_<gender>` writes until this release, so
-- rows may have been recreated. GLOB by gender suffix on purpose:
-- a bare `voice_%` LIKE would also hit `voice_mode_enabled`.
DELETE FROM platform_settings
WHERE setting_key GLOB 'voice_*_female'
   OR setting_key GLOB 'voice_*_male'
   OR setting_key GLOB 'voice_*_child';
