# Lab & medication editors

Use the catalogue editors to add and curate the lab tests and medications
trainees can order. There are **two surfaces over the same data** — this
is deliberate during the catalogue migration, not duplication. Pick the
right one for the task.

## The two surfaces

| Surface | Where | Who | Scope behavior |
|---|---|---|---|
| `/api/master/*` | Legacy settings editors | educator and above | Scope-blind — writes are global to the tenant data set. |
| `/api/catalogue/*` | Scope-aware catalogue | authenticated users | Scope-aware — students may add to their own scope; search proxies live here. |

Both are reachable from **Settings → Lab Tests** and
**Settings → Medications**. Endpoints:
[catalogue API reference](/reference/api/catalogue) and the
`master/*` endpoints in the [admin API reference](/reference/api/admin).

## The scope model

Every catalogue row has a **scope** that decides who can see and edit it:

```text
platform  →  tenant  →  user  →  session
```

- **platform** — visible to all tenants. Granted **only** to admins via
  the `/promote` path; never assigned by a normal write. Shown as the
  **Curated** / **Platform** badge.
- **tenant** — visible to everyone in the tenant. Requires **educator**
  rank or higher in the same tenant. Shown as the **Tenant** badge.
- **user** — visible only to the creator. The default scope for every
  write by anyone. Shown as the **My** badge.
- **session** — transient; purged when the session ends.

A write is pinned to **user** scope unless the caller has the rank to
elevate it. Elevating to **tenant** requires educator+; **platform** is
never granted by a plain write.

## Who can edit a row

Edit/delete authority is centralized (`canMutate()`); a row is mutable if
**any** of these hold:

- You created it (`created_by` is you), **or**
- It is **tenant**-scoped and you are educator+ in that same tenant,
  **or**
- It is **platform**-scoped and you are an admin.

The UI shows an edit affordance only when you can mutate the row, so a
greyed/absent edit button on a Curated row is expected for non-admins.

## Add or edit a lab test

1. Open **Settings → Lab Tests**.
2. Use **Add Test** to create one, or pick a row to edit.
3. Set the clinical fields — test code, name, group, specimen type,
   reference range, critical thresholds, unit, and
   **turnaround minutes** (defaults to the platform default if left
   blank; see [Platform settings](/admin/platform-settings)).
4. Save. You can also **Import Lab Tests from CSV** for bulk loads.

## Add or edit a medication

1. Open **Settings → Medications**.
2. Search for an existing entry or add a new one. The scope-aware
   surface can proxy external sources (RxNorm / openFDA / LOINC) for
   lookups.
3. Edit the fields you need and **Save**. The **scope badge** on each row
   tells you whether it is **Curated/Platform**, **Tenant**, or **My**.

::: tip Default to narrow scope
Leave new entries at **user** scope unless the whole tenant needs them.
Promote to **tenant** only when a class will rely on it, and reserve
**platform** for genuinely cross-tenant clinical content (admin only).
:::
