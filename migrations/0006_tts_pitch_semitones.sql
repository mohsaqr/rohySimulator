-- Convert stored tts_pitch values from browser playback-rate multipliers to
-- provider pitch semitones. Formula: semitones = log2(multiplier) * 12.
-- Examples: 1.0 -> 0, 1.05 -> 0.844, 1.1 -> 1.65.

UPDATE agent_templates
SET config = json_set(
    config,
    '$.voice.tts_pitch',
    ROUND((log(CAST(json_extract(config, '$.voice.tts_pitch') AS REAL)) / log(2)) * 12, 4)
)
WHERE json_type(config, '$.voice.tts_pitch') IS NOT NULL
  AND CAST(json_extract(config, '$.voice.tts_pitch') AS REAL) > 0;

UPDATE cases
SET config = json_set(
    config,
    '$.voice.tts_pitch',
    ROUND((log(CAST(json_extract(config, '$.voice.tts_pitch') AS REAL)) / log(2)) * 12, 4)
)
WHERE json_type(config, '$.voice.tts_pitch') IS NOT NULL
  AND CAST(json_extract(config, '$.voice.tts_pitch') AS REAL) > 0;

UPDATE platform_settings
SET setting_value = CAST(ROUND((log(CAST(setting_value AS REAL)) / log(2)) * 12, 4) AS TEXT)
WHERE setting_key IN (
    'tts_pitch',
    'default_pitch_male',
    'default_pitch_female',
    'default_pitch_child'
)
  AND setting_value IS NOT NULL
  AND setting_value != ''
  AND CAST(setting_value AS REAL) > 0;
