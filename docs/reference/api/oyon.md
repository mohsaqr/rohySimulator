# oyon API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

12 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/addons/oyon/admin/health` | `authenticateToken` | `server/routes/oyon-routes.js:519` |
| `GET` | `/api/addons/oyon/admin/live` | `authenticateToken` | `server/routes/oyon-routes.js:539` |
| `GET` | `/api/addons/oyon/analytics/cases` | `authenticateToken` | `server/routes/oyon-routes.js:378` |
| `GET` | `/api/addons/oyon/analytics/session/:sessionId` | `authenticateToken` | `server/routes/oyon-routes.js:447` |
| `GET` | `/api/addons/oyon/analytics/students` | `authenticateToken` | `server/routes/oyon-routes.js:330` |
| `GET` | `/api/addons/oyon/config` | `authenticateToken` | `server/routes/oyon-routes.js:53` |
| `POST` | `/api/addons/oyon/consent` | `authenticateToken` | `server/routes/oyon-routes.js:153` |
| `GET` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:275` |
| `POST` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:216` |
| `GET` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:72` |
| `PUT` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:77` |
| `GET` | `/api/addons/oyon/student/me` | `authenticateToken` | `server/routes/oyon-routes.js:503` |
