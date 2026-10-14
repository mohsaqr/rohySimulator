# surveys API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

18 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/surveys` | `authenticateToken` | `server/routes/surveys-routes.js:117` |
| `POST` | `/api/surveys` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:170` |
| `DELETE` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:242` |
| `GET` | `/api/surveys/:id` | `authenticateToken` | `server/routes/surveys-routes.js:190` |
| `PUT` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:212` |
| `GET` | `/api/surveys/:id/export` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:662` |
| `GET` | `/api/surveys/:id/my-response` | `authenticateToken` | `server/routes/surveys-routes.js:536` |
| `POST` | `/api/surveys/:id/publish` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:256` |
| `POST` | `/api/surveys/:id/questions` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:291` |
| `DELETE` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:360` |
| `PUT` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:322` |
| `POST` | `/api/surveys/:id/questions/:questionId/duplicate` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:387` |
| `POST` | `/api/surveys/:id/questions/reorder` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:432` |
| `GET` | `/api/surveys/:id/responses` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:573` |
| `POST` | `/api/surveys/:id/submit` | `authenticateToken` | `server/routes/surveys-routes.js:462` |
| `GET` | `/api/surveys/module/:moduleId` | `authenticateToken` | `server/routes/surveys-routes.js:706` |
| `POST` | `/api/surveys/module/:moduleId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:748` |
| `DELETE` | `/api/surveys/module/:moduleId/:surveyId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:786` |
