-- 0075: a registration request remembers the course it was made for (PRV-68).
--
-- A course's registration code (cohorts.join_code) is accepted at sign-up from
-- 3.1.0: the newcomer becomes a student of that course. In `approval`
-- mode the applicant is not a user yet (migration 0038), so the course has to
-- wait with the request until an admin approves it; the approve route then
-- enrols the new account in that course, before the default-course sweep.
--
-- Strictly additive: one nullable column. Existing requests keep NULL, which
-- is exactly how they behaved before (no course).

ALTER TABLE registration_requests ADD COLUMN cohort_id INTEGER REFERENCES cohorts(id);
