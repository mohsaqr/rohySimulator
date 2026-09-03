# FAQ & troubleshooting

Common questions, answered from how Rohy behaves today.

## Classes & members

### I added a student by username but got "User not found in this tenant"

The person must already have an account in **your tenant**. Add by exact
username or email. If they have no account yet, they need one before you can
enrol them. Share the join code so they self-enrol after signing up.

### A student says the join code does not work

Codes are drawn from an alphabet with no ambiguous glyphs (no `0/O`,
`1/I/L`), and the server folds what a student types to upper case and drops
every character outside that alphabet, so `abcd-efgh` and `ABCDEFGH` reach the
same class. Confirm the class still has a code (it may have been
**Disabled**), and check whether it was **Rotated**: rotating invalidates the
previous code immediately. Re-copy the current code from the **Manage** tab.

### I promoted a student to co-teacher. Did I lose their data?

No. Promoting a live student to co-teacher updates that single membership in
place, leaving one row and all their activity. Going the other way is
protected too: adding an existing co-teacher "as a student" leaves their role
as teacher.

### Can I remove the class owner as a co-teacher?

No. The owner is always a teacher of their class and is shown as
non-removable. Co-teachers can be removed; re-adding revives them.

### I deleted a class by mistake

Deletion is a soft delete of the class grouping and its memberships.
Members' accounts and their own session data are untouched. Recovery of the
class itself is an admin/operator action that the class UI leaves out.
Contact your administrator.

## Cases & assignment

### I assigned cases but the completion grid is still empty

The grid is driven by **the sessions students ran**. It populates once class
members start sessions in cases. Assigning a case leaves every report empty
until a session runs.

### I edited a case but a student in a live session sees the old version

Expected. When a session starts the case is frozen into that session, so
edits do not bleed into a run already in progress. The student must start a
new session to get the updated case.

## Reporting

### What does "Completed" mean?

A student reached the **debrief** screen for that case, which is the terminal
screen of a run. It carries no score threshold: the passing-score policy is
stored and unenforced. See
[Classroom policy](/educator/classroom-policy).

### Why is a student missing from a report?

Reports only include **live members** of the class. A person who was removed,
or who was added at no point, is absent from them. Re-add them; a revived
membership keeps its history.

### The TNA / behaviour network is empty

The chosen scope holds too little sequenced activity. Widen the scope to the
whole class from one student or one session, or wait for more runs.
See [TNA analytics](/educator/tna).

### The live feed stopped updating

Check whether you clicked **Pause**, then click **Resume**. The feed polls
while its tab is open; switching away stops it by design. Re-open the
**Live feed** view to resume.

## Oyon emotion analytics

### There is no Oyon data

Oyon is optional and per-tenant. Data appears once the add-on is enabled
**and** the student has consented. A disabled add-on shows a clear message in
place of analytics. Inference runs on-device and the store holds aggregated
windows alone. See [Oyon emotion analytics](/educator/oyon-analytics).

### Some emotion windows look wrong

Filter by **minimum confidence** and **maximum missing-face ratio**. Low
confidence or a high missing-face ratio marks that window as unreliable, so
discard it.

## Reference

- [Classes & join codes](/educator/cohorts) ·
  [Assigning cases](/educator/assigning-cases) ·
  [Reporting & analytics](/educator/reporting)
- API: [cohorts endpoints](/reference/api/cohorts)
- [Glossary](/reference/glossary)
