# oyon API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

13 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/addons/oyon/admin/health` | `authenticateToken` | `server/routes/oyon-routes.js:800` |
| `GET` | `/api/addons/oyon/admin/live` | `authenticateToken` | `server/routes/oyon-routes.js:820` |
| `GET` | `/api/addons/oyon/analytics/cases` | `authenticateToken` | `server/routes/oyon-routes.js:659` |
| `GET` | `/api/addons/oyon/analytics/session/:sessionId` | `authenticateToken` | `server/routes/oyon-routes.js:728` |
| `GET` | `/api/addons/oyon/analytics/students` | `authenticateToken` | `server/routes/oyon-routes.js:611` |
| `GET` | `/api/addons/oyon/config` | `authenticateToken` | `server/routes/oyon-routes.js:152` |
| `POST` | `/api/addons/oyon/consent` | `authenticateToken` | `server/routes/oyon-routes.js:284` |
| `GET` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:478` |
| `POST` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:352` |
| `GET` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:171` |
| `PUT` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:176` |
| `GET` | `/api/addons/oyon/signal-windows` | `authenticateToken` | `server/routes/oyon-routes.js:536` |
| `GET` | `/api/addons/oyon/student/me` | `authenticateToken` | `server/routes/oyon-routes.js:784` |
