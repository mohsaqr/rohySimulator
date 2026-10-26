# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

58 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:188` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:161` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:134` |
| `POST` | `/api/admin/seed/all` | `authenticateToken` | `server/routes/admin-routes.js:989` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken` | `server/routes/admin-routes.js:950` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken` | `server/routes/admin-routes.js:854` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken` | `server/routes/admin-routes.js:909` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken` | `server/routes/admin-routes.js:880` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:290` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:234` |
| `POST` | `/api/master/body-regions` | `authenticateToken` | `server/routes/admin-routes.js:257` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:796` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:276` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:756` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:515` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:442` |
| `POST` | `/api/master/lab-tests` | `authenticateToken` | `server/routes/admin-routes.js:489` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:477` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:562` |
| `POST` | `/api/master/medications` | `authenticateToken` | `server/routes/admin-routes.js:595` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken` | `server/routes/admin-routes.js:722` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken` | `server/routes/admin-routes.js:700` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken` | `server/routes/admin-routes.js:626` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:319` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken` | `server/routes/admin-routes.js:381` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:361` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:830` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:782` |
| `GET` | `/api/platform-settings` | `authenticateToken` | `server/routes/admin-routes.js:1090` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:2148` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:2159` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2224` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2244` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1776` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1791` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1177` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken` | `server/routes/admin-routes.js:1186` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1254` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken` | `server/routes/admin-routes.js:1265` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1398` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1455` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken` | `server/routes/admin-routes.js:1623` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken` | `server/routes/admin-routes.js:1528` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1733` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken` | `server/routes/admin-routes.js:1747` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1690` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1699` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1202` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken` | `server/routes/admin-routes.js:1215` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken` | `server/routes/admin-routes.js:1366` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1023` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1045` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1838` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1908` |
| `POST` | `/api/platform-settings/voice/kokoro-remote/test` | `authenticateToken` | `server/routes/admin-routes.js:2113` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:112` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:90` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1285` |
