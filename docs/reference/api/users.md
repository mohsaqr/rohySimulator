# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

21 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1188` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1208` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1162` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1167` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1182` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:1301` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1243` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1258` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:416` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1017` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:605` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:771` |
| `GET` | `/api/users/:id/detail` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:625` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:922` |
| `PATCH` | `/api/users/:id/status` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:668` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:159` |
| `POST` | `/api/users/bulk-action` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:715` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:94` |
| `POST` | `/api/users/import` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:284` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:463` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:493` |
