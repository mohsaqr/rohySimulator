-- Security audit 2026-10-26 (lane D): three additive pieces, no row deleted.
--
-- 1. Audit hash scheme 2 (L6-07). The chain's hash covered every column except
--    username, status, error_message and session_id, so those four could be
--    rewritten without verification noticing. server/audit-chain.js now hashes
--    them too for every NEW row and records the scheme it used here. Existing
--    rows keep NULL (= scheme 1) and keep verifying exactly as before.
ALTER TABLE system_audit_log ADD COLUMN hash_version INTEGER;

-- 2. Heart rate and respiration off for tenants that never saved their Oyon
--    settings (F-04). 0040 created both columns DEFAULT 1, so a tenant got rPPG
--    heart-rate and respiration estimates stored as soon as capture was on and a
--    learner had consented to "camera-based emotion capture" — a card that names
--    neither. A row is touched ONLY when nobody has ever saved it: updated_at
--    still equals created_at (PUT /addons/oyon/settings always stamps
--    updated_at; the lazy INSERT stamps both from one clock reading), AND the
--    audit log holds no `oyon.settings_updated` entry for that tenant. An
--    administrator who saved the settings keeps exactly what they saved; the
--    ingest gate (physiological consent, server/routes/oyon-routes.js) is what
--    keeps those values from being stored without a named consent.
UPDATE oyon_settings
   SET heart_rate_enabled = 0, respiration_enabled = 0
 WHERE (heart_rate_enabled = 1 OR respiration_enabled = 1)
   AND (updated_at IS NULL OR updated_at = created_at)
   AND NOT EXISTS (
        SELECT 1 FROM system_audit_log a
         WHERE a.action = 'oyon.settings_updated'
           AND a.resource_type = 'oyon_settings'
           AND a.resource_id = oyon_settings.tenant_id
   );

-- 3. One survey response per person (F-37 / F-39 / L8-16). The submit route
--    checked for an earlier response and then inserted, with no index behind
--    the check, so two concurrent submits both landed; anonymous surveys had no
--    limit at all. A unique index directly on (survey_id, user_id) would fail
--    on any install that already holds duplicates, and anonymous rows have no
--    user_id. Instead each response gets a `dedupe_key`:
--      non-anonymous  'u:<user_id>:c:<cohort_id or ->'
--      anonymous      'a:<keyed digest of survey, user and cohort>'  (written by
--                     the route; the user id itself is never stored)
--    and the index covers only rows that carry one. Existing rows: the EARLIEST
--    non-anonymous response per (survey, user, cohort) gets its key; later
--    duplicates keep NULL and stay in place (nothing is deleted), outside the
--    index. Existing anonymous rows keep NULL.
ALTER TABLE survey_responses ADD COLUMN dedupe_key TEXT;

UPDATE survey_responses
   SET dedupe_key = 'u:' || user_id || ':c:' || COALESCE(CAST(cohort_id AS TEXT), '-')
 WHERE user_id IS NOT NULL
   AND id = (
        SELECT MIN(r2.id) FROM survey_responses r2
         WHERE r2.survey_id = survey_responses.survey_id
           AND r2.user_id = survey_responses.user_id
           AND r2.cohort_id IS survey_responses.cohort_id
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_responses_dedupe
    ON survey_responses(survey_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
