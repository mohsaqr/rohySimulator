# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

57 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:167` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:146` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:120` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1006` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:967` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:871` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:926` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:897` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:257` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:205` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:224` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:816` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:243` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:776` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:472` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:405` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:446` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:434` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:519` |
| `POST` | `/api/master/medications` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:548` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:629` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:703` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:572` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:286` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:348` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:328` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:847` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:802` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1101` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:1978` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1989` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2054` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2074` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1712` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1727` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1179` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1188` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1256` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1267` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1406` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1455` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1561` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1475` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1669` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1683` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1622` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1639` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1204` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1217` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1366` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1040` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1062` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1774` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1820` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:98` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:76` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1287` |
