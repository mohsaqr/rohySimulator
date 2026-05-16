# RBAC &amp; auth model

How Rohy authenticates a request, what a role can do, and how access is
revoked. Everything here is enforced in `server/middleware/auth.js`.

## The rank model

Access is **rank comparison, never string equality**. A check is "rank ≥ N",
not "role == name". The frozen rank table (`ROLE_RANKS` in
`server/middleware/auth.js`):

| Rank | Role | Notes |
|---|---|---|
| 0 | `guest` | Unauthenticated / preview; cannot start sessions |
| 1 | `student` (alias `user`) | Runs cases; `user` normalizes to `student` |
| 2 | `reviewer` | Read-only sessions + analytics; cannot author |
| 3 | `educator` | Authors cases, scenarios, agents, catalogues; owns classes. Surfaced in the UI as **Teacher** — only the label changed, the wire/role name is still `educator` |
| 4 | `admin` | Full platform administration, user management, audit, purge |

`VALID_ROLES` is `['guest', 'student', 'reviewer', 'educator', 'admin']`.
`normalizeRole()` maps the legacy `user` role onto `student`; an unknown role
resolves to `guest` rank (fail-closed).

See the [Glossary](/reference/glossary) for the canonical wording of each
role, and [Roles &amp; access in the config reference](/reference/config/) for
where role-bearing env vars are read.

## Middleware enforcement

Routes never compare role strings. They mount one of the convenience
wrappers, each of which is `requireRole(minRank)` with a fixed minimum:

- `requireAuth` — authenticated, any rank
- `requireStudent` — rank ≥ 1
- `requireReviewer` — rank ≥ 2
- `requireEducator` — rank ≥ 3
- `requireAdmin` — rank ≥ 4

In-handler decisions use the predicate `hasRoleAtLeast(user, ROLE_RANKS.x)`.
`requireRole` returns **401** when no authenticated user is present and
**403** ("Insufficient role") when the user is authenticated but
under-ranked. The endpoint-by-endpoint mapping is in the generated
[API reference](/reference/api/).

### Token extraction and validation

`authenticateToken` runs a two-stage check:

1. **JWT signature + expiry** — verified in-memory against `JWT_SECRET`.
   The server **refuses to start** if `JWT_SECRET` is unset (it logs a
   FATAL message and calls `process.exit(1)`). A present-but-malformed
   `Authorization` header returns **400** with a `code` (e.g.
   `unsupported-scheme`, `empty-token`, `whitespace-in-token`) so an
   operator can tell a client bug from an unauthenticated request. The
   token may arrive in the `Authorization: Bearer` header (legacy) or the
   HttpOnly `rohy_auth` cookie; the header wins when both are present.
2. **Server-side revocation + live user state** — see below.

### Role and tenant refresh on every request

After the JWT verifies, `authenticateToken` re-reads
`tenant_id, role, status, deleted_at` from the `users` table. If the row is
missing, soft-deleted (`deleted_at` set), or `status !== 'active'`, the
request is rejected **403** ("Invalid or inactive user"). `req.user.role`
and `req.user.tenant_id` are taken from the live row, **not** from the JWT
payload.

::: tip
This means a demotion, suspension, or tenant reassignment takes effect on
the user's **next request** — there is no need to wait for the JWT to
expire. A still-cryptographically-valid token cannot outrank the live
`users` row.
:::

## requireSameTenant

Tenant isolation is enforced by middleware, not ad-hoc `WHERE tenant_id=`
in handlers. `requireSameTenant(resourceTenantIdGetter)` resolves the
resource's tenant, compares it numerically to `resolveTenant(req)` (the
authenticated user's `tenant_id`, defaulting to `1`), and:

- returns **404** ("Resource not found") if the resource tenant is `null`
  (do not leak existence across tenants),
- returns **403** ("Access denied: tenant mismatch") on a mismatch,
- otherwise calls `next()`.

Single-tenant deployments still operate under tenant `id=1`, so the check is
always live.

## Immediate revocation via `active_sessions`

JWTs are stateless, so Rohy adds a server-side revocation table. On login,
`recordActiveSession()` inserts a row into `active_sessions` keyed by the
**SHA-256 hash of the token** (`token_hash`, `UNIQUE`), with `is_active = 1`
and an `expires_at` (default `+4 hours`). The raw token is never stored —
only its hash.

On every authenticated request, `authenticateToken` looks up the token hash:

- **Row exists and `is_active = 0`** → **401** "Session revoked", even though
  the JWT itself is still cryptographically valid.
- **Row exists and `expires_at` is in the past** (parsed as UTC) → **401**
  "Session expired".
- **Row exists and active** → `last_activity_at` is touched (best-effort,
  non-fatal) and the request proceeds.
- **No row** → legacy token issued before this table existed; accepted for
  backward compatibility. The 4 h JWT TTL bounds the worst-case window for
  these, since they have no row to revoke.

Revocation is a single `UPDATE active_sessions SET is_active = 0 WHERE
token_hash = ?` (`revokeActiveSessionByToken` / `revokeActiveSessionByHash`).
This is what makes logout, admin force-logout, and password change take
effect **immediately** rather than at token expiry.

::: warning
The `JWT_SECRET` value gates every signature check and the audit token
path. Rotating it invalidates **all** sessions at once — see the
[Hardening checklist](/security/hardening). Treat it as the single most
sensitive secret in the deployment.
:::

## CSRF

Cookie-authenticated state-changing requests must present a matching
`X-CSRF-Token` header (`csrfRequired` / `verifyCsrf`). Bearer-header
requests are exempt because an attacker cannot auto-attach `Authorization`
headers cross-site. A failed CSRF check rejects before the handler runs.

## Verifying RBAC posture

`bash scripts/audit-rbac.sh` boots an isolated server, exercises protected
routes with and without tokens, and asserts the rank gates hold. Run it as
part of the deploy verification described in the
[Hardening checklist](/security/hardening).
