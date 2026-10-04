-- 0065 — the treatment rubric leaves cases.config.
--
-- The rubric (expected / contraindicated / points / feedback per treatment) is
-- graded from case_treatments. From rc.9 the case editor ALSO kept a copy in
-- cases.config.treatments, and every student received the case's config —
-- GET /cases, GET /cases/:id, the session snapshot — so the grading rubric
-- shipped to the people being graded. The server now strips the key on every
-- save and the editor reads the rubric from GET /cases/:id/treatments.
--
-- 1. BACKFILL FIRST. Before rc.9 the editor did not persist the rubric at all
--    (QA PRV-26), so for some cases config.treatments may be the only copy.
--    Where a case has NO case_treatments rows, its config copy becomes rows,
--    with the same flag rules the PUT applies: a hidden treatment is neither
--    expected nor contraindicated, and contraindicated wins over expected.
--    A case that already has rows keeps them untouched.
-- 2. Then remove the key from cases.config and from every session's
--    case_snapshot.config (the frozen copy the session serves).
--
-- Additive in effect: no schema change; rows are only added where none exist.

INSERT INTO case_treatments (
    case_id, treatment_type, medication_id, treatment_name,
    is_available, is_expected, is_contraindicated,
    points_if_ordered, feedback_if_ordered, feedback_if_missed, tenant_id
)
SELECT c.id,
       json_extract(j.value, '$.treatment_type'),
       json_extract(j.value, '$.medication_id'),
       json_extract(j.value, '$.treatment_name'),
       (COALESCE(json_extract(j.value, '$.is_available'), 1) != 0),
       (COALESCE(json_extract(j.value, '$.is_available'), 1) != 0)
         AND (COALESCE(json_extract(j.value, '$.is_expected'), 0) != 0)
         AND NOT (COALESCE(json_extract(j.value, '$.is_contraindicated'), 0) != 0),
       (COALESCE(json_extract(j.value, '$.is_available'), 1) != 0)
         AND (COALESCE(json_extract(j.value, '$.is_contraindicated'), 0) != 0),
       COALESCE(json_extract(j.value, '$.points_if_ordered'), 0),
       json_extract(j.value, '$.feedback_if_ordered'),
       json_extract(j.value, '$.feedback_if_missed'),
       c.tenant_id
  FROM cases c, json_each(c.config, '$.treatments') j
 WHERE json_valid(c.config)
   AND json_type(c.config, '$.treatments') = 'array'
   AND json_extract(j.value, '$.treatment_name') IS NOT NULL
   AND json_extract(j.value, '$.treatment_type') IN ('medication', 'iv_fluid', 'oxygen', 'nursing')
   AND NOT EXISTS (SELECT 1 FROM case_treatments ct WHERE ct.case_id = c.id);

UPDATE cases
   SET config = json_remove(config, '$.treatments')
 WHERE json_valid(config) AND json_type(config, '$.treatments') IS NOT NULL;

UPDATE sessions
   SET case_snapshot = json_remove(case_snapshot, '$.config.treatments')
 WHERE case_snapshot IS NOT NULL AND json_valid(case_snapshot)
   AND json_type(case_snapshot, '$.config.treatments') IS NOT NULL;
