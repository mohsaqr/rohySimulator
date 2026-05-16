# Glossary

The terminology lock for all Rohy documentation and in-app help. When a term
here has a specific meaning, use it consistently — do not introduce synonyms.

## Roles & access

**Role rank** — Access is rank comparison, never string equality:
`guest (0) < student (1) < reviewer (2) < educator (3) < admin (4)`. A check
is "rank ≥ N", never "role == name".

**Student / trainee** — The learner who runs a case. "Trainee" is the
user-facing word in trainee documentation; "student" is the wire/role name
and the word used in educator/admin contexts (e.g. "student roster").

**Educator** — The role that owns classes and authors cases. **Surfaced in
the UI as "Teacher"** (the wire/role name is still `educator`; only the label
changed). Documentation says "Teacher" when describing UI, "educator" when
describing the role/permission.

**Reviewer** — Audit/review role between student and educator; can view
sessions and analytics, cannot author.

**Admin** — Full platform administration.

**Guest** — Unauthenticated/preview; cannot start sessions.

## Teaching structures

**Cohort / class** — A *teacher-owned class*: the unit the teacher dashboard
reports against. "Class" is the user-facing word; "cohort" is the technical/
API word. They are the same thing.

**Base Class** — The per-tenant backfill cohort created by migration 0026 so
activity that predates the cohorts feature is still visible. Not a user-
created class.

**Join code** — The code a student uses to join a class. Generated only by
`allocateJoinCode()` (collision-retry, ambiguous-glyph-free alphabet). One
owner, one generator.

**member_role** — `'student' | 'teacher'` within a cohort. App-enforced
(not a DB constraint).

**Case** — A clinical scenario a trainee runs (patient, presentation, labs,
imaging, exam findings, treatments, agents).

**Scenario / timeline** — The keyframed progression of a case's vitals and
state over time.

**Agent / persona** — An LLM-driven character (patient, consultant,
discussant, etc.) with its own system prompt, voice and avatar.

**Case snapshot** — When a session starts, `cases.config` + `cases.scenario`
are frozen into `sessions.case_snapshot`. The running session reads the
snapshot, **not** the live case row — admin edits during a live session do
not bleed in.

## Simulation surfaces

**Room** — One of the five peer spaces: Patient (chat), Examination,
Laboratory, Radiology, Consultant (debrief). `currentRoom` is the single
source of truth in `App.jsx`.

**Session** — One trainee's run of one case, from start to debrief end.

**Learning event** — An xAPI-style row written via `eventLogger.js` (130+
verbs); every row is `room`-stamped server-side. The only canonical way to
write `learning_events`.

**NotificationCenter** — The central notification dispatch. All toasts,
banners and alarms route through `src/notifications/` and fan out to 6
surfaces. There is no other notification path.

**Treatment effects engine** — The time-decaying vitals engine
(`useTreatmentEffects.js`); honours the Stage-5 manual-override guard.

## Platform systems

**dbAdapter** — The Promise + portable-SQL access layer (`server/dbAdapter.js`).
All new DB code goes through it, not raw `db.js`.

**Migration (additive / destructive)** — Schema change classified in
`migrations/MANIFEST.md`. Additive auto-applies; destructive needs an
explicit flag and a multi-release dance.

**Redaction** — `server/redaction.js`; the single policy for stripping
secrets/PII from responses. New sensitive fields are registered there.

**Audit chain** — SHA-256 hash-chained audit log on a dedicated connection.

**Scope (catalogue)** — `platform → tenant → user → session` visibility for
drug/lab catalogue entries.

**Oyon** — The vendored, browser-only emotion-capture add-on
(`/api/addons/oyon/*`, `OYON_ENABLED`). Only aggregated 10-second windows
leave the device.

**Tenant** — A multi-tenancy boundary; isolation is enforced by middleware,
not ad-hoc `WHERE`.

## Documentation terms

**M1 / M2 / M3** — Milestones. M1 = Trainee + Educator (first ship).

**Generated reference** — Docs produced from source (API/schema/config/CLI).
Never hand-written; never drifts.

**Authored guide** — Curated narrative documentation written by an author.
