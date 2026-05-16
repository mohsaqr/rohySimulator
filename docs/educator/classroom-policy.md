# Classroom policy

A class's **Settings** tab carries a classroom profile and three policy
fields: a **passing score**, **allow case retakes**, and **require debrief**.
These are recorded on the class and travel with it.

::: danger
**These policy fields are stored but not yet enforced.** Saving them records
your intent on the class. They do **not** currently change how a session
runs, what a student is allowed to do, or how completion is scored in
reporting. Do not rely on them to gate students. This is a known limitation —
plan your assessment around it.
:::

## Where to set it

1. Open the class from **Settings -> Classes**.
2. Go to the **Settings** tab.
3. Set the fields under **Class identity** (course code, term),
   **Learning objectives**, and **Classroom policy**.
4. Click **Save class settings**.

The policy is stored inside the class's `settings` JSON. A save replaces that
object wholesale, so the form preserves any keys it does not manage rather
than dropping them.

## The fields

### Passing score

A percentage (0–100), or blank for no threshold. **Intended** meaning: the
score a student needs for a case to count as passed in reports.

**Today:** stored only. Reporting's **Completed** column means "reached the
debrief" — it does **not** apply this threshold. See
[Reporting & analytics](/educator/reporting).

### Allow case retakes

On by default. **Intended** meaning: whether a student may re-attempt an
assigned case after a completed run.

**Today:** stored only. The session engine does not block or limit retakes
based on this flag; students can re-run cases regardless.

### Require debrief

Off by default. **Intended** meaning: a case counts as complete only after
the student finishes the post-case discussion.

**Today:** stored only. Completion in reporting is already keyed on reaching
the debrief screen, but that behaviour is fixed — it is not driven by, and
does not change with, this flag.

## What it is good for now

- Documenting the class's grading and retake policy in one place for you and
  your co-teachers.
- Recording learning objectives, course code and term alongside the class.
- Being ready for when enforcement lands — values you set now will be there.

It does **not** retroactively change already-completed sessions, and it does
not change live behaviour. Communicate the policy to students directly until
enforcement is implemented.

## Reference

- API: [`PATCH /api/cohorts/:id`](/reference/api/cohorts) (the `settings`
  object)
- Related: [Reporting & analytics](/educator/reporting) ·
  [Classes & join codes](/educator/cohorts)
