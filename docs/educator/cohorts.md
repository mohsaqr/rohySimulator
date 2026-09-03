# Classes (cohorts) & join codes

A **class** is your own group of students. It is the unit every report and the
Analytics dashboard is scoped against. In the API and generated reference a
class is called a *cohort*; they are the same thing.

You reach all of this from **Settings → Classes**.

## Create a class

1. Open **Settings → Classes**.
2. Type a name in **New class name** and click **Create**. That is the whole
   minimum: a named class with no members and no join code yet.
3. To set up more in one step, expand **Add details, cases, co-teachers &
   students** before creating. There you can add a **Description**, a
   **Start date** / **End date**, tick **Generate a join code now**, pick
   cases from the library, and pick co-teachers and initial students.

You only ever see and manage classes you own. An admin sees every class in
the tenant; you do not.

## Member roles

Every membership row carries a **member_role** of either `student` or
`teacher`. The application enforces that pair of values; the column itself is
declared `TEXT NOT NULL DEFAULT 'student'` with no CHECK constraint.

- **Students** are the learners the reports are about.
- **Teachers** (co-teachers) can open and manage the class exactly as you
  can. They reach it through the same access check that gates the owner and
  admins.

The **class owner** is always a teacher of that class and is *not* stored as
a membership row. The owner cannot be removed as a co-teacher (the attempt
returns an error and the UI shows the owner as non-removable).

Promotion is one-way and safe:

- Adding someone who is already a live student **as a co-teacher** promotes
  that one membership in place, leaving a single row.
- Adding someone who is already a live co-teacher **as a student** does *not*
  demote them. The request succeeds but the role is unchanged; the UI shows
  "already a member".

## Add members

In a class, open the **Manage** tab.

- **One at a time:** type a **username or email** in *Add member by username
  or email* and click **Add**. The person must already have an account in
  your tenant.
- **In bulk:** expand **Add students in bulk**, pick people, and submit. The
  add runs as one throttled batch and reports a single summary
  (`Added N, M already a member, K failed.`). People already enrolled are
  counted as skipped.
- **Co-teachers:** add them from the **Settings** tab under **Co-teachers**.

Remove a member with the **×** next to their row. Removal is a soft delete, so
re-adding the same person revives the original membership.

## Join codes

A join code allows students to enrol themselves. There is exactly **one**
generator (`allocateJoinCode`), shared by class-create and the rotate
endpoint, so codes are always drawn from the same collision-retried,
ambiguous-glyph-free alphabet (no `0/O`, `1/I/L`) and stay unique among live
classes.

In the **Manage** tab, under **Join code**:

- **Generate join code** creates one if the class has none.
- **Copy** puts it on the clipboard to share.
- **Rotate** replaces it with a fresh code. The old one stops working
  immediately.
- **Disable** clears it entirely; no one can self-enrol until you generate a
  new one.

::: warning
Anyone with the code can join the class. **Rotate or disable it if it
leaks.** Students enter it under **My Profile → Join a class**.
:::

## Edit or delete a class

- **Settings** tab: edit the name, description, dates, classroom profile and
  policy, assigned cases and co-teachers. See
  [Classroom policy](/educator/classroom-policy).
- **Delete** (trash icon on the class card): soft-deletes the class and all
  its memberships. Members' accounts and their own session data survive
  intact; they lose this grouping alone.

## The per-tenant Base Class

Each tenant has a **Base Class** created automatically by a backfill so that
activity recorded *before* the classes feature existed is still visible in
reporting. The platform creates and owns it. Treat it as the catch-all for
legacy activity, and enrol new students in a class of your own.

## Reference

- API: [cohorts endpoints](/reference/api/cohorts)
- Terms: [Cohort / class, Join code, member_role and Base Class in the
  glossary](/reference/glossary)
