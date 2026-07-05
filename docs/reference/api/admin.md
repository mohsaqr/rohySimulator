# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

48 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:140` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:119` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:93` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:966` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:927` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:834` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:889` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:860` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:228` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:178` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:197` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:779` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:214` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:739` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:439` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:374` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:415` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:403` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:486` |
| `POST` | `/api/master/medications` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:515` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:594` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:667` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:537` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:257` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:319` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:299` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:810` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:765` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1056` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:1639` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1659` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1386` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1401` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1121` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1130` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1171` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1210` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1230` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1349` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1363` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1302` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1319` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:995` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1017` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1462` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1500` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:71` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:49` |
