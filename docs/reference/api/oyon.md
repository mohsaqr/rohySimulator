# oyon API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/addons/oyon/admin/health` | `authenticateToken` | `server/routes/oyon-routes.js:1283` |
| `GET` | `/api/addons/oyon/admin/live` | `authenticateToken` | `server/routes/oyon-routes.js:1303` |
| `GET` | `/api/addons/oyon/analytics/cases` | `authenticateToken` | `server/routes/oyon-routes.js:1074` |
| `GET` | `/api/addons/oyon/analytics/session/:sessionId` | `authenticateToken` | `server/routes/oyon-routes.js:1144` |
| `GET` | `/api/addons/oyon/analytics/students` | `authenticateToken` | `server/routes/oyon-routes.js:1025` |
| `GET` | `/api/addons/oyon/config` | `authenticateToken` | `server/routes/oyon-routes.js:294` |
| `POST` | `/api/addons/oyon/consent` | `authenticateToken` | `server/routes/oyon-routes.js:434` |
| `GET` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:669` |
| `POST` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:523` |
| `GET` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:321` |
| `PUT` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:326` |
| `GET` | `/api/addons/oyon/signal-events` | `authenticateToken` | `server/routes/oyon-routes.js:972` |
| `POST` | `/api/addons/oyon/signal-events` | `authenticateToken` | `server/routes/oyon-routes.js:857` |
| `GET` | `/api/addons/oyon/signal-windows` | `authenticateToken` | `server/routes/oyon-routes.js:728` |
| `GET` | `/api/addons/oyon/student/me` | `authenticateToken` | `server/routes/oyon-routes.js:1200` |
| `DELETE` | `/api/addons/oyon/student/me/data` | `authenticateToken` | `server/routes/oyon-routes.js:1248` |
| `GET` | `/api/addons/oyon/student/me/data` | `authenticateToken` | `server/routes/oyon-routes.js:1240` |
