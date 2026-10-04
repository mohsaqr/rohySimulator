-- Terms of use in the reader's language (3.0.0-rc.17).
--
-- The agreement can now be shown in any UI language whose translation renders
-- the current version (platform_settings.terms_translations). Acceptance stays
-- keyed on (user_id, version) — accepting in any language accepts that
-- version — and the snapshot now also records WHICH language was read, next to
-- the exact title and body already snapshotted. NULL for rows written before.

ALTER TABLE terms_acceptances ADD COLUMN language TEXT;
