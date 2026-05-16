# FAQ & troubleshooting

Common questions, answered from how Rohy actually behaves.

## Classes & members

### I added a student by username but got "User not found in this tenant"

The person must already have an account in **your tenant**. Add by exact
username or email. If they have no account yet, they need one before you can
enrol them — or share the join code so they self-enrol after signing up.

### A student says the join code does not work

Codes are case-sensitive strings drawn from an alphabet with no ambiguous
glyphs (no `0/O`, `1/I/L`), so a misread is unlikely but a typo is not.
Confirm the class still has a code (it may have been **Disabled**), and that
it was not **Rotated** — rotating invalidates the previous code immediately.
Re-copy the current code from the **Manage** tab.

### I made someone a co-teacher but they were a student — did I lose their data?

No. Promoting a live student to co-teacher updates that single membership in
place; it is never duplicated and no activity is lost. Going the other way is
protected too: adding an existing co-teacher "as a student" does not demote
them.

### Can I remove the class owner as a co-teacher?

No. The owner is always a teacher of their class and is shown as
non-removable. Co-teachers can be removed; re-adding revives them.

### I deleted a class by mistake

Deletion is a soft delete of the class grouping and its memberships.
Members' accounts and their own session data are untouched. Recovery of the
class itself is an admin/operator action, not something the class UI exposes
— contact your administrator.

## Cases & assignment

### I assigned cases but the completion grid is still empty

The grid is driven by **sessions students actually ran**, not by the
assignment list. It populates once class members start sessions in cases.
Assigning a case does not pre-fill any report.

### I edited a case but a student in a live session sees the old version

Expected. When a session starts the case is frozen into that session, so
edits do not bleed into a run already in progress. The student must start a
new session to get the updated case.

## Reporting

### What does "Completed" mean?

A student reached the **debrief** screen for that case — the terminal screen
of a run. It does **not** mean they passed a score threshold; the
passing-score policy is stored but not enforced. See
[Classroom policy](/educator/classroom-policy).

### Why is a student missing from a report?

Reports only include **live members** of the class. If they were removed (or
never added), they will not appear. Re-add them; a revived membership keeps
its history.

### The TNA / behaviour network is empty

There is not enough sequenced activity in the chosen scope. Widen the scope
(whole class instead of one student or one session), or wait for more runs.
See [TNA analytics](/educator/tna).

### The live feed stopped updating

Check whether you clicked **Pause** — click **Resume**. The feed only polls
while its tab is open; switching away stops it by design. Re-open the
**Live feed** view to resume.

## Oyon emotion analytics

### There is no Oyon data

Oyon is optional and per-tenant. There is no data unless the add-on is
enabled **and** the student consented. A disabled add-on shows a clear
message instead of analytics. Inference is on-device and only aggregated
windows are stored — see [Oyon emotion analytics](/educator/oyon-analytics).

### Some emotion windows look wrong

Filter by **minimum confidence** and **maximum missing-face ratio**. Low
confidence or a high missing-face ratio means that window is unreliable —
discard it rather than reading it as real signal.

## Reference

- [Classes & join codes](/educator/cohorts) ·
  [Assigning cases](/educator/assigning-cases) ·
  [Reporting & analytics](/educator/reporting)
- API: [cohorts endpoints](/reference/api/cohorts)
- [Glossary](/reference/glossary)
