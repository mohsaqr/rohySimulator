-- Clamp existing case_investigations rows to the 1–5 minute band so DBs
-- seeded before the turnaround cleanup don't keep firing 30+ minute waits.
-- Authors who deliberately need a longer wait will re-set the value via
-- the case wizard.
--
-- Schema is unchanged — this is a data-only normalisation. Old code can
-- still read these rows; the column type and constraints are untouched.

UPDATE case_investigations
   SET turnaround_minutes = 5
 WHERE turnaround_minutes > 5;

UPDATE case_investigations
   SET turnaround_minutes = 1
 WHERE turnaround_minutes IS NOT NULL
   AND turnaround_minutes < 1;
