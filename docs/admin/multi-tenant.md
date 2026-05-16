# Multi-tenant operations

Use this page when one Rohy deployment serves more than one organization.
A **tenant** is the isolation boundary: users, sessions, cohorts,
catalogue rows, and logs all carry a `tenant_id`, and admins are
tenant-local by design.

All tenant operations require the **admin** role. Endpoints are in the
[tenants API reference](/reference/api/tenants).

## What a tenant isolates

Tenant scoping is enforced by middleware (`requireSameTenant`), not by
ad-hoc filters in each handler. In practice this means:

- **Users** are created in, listed from, and deleted within your tenant
  only. The user list query is `WHERE tenant_id = <yours>`.
- **Active sessions** are visible and force-loggable only within your
  tenant.
- **Cohorts (classes)** belong to a tenant; a teacher in one tenant never
  sees another tenant's classes.
- **Catalogue** rows are tenant-scoped unless promoted to **platform**
  scope (admin-only) — see
  [Lab &amp; medication editors](/admin/catalogue-editors).
- **Audit and activity logs** are tenant-scoped.

A fresh install has a single default tenant. Pre-feature activity is kept
visible via the per-tenant **Base Class** backfill (a system cohort, not a
user-created one).

## Create a tenant

1. Open the admin tenant tools.
2. Provide a **slug** — 2–63 characters, lowercase letters, numbers, or
   hyphens, starting with a letter or number.
3. Provide a display **name**.
4. Submit. A duplicate slug returns a conflict.

The slug is the stable identifier; the name is the human label. Treat the
tenant as the deployment's identity — there is no separate facility-name
setting (see [Platform settings](/admin/platform-settings)).

## Assign a user to a tenant

A minimal assignment hook moves a user's `tenant_id`. Use it for
controlled admin moves only:

1. Identify the target user and the destination tenant.
2. Assign via the user-tenant endpoint
   ([tenants API reference](/reference/api/tenants)).

::: danger Ownership does not move with the user
The assignment hook changes only the user's `tenant_id`. It does **not**
re-home the resources that user authored (cases, catalogue rows,
sessions). Full migration tooling is deliberately deferred. Reassigning a
user who owns content will strand that content in the old tenant. Plan a
content move out of band before reassigning an author.
:::

## Per-tenant configuration

There is no separate per-tenant settings screen. What is genuinely
per-tenant today:

- The tenant's **slug** and **name**.
- The set of **users**, **cohorts**, **sessions**, and **logs** scoped to
  it.
- **Catalogue** rows created at **tenant** scope.

Platform settings (LLM, voice, notifications, turnaround default) are
deployment-wide, not per-tenant. If two organizations need different LLM
keys or voice providers, run separate deployments rather than expecting
per-tenant overrides.

## Operational notes

- Admins are tenant-local. There is no cross-tenant super-admin view —
  to administer another tenant you need an admin account in that tenant.
- Cross-tenant bulk user migration is explicitly out of scope; do not
  script around the single-user assignment hook for large moves.
