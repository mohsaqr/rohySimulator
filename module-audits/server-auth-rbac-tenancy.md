# Server Auth, RBAC, And Tenancy Audit

Files reviewed:
- `server/middleware/auth.js`
- `server/routes.js`
- `server/routes/catalogue.js`

Enterprise assessment:
- JWT validation re-resolves user role, status, deletion state, and tenant from the database on each authenticated request.
- Role hierarchy is centralized in `ROLE_RANKS`; role middleware is composable.
- Catalogue routes use tenant/platform/user scopes and authorization helpers.

Findings:
- Medium: token revocation is not enforced by `authenticateToken`. The module comment notes active sessions exist but are not checked, so logout and admin session termination cannot immediately revoke a still-valid JWT.
- Medium: role and tenant checks are still distributed across a large route file. Central middleware exists, but not every resource read is structurally forced through resource-tenant middleware.
- Low: auth token storage is browser `localStorage` on the client. That increases XSS blast radius compared with HttpOnly secure cookies.

Recommended next tests:
- Add auth middleware tests for inactive user, deleted user, role downgrade, tenant change, malformed bearer header, and expired token.
- Add an integration test proving demoted users lose educator/admin access on the next request without requiring token refresh.
- Add a revocation design test if `active_sessions` becomes authoritative.

Status:
- No code change made in this module during this pass.
