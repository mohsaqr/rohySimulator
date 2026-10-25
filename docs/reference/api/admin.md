# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

58 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:182` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:159` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:132` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1038` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:999` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:903` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:958` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:929` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:276` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:220` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:243` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:845` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:262` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:805` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:498` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:428` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:472` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:460` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:545` |
| `POST` | `/api/master/medications` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:577` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:658` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:732` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:601` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:305` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:367` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:347` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:879` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:831` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1138` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:2186` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:2197` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2262` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2282` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1816` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1831` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1216` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken` | `server/routes/admin-routes.js:1225` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1293` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken` | `server/routes/admin-routes.js:1304` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1443` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1494` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken` | `server/routes/admin-routes.js:1662` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken` | `server/routes/admin-routes.js:1567` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1773` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken` | `server/routes/admin-routes.js:1787` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1726` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1743` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1241` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken` | `server/routes/admin-routes.js:1254` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken` | `server/routes/admin-routes.js:1403` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1072` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1094` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1878` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1946` |
| `POST` | `/api/platform-settings/voice/kokoro-remote/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2151` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:110` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:88` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1324` |
