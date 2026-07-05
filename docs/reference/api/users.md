# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

21 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:970` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:986` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:944` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:949` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:964` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:1069` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1018` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1033` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:354` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:807` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:475` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:618` |
| `GET` | `/api/users/:id/detail` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:495` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:720` |
| `PATCH` | `/api/users/:id/status` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:538` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:110` |
| `POST` | `/api/users/bulk-action` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:570` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:56` |
| `POST` | `/api/users/import` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:240` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:401` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:422` |
