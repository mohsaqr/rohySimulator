# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

58 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:174` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:153` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:127` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1013` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:974` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:878` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:933` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:904` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:264` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:212` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:231` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:823` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:250` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:783` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:479` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:412` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:453` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:441` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:526` |
| `POST` | `/api/master/medications` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:555` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:636` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:710` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:579` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:293` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:355` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:335` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:854` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:809` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1108` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:2086` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2097` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2162` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2182` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1733` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1748` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1186` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1195` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1263` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1274` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1413` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1464` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1578` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1488` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1690` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1704` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1643` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1660` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1211` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1224` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1373` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1047` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1069` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1795` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1863` |
| `POST` | `/api/platform-settings/voice/kokoro-remote/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2052` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:105` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:83` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1294` |
