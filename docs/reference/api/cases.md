# cases API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases` | `authenticateToken` | `server/routes/cases-routes.js:274` |
| `POST` | `/api/cases` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:461` |
| `POST` | `/api/cases/:caseId/restore/:versionId` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1392` |
| `GET` | `/api/cases/:caseId/versions` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1362` |
| `DELETE` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:674` |
| `GET` | `/api/cases/:id` | `authenticateToken` | `server/routes/cases-routes.js:352` |
| `PUT` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:565` |
| `PUT` | `/api/cases/:id/availability` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:384` |
| `PUT` | `/api/cases/:id/default` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:410` |
| `GET` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:715` |
| `POST` | `/api/scenarios` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:980` |
| `DELETE` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:1088` |
| `GET` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:751` |
| `PUT` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:1028` |
| `POST` | `/api/scenarios/seed` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:1120` |
| `GET` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:1339` |
| `POST` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:1266` |
