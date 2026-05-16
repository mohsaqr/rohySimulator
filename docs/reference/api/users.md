# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:666` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:682` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:640` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:645` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:660` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:765` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:714` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:729` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:217` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:503` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:308` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:331` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:416` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:109` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:55` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:234` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:255` |
