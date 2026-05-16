# Users & roles (RBAC)

Use this page to create accounts, assign the right role, import a class in
bulk, and force a session to end. All of this is in **Settings → Users**
and requires the **admin** role.

## The rank model

Access in Rohy is **rank comparison, never string equality**. Every role
has a numeric rank and a check is always "rank ≥ N":

```text
guest (0) < student (1) < reviewer (2) < educator (3) < admin (4)
```

| Role | What it can do |
|---|---|
| **guest** | Unauthenticated/preview. Cannot start sessions. |
| **student** | Runs cases. The default role for new accounts. |
| **reviewer** | Student plus view sessions and analytics. Cannot author. |
| **educator** | Owns classes and authors cases. Shown in the UI as **Teacher**. |
| **admin** | Full platform administration. |

`student` and `user` are the same rank — `user` is normalized to
`student`. The educator role is labelled **Teacher** in the UI; the
wire/role name is still `educator`.

::: tip
You can never grant a role higher than your own. An educator-rank actor
cannot mint an admin; the API rejects it with 403.
:::

The authoritative role list and the middleware that enforces it
(`requireAdmin`, `requireEducator`, `requireRole`) are in the
[Glossary](/reference/glossary) and the
[users API reference](/reference/api/users).

## Create a single user

1. Open **Settings → Users**.
2. Fill in **username**, **email**, and **password**. **Name** is
   optional.
3. Pick a **role** (defaults to **student** if you leave it).
4. **Save**.

The password must pass the platform password policy or the request is
rejected with the specific failure listed. A duplicate username or email
returns a conflict — usernames and emails are unique within a tenant.

New users are created in **your** tenant. Cross-tenant creation is not
available from this screen — see
[Multi-tenant operations](/admin/multi-tenant).

## Batch-create users from CSV

Use this to onboard a whole class at once.

1. Open **Settings → Users** and choose the batch/import option.
2. Provide a row per user with **username**, **email**, **password**, and
   optional **name** and **role** (defaults to **student**).
3. Submit.

The result reports **succeeded** and **failed** counts. Each failed row
carries its own reason (missing field, invalid role, password policy,
duplicate, or "cannot grant a role higher than your own"). Valid rows
still import even when others fail — fix the failed rows and re-submit
only those. The batch is recorded in the audit log.

## Edit, delete, and purge

- **Edit** a user from the user list to change name, email, or role.
- **Delete** removes the account. You cannot delete your own account, and
  a user who authored immutable case-version history cannot be deleted
  (the API returns a conflict) — purge or reassign first.
- **Purge** performs a strict erasure: user-authored domain rows are
  soft-deleted, ephemeral rows are physically deleted, log rows are
  anonymized, and the user row is retained but deactivated with PII
  nulled. You cannot purge your own account. Run it with a dry-run first
  to see the row counts before committing.

Endpoints and exact behavior: [users API reference](/reference/api/users).

## Force-logout a session

When you need to end someone's session immediately (shared workstation,
suspected compromise, exam control):

1. Open the active-sessions view under **Settings → Users** /
   admin tools.
2. Find the session by username.
3. Terminate it.

This deactivates the session server-side; the user is signed out on their
next request. The action is written to the audit log as `FORCE_LOGOUT`
with your identity and the source IP. Active sessions are tenant-scoped —
you only see and can terminate sessions in your own tenant.
