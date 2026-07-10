-- 0035: visible, language-bearing case code (<LANG>-<zero-padded id>).
--
-- cases.id (INTEGER AUTOINCREMENT) is untouched; the numeric part IS the id,
-- so codes are unique by construction. The prefix is the case's own dialogue
-- language, which from this migration on is IMMUTABLE and always concrete:
-- a case never "follows the student's UI language" — existing rows with an
-- absent/empty/unknown config.case_language are normalized to an explicit
-- 'en' (all pre-i18n cases were authored in English).
--
-- Registry snapshot at migration time: en, it, fi, sv, de. Rows whose config
-- is malformed JSON are left untouched by the normalization (never destroy
-- data) and coded with the default 'EN' prefix; the boot sweep
-- (ensureCaseCodes) self-heals anything inserted later without a code.

BEGIN;

ALTER TABLE cases ADD COLUMN case_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_case_code
    ON cases(case_code) WHERE case_code IS NOT NULL;

-- Every case owns a concrete language: pin valid picks, default the rest.
UPDATE cases
   SET config = json_set(
        COALESCE(NULLIF(config, ''), '{}'),
        '$.case_language',
        CASE
          WHEN lower(coalesce(json_extract(config, '$.case_language'), ''))
               IN ('en', 'it', 'fi', 'sv', 'de')
          THEN lower(json_extract(config, '$.case_language'))
          ELSE 'en'
        END)
 WHERE config IS NULL OR config = '' OR json_valid(config);

-- Stamp the code from the (now concrete) language; malformed config → 'EN'.
UPDATE cases
   SET case_code = (
        CASE
          WHEN config IS NOT NULL AND json_valid(config)
               AND lower(coalesce(json_extract(config, '$.case_language'), ''))
                   IN ('en', 'it', 'fi', 'sv', 'de')
          THEN upper(json_extract(config, '$.case_language'))
          ELSE 'EN'
        END
      ) || '-' || printf('%04d', id)
 WHERE case_code IS NULL;

COMMIT;
