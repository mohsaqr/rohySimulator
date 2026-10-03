# admin API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

57 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/admin/database-stats` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:165` |
| `GET` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:144` |
| `POST` | `/api/admin/export-records` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:118` |
| `POST` | `/api/admin/seed/all` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1004` |
| `POST` | `/api/admin/seed/body-regions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:965` |
| `POST` | `/api/admin/seed/exam-techniques` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:869` |
| `POST` | `/api/admin/seed/lab-tests` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:924` |
| `POST` | `/api/admin/seed/vital-definitions` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:895` |
| `GET` | `/api/master/body-map-coordinates` | `(none)` | `server/routes/admin-routes.js:255` |
| `GET` | `/api/master/body-regions` | `(none)` | `server/routes/admin-routes.js:203` |
| `POST` | `/api/master/body-regions` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:222` |
| `GET` | `/api/master/diagnoses` | `(none)` | `server/routes/admin-routes.js:814` |
| `GET` | `/api/master/exam-techniques` | `(none)` | `server/routes/admin-routes.js:241` |
| `GET` | `/api/master/investigation-templates` | `(none)` | `server/routes/admin-routes.js:774` |
| `GET` | `/api/master/lab-panels` | `(none)` | `server/routes/admin-routes.js:470` |
| `GET` | `/api/master/lab-tests` | `(none)` | `server/routes/admin-routes.js:403` |
| `POST` | `/api/master/lab-tests` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:444` |
| `GET` | `/api/master/lab-tests/groups` | `(none)` | `server/routes/admin-routes.js:432` |
| `GET` | `/api/master/medications` | `(none)` | `server/routes/admin-routes.js:517` |
| `POST` | `/api/master/medications` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:546` |
| `DELETE` | `/api/master/medications/:id` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:627` |
| `DELETE` | `/api/master/medications/all` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:701` |
| `POST` | `/api/master/medications/bulk` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:570` |
| `GET` | `/api/master/scenario-templates` | `(none)` | `server/routes/admin-routes.js:284` |
| `POST` | `/api/master/scenario-templates` | `authenticateToken, requireEducator` | `server/routes/admin-routes.js:346` |
| `GET` | `/api/master/scenario-templates/:id` | `(none)` | `server/routes/admin-routes.js:326` |
| `GET` | `/api/master/search-aliases` | `(none)` | `server/routes/admin-routes.js:845` |
| `GET` | `/api/master/vital-sign-definitions` | `(none)` | `server/routes/admin-routes.js:800` |
| `GET` | `/api/platform-settings` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1099` |
| `GET` | `/api/platform-settings/affect` | `authenticateToken` | `server/routes/admin-routes.js:1938` |
| `PUT` | `/api/platform-settings/affect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1949` |
| `GET` | `/api/platform-settings/avatars` | `authenticateToken` | `server/routes/admin-routes.js:2014` |
| `PUT` | `/api/platform-settings/avatars` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:2034` |
| `GET` | `/api/platform-settings/chat` | `authenticateToken` | `server/routes/admin-routes.js:1672` |
| `PUT` | `/api/platform-settings/chat` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1687` |
| `GET` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1164` |
| `PUT` | `/api/platform-settings/cohort-case-enforcement` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1173` |
| `GET` | `/api/platform-settings/language` | `(none)` | `server/routes/admin-routes.js:1241` |
| `PUT` | `/api/platform-settings/language` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1252` |
| `GET` | `/api/platform-settings/llm` | `authenticateToken` | `server/routes/admin-routes.js:1388` |
| `PUT` | `/api/platform-settings/llm` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1427` |
| `POST` | `/api/platform-settings/llm/models/detect` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1527` |
| `POST` | `/api/platform-settings/llm/test` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1447` |
| `GET` | `/api/platform-settings/monitor` | `(none)` | `server/routes/admin-routes.js:1635` |
| `PUT` | `/api/platform-settings/monitor` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1649` |
| `GET` | `/api/platform-settings/rate-limits` | `authenticateToken` | `server/routes/admin-routes.js:1588` |
| `PUT` | `/api/platform-settings/rate-limits` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1605` |
| `GET` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1189` |
| `PUT` | `/api/platform-settings/registration` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1202` |
| `PUT` | `/api/platform-settings/setup` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1348` |
| `GET` | `/api/platform-settings/user-fields` | `authenticateToken` | `server/routes/admin-routes.js:1038` |
| `PUT` | `/api/platform-settings/user-fields` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1060` |
| `GET` | `/api/platform-settings/voice` | `authenticateToken` | `server/routes/admin-routes.js:1734` |
| `PUT` | `/api/platform-settings/voice` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1780` |
| `GET` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:96` |
| `POST` | `/api/sessions/:sessionId/notes` | `authenticateToken` | `server/routes/admin-routes.js:74` |
| `GET` | `/api/setup/status` | `authenticateToken, requireAdmin` | `server/routes/admin-routes.js:1272` |
