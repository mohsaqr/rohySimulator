-- 0072: session-owned rows carry the tenant of the session they belong to.
--
-- Security audit 2026-10-26 (F-18 / L2-05). These tables got `tenant_id
-- INTEGER NOT NULL DEFAULT 1` in migration 0004, and their INSERTs never set
-- it, so every row written for a session of any other tenant was filed under
-- tenant 1:
--   session_notes             debrief notes; the user purge deletes
--                             WHERE tenant_id = ? AND user_id = ?, so a tenant-2
--                             learner's notes survived their erasure
--   patient_record_events     the encounter record; the patient persona and the
--   patient_record_documents  agent situation read it AND tenant_id = ?, so a
--                             tenant-2 session's persona had no live record
--   active_treatments         administered drugs; the active-effects reader
--                             filters on tenant, so they never took effect
--   clinical_notes            charted notes
-- The INSERTs now stamp the tenant (notes-routes.js, patient-record-routes.js,
-- orders-routes.js, admin-routes.js); this backfills the rows already written
-- from the owning session.
--
-- Only a row still at the column default (1) whose session belongs to another
-- tenant changes. A single-tenant install (every session in tenant 1) is
-- untouched: the WHERE matches nothing. Re-running is a no-op. No schema
-- change, no INSERT, no DELETE.

UPDATE session_notes
   SET tenant_id = (SELECT s.tenant_id FROM sessions s WHERE s.id = session_notes.session_id)
 WHERE tenant_id = 1
   AND EXISTS (SELECT 1 FROM sessions s
                WHERE s.id = session_notes.session_id
                  AND s.tenant_id IS NOT NULL AND s.tenant_id != 1);

UPDATE patient_record_events
   SET tenant_id = (SELECT s.tenant_id FROM sessions s WHERE s.id = patient_record_events.session_id)
 WHERE tenant_id = 1
   AND EXISTS (SELECT 1 FROM sessions s
                WHERE s.id = patient_record_events.session_id
                  AND s.tenant_id IS NOT NULL AND s.tenant_id != 1);

UPDATE patient_record_documents
   SET tenant_id = (SELECT s.tenant_id FROM sessions s WHERE s.id = patient_record_documents.session_id)
 WHERE tenant_id = 1
   AND EXISTS (SELECT 1 FROM sessions s
                WHERE s.id = patient_record_documents.session_id
                  AND s.tenant_id IS NOT NULL AND s.tenant_id != 1);

UPDATE active_treatments
   SET tenant_id = (SELECT s.tenant_id FROM sessions s WHERE s.id = active_treatments.session_id)
 WHERE tenant_id = 1
   AND EXISTS (SELECT 1 FROM sessions s
                WHERE s.id = active_treatments.session_id
                  AND s.tenant_id IS NOT NULL AND s.tenant_id != 1);

UPDATE clinical_notes
   SET tenant_id = (SELECT s.tenant_id FROM sessions s WHERE s.id = clinical_notes.session_id)
 WHERE tenant_id = 1
   AND EXISTS (SELECT 1 FROM sessions s
                WHERE s.id = clinical_notes.session_id
                  AND s.tenant_id IS NOT NULL AND s.tenant_id != 1);
