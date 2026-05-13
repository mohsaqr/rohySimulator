-- 0022: collapse the voice configuration surface from 8 sources to 2.
--
-- Three weeks (32 commits) chasing voice bugs traced back to too many
-- places where a voice id / provider / rate / pitch could be set or
-- overridden. Cases stored a `tts_provider` field that was supposed to
-- be ignored but leaked through old merge logic. Stale Google ids
-- survived platform-wide switches to Kokoro and silently broke
-- playback. Zombie `voice_*` slot-key rows in platform_settings
-- accumulated from a retired fallback tier and bred on every boot via
-- a legacy migration loop. Multiple validators disagreed.
--
-- After this migration, ONLY two surfaces store voice information:
--   1. `platform_settings.tts_provider/tts_rate/tts_pitch` — global engine
--   2. `agent_templates.config.voice.case_voice` (per-persona default)
--      + `cases.config.voice.case_voice` (per-case override).
--
-- Provider, rate, and pitch live exclusively at the platform level.
-- Cases and personas only specify which voice file to use within the
-- active provider's catalogue. The resolver gains a validator (see the
-- companion code change in src/utils/voiceResolver.js) so any voice id
-- that isn't in the active provider's catalogue falls back to the
-- template — no more runtime "invalid voice" toasts.

-- ── 1. Delete zombie platform_settings rows ────────────────────────────
-- Per-provider slot keys (`voice_<provider>_<gender>`) and the older
-- `default_voice_*` / `piper_voice_*` schemes are not read by any
-- code path after the resolver collapsed to one tier (`a33779d`). The
-- boot loop that recreated `voice_piper_*` from `piper_voice_*` was
-- removed in the companion server.js edit; this migration cleans up
-- the rows it had already created.
DELETE FROM platform_settings
WHERE setting_key LIKE 'voice_%'
   OR setting_key LIKE 'piper_voice_%'
   OR setting_key LIKE 'default_voice_%';

-- ── 2. Strip per-case footgun fields ───────────────────────────────────
-- `tts_provider`, `tts_rate`, `tts_pitch` are platform-level decisions.
-- Cases that stored them did so under earlier merge regimes that have
-- since been retired. The fields linger in JSON and confuse readers.
UPDATE cases
SET config = json_remove(config, '$.voice.tts_provider', '$.voice.tts_rate', '$.voice.tts_pitch')
WHERE json_extract(config, '$.voice.tts_provider') IS NOT NULL
   OR json_extract(config, '$.voice.tts_rate')     IS NOT NULL
   OR json_extract(config, '$.voice.tts_pitch')    IS NOT NULL;

-- ── 3. Strip per-persona tts_provider ──────────────────────────────────
-- Same reasoning. Personas pick a voice id; the engine that plays it
-- is the platform's choice.
UPDATE agent_templates
SET config = json_remove(config, '$.voice.tts_provider')
WHERE json_extract(config, '$.voice.tts_provider') IS NOT NULL;

-- ── 4. Clear non-Kokoro case_voice values ──────────────────────────────
-- Kokoro voice ids match the pattern (af|am|bf|bm)_<name>. Anything
-- else (Google ids like `en-US-Neural2-J`, Piper filenames like
-- `en_US-amy-medium.onnx`, OpenAI names like `alloy`) is stale under
-- the current Kokoro provider. Clearing falls them back to the
-- persona template default. If a future operator switches providers,
-- they re-pick voices; we don't keep dead data around for "maybe later."
UPDATE cases
SET config = json_remove(config, '$.voice.case_voice')
WHERE json_extract(config, '$.voice.case_voice') IS NOT NULL
  AND json_extract(config, '$.voice.case_voice') NOT GLOB '[abf][bfm]_*';

UPDATE agent_templates
SET config = json_remove(config, '$.voice.case_voice')
WHERE json_extract(config, '$.voice.case_voice') IS NOT NULL
  AND json_extract(config, '$.voice.case_voice') NOT GLOB '[abf][bfm]_*';

-- ── 5. Assign Kokoro voices to the 6 shipped cases ─────────────────────
-- Each gets a distinct voice from the shipped persona pool so default
-- patients sound different from each other without needing new voice
-- ids. Match by both id AND name so a renamed/re-seeded row doesn't
-- get accidentally retargeted.
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'am_michael')
    WHERE id = 1 AND name = 'Acute Chest Pain - STEMI';
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'af_bella')
    WHERE id = 2 AND name = 'Septic Shock - Pneumonia';
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'am_liam')
    WHERE id = 3 AND name = 'Diabetic Ketoacidosis';
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'af_sky')
    WHERE id = 4 AND name = 'Acute Asthma Exacerbation';
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'bm_lewis')
    WHERE id = 5 AND name = 'Acute Stroke - Left MCA';
UPDATE cases SET config = json_set(config, '$.voice.case_voice', 'af_nicole')
    WHERE id = 6 AND name = 'Maria Mercedes - Acute STEMI';

-- ── 6. Delete test-fixture cases that leaked from non-isolated tests ───
-- tests/server/*.test.js used to write to the shared dev DB rather
-- than a per-test temp file. ~55 rows accumulated with these naming
-- patterns. Documented in HANDOFF; safe to remove from any operator
-- DB since no real session references them.
DELETE FROM cases
WHERE name LIKE 'Educator Case rbac-%'
   OR name LIKE 'Admin Case rbac-%'
   OR name LIKE 'AuditLog Case %'
   OR name LIKE 'Tenant A Case %'
   OR name LIKE 'Tenant B Case %'
   OR name LIKE 'Tenant B Mass Assignment %'
   OR name LIKE 'Soft Delete Case %'
   OR name LIKE 'Authored Purge Case %';
