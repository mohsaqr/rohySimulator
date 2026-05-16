# Reporting & analytics

Every report is scoped to **your own class** — you only ever see the live
members of a class you own (or, as an admin, any class). All reporting is
read-only.

Open a class from **Settings → Classes** and go to the **Reports** tab, or
use the one-click report shortcuts on each class card. There are five
reporting views.

## 1. Roster

A per-student rollup table:

- **Student** — name and username.
- **Sessions** — number of sessions that student ran.
- **Attempted** — distinct cases they started.
- **Completed** — distinct cases where any session reached the debrief.
- **Last activity** — most recent session activity.

A case counts as **completed** when the student reached the debrief screen
(the terminal screen of every run). Click a row to drill into that student.

### Student drill-down

The student detail view groups every recorded action under the **session**
(case attempt) it belongs to. Each session card shows the case name, whether
the debrief was completed, the session status, an action count and the start
time. Actions without a known session are grouped under **Other activity**
so nothing is hidden.

## 2. Completion grid

A students x cases matrix. Each cell shows, for that student and case:

- a green check — at least one session reached the debrief (**completed**),
- an amber dot — **attempted** but not completed,
- a faint dot — **not attempted**.

Hover a cell for the last-activity time. Cases only appear once a class
member has a session in them.

## 3. Analytics

A native, class-scoped analytics report with an explicit scope drill:
**Whole class -> a student -> one of their sessions**. Changing scope
re-queries the member-scoped analytics endpoints. It shows a KPI band
(events, sessions, students, average events per student), engagement charts
(activity over time, when-they-worked heatmap, action and object-type
breakdowns) and a behaviour network. The behaviour-network part is
Transition Network Analysis — see [TNA analytics](/educator/tna) for how to
read it.

## 4. Export

Click **Download CSV** to download a flattened roster x case completion
report — one row per student-case pair — for grading or LMS import.
Columns:

`cohort_id, cohort_name, user_id, username, name, case_id, case_name,
attempted, completed, last_activity`

The download is authenticated; cells are escaped and spreadsheet-formula
characters are neutralised so the file is safe to open directly.

## 5. Live feed

A live stream of class activity, newest first, refreshing every 10 seconds.
**Pause**/**Resume** stops and restarts polling; the refresh icon fetches
immediately. The list is bounded (most recent rows) so it stays responsive
during a busy session.

## What "completed" and the numbers mean

- **Completed = reached the debrief.** It does not yet mean "passed a
  threshold". The classroom-policy passing score is stored but not enforced
  in these reports — see [Classroom policy](/educator/classroom-policy).
- Reporting reflects the **sessions students actually ran**, not the list of
  cases you assigned to the class. Assigning a case does not pre-populate the
  grid; activity does.

## Reference

- API: [cohorts reporting endpoints](/reference/api/cohorts) — `.../roster`,
  `.../grid`, `.../student/:userId`, `.../feed`, `.../export`
- [TNA analytics](/educator/tna) ·
  [Oyon emotion analytics](/educator/oyon-analytics)
