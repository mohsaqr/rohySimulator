# Assigning cases

Attach cases from the library to a class so it is clear which scenarios
belong to that class. Assignment is recorded in the cohort–case link
(`cohort_cases`); it does not copy or lock the case.

## Assign cases to a class

1. Open **Settings → Classes** and open the class.
2. Go to the **Settings** tab.
3. Under **Assigned cases**, click **Add cases**.
4. Pick one or more cases from the library picker and click **Assign**.

You can also assign cases at creation time: expand **Add details, cases,
co-teachers & students** in the create form and select cases under
**Assign cases from the library**.

Only live cases in your own tenant can be assigned. If the request includes a
case that is not a valid case in your tenant, the whole assignment is
rejected and nothing is attached.

Assignment is **idempotent and revive-aware**: assigning a case that is
already assigned is a no-op, and re-assigning a case you previously removed
brings the original link back.

## Unassign a case

In the **Settings** tab, under **Assigned cases**, click the **×** next to a
case and confirm. This is a soft delete of the link only — the case itself,
its content, and any sessions students already ran against it are untouched.
Re-assigning the same case later revives the link.

## What assignment does and does not do

- It records the case as belonging to the class and shows it under
  **Assigned cases**.
- It does **not** restrict which cases a student can run, hide unassigned
  cases, or change scoring. Reporting (roster, grid, export) is driven by the
  sessions your students actually ran, not by the assignment list.
- It does **not** snapshot the case. When a student starts a session the case
  is frozen into that session independently — see
  [Glossary — Case snapshot](/reference/glossary).

## Reference

- API: [`POST /api/cohorts/:id/cases`,
  `DELETE /api/cohorts/:id/cases/:caseId`](/reference/api/cohorts)
- Build cases: [Authoring a case (wizard)](/educator/case-wizard)
