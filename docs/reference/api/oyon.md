# oyon API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

15 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/addons/oyon/admin/health` | `authenticateToken` | `server/routes/oyon-routes.js:1008` |
| `GET` | `/api/addons/oyon/admin/live` | `authenticateToken` | `server/routes/oyon-routes.js:1028` |
| `GET` | `/api/addons/oyon/analytics/cases` | `authenticateToken` | `server/routes/oyon-routes.js:867` |
| `GET` | `/api/addons/oyon/analytics/session/:sessionId` | `authenticateToken` | `server/routes/oyon-routes.js:936` |
| `GET` | `/api/addons/oyon/analytics/students` | `authenticateToken` | `server/routes/oyon-routes.js:819` |
| `GET` | `/api/addons/oyon/config` | `authenticateToken` | `server/routes/oyon-routes.js:167` |
| `POST` | `/api/addons/oyon/consent` | `authenticateToken` | `server/routes/oyon-routes.js:299` |
| `GET` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:493` |
| `POST` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:367` |
| `GET` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:186` |
| `PUT` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:191` |
| `GET` | `/api/addons/oyon/signal-events` | `authenticateToken` | `server/routes/oyon-routes.js:769` |
| `POST` | `/api/addons/oyon/signal-events` | `authenticateToken` | `server/routes/oyon-routes.js:678` |
| `GET` | `/api/addons/oyon/signal-windows` | `authenticateToken` | `server/routes/oyon-routes.js:551` |
| `GET` | `/api/addons/oyon/student/me` | `authenticateToken` | `server/routes/oyon-routes.js:992` |
