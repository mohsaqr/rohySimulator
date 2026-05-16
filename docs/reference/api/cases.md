# cases API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases` | `authenticateToken` | `server/routes/cases-routes.js:53` |
| `POST` | `/api/cases` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:192` |
| `POST` | `/api/cases/:caseId/restore/:versionId` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:824` |
| `GET` | `/api/cases/:caseId/versions` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:806` |
| `DELETE` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:363` |
| `GET` | `/api/cases/:id` | `authenticateToken` | `server/routes/cases-routes.js:97` |
| `PUT` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:274` |
| `PUT` | `/api/cases/:id/availability` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:115` |
| `PUT` | `/api/cases/:id/default` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:141` |
| `GET` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:404` |
| `POST` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:485` |
| `DELETE` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:578` |
| `GET` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:431` |
| `PUT` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:526` |
| `POST` | `/api/scenarios/seed` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:610` |
| `GET` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:788` |
| `POST` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:738` |
