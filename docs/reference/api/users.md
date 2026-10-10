# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

21 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1061` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1077` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1035` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1040` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1055` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:1167` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1109` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1124` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:357` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:884` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:531` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:674` |
| `GET` | `/api/users/:id/detail` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:551` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:794` |
| `PATCH` | `/api/users/:id/status` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:594` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:119` |
| `POST` | `/api/users/bulk-action` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:626` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:65` |
| `POST` | `/api/users/import` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:234` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:404` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:434` |
