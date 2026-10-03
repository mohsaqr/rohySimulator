# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

21 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1029` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1045` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1003` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1008` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1023` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:1128` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1077` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1092` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:347` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:852` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:509` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:652` |
| `GET` | `/api/users/:id/detail` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:529` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:765` |
| `PATCH` | `/api/users/:id/status` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:572` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:118` |
| `POST` | `/api/users/bulk-action` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:604` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:64` |
| `POST` | `/api/users/import` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:233` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:394` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:424` |
