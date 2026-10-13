# users API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

21 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/active-sessions` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1066` |
| `DELETE` | `/api/admin/active-sessions/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1082` |
| `GET` | `/api/admin/audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1040` |
| `GET` | `/api/admin/audit/verify` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1045` |
| `GET` | `/api/system-audit-log` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:1060` |
| `PUT` | `/api/user/password` | `authenticateToken` | `server/routes/users-routes.js:1172` |
| `GET` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1114` |
| `PUT` | `/api/user/profile` | `authenticateToken` | `server/routes/users-routes.js:1129` |
| `GET` | `/api/users` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:360` |
| `DELETE` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:887` |
| `GET` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:534` |
| `PUT` | `/api/users/:id` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:677` |
| `GET` | `/api/users/:id/detail` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:554` |
| `POST` | `/api/users/:id/purge` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:797` |
| `PATCH` | `/api/users/:id/status` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:597` |
| `POST` | `/api/users/batch` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:119` |
| `POST` | `/api/users/bulk-action` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:629` |
| `POST` | `/api/users/create` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:65` |
| `POST` | `/api/users/import` | `authenticateToken, requireAdmin` | `server/routes/users-routes.js:234` |
| `GET` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:407` |
| `PUT` | `/api/users/preferences` | `authenticateToken` | `server/routes/users-routes.js:437` |
