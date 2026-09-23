# cases API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases` | `authenticateToken` | `server/routes/cases-routes.js:218` |
| `POST` | `/api/cases` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:403` |
| `POST` | `/api/cases/:caseId/restore/:versionId` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1290` |
| `GET` | `/api/cases/:caseId/versions` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1260` |
| `DELETE` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:592` |
| `GET` | `/api/cases/:id` | `authenticateToken` | `server/routes/cases-routes.js:294` |
| `PUT` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:501` |
| `PUT` | `/api/cases/:id/availability` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:326` |
| `PUT` | `/api/cases/:id/default` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:352` |
| `GET` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:633` |
| `POST` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:888` |
| `DELETE` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:996` |
| `GET` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:669` |
| `PUT` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:936` |
| `POST` | `/api/scenarios/seed` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1028` |
| `GET` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:1237` |
| `POST` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:1174` |
