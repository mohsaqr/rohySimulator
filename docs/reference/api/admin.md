# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

57 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:163` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:142` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:116` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:992` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:953` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:857` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:912` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:883` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:251` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:201` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:220` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:802` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:237` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:762` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:462` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:397` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:438` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:426` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:509` |
| `POST` | `/api/master/medications` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:538` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:617` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:690` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:560` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:280` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:342` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:322` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:833` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:788` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1082` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:1897` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1908` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:1973` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1993` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1631` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1646` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1147` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1156` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1224` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1235` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1371` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1410` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1510` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1430` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1594` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1608` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1547` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1564` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1172` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1185` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1331` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1021` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1043` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1693` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1739` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:94` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:72` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1255` |
