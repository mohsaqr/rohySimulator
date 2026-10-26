# surveys API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

18 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/surveys` | `authenticateToken` | `server/routes/surveys-routes.js:183` |
| `POST` | `/api/surveys` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:236` |
| `DELETE` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:308` |
| `GET` | `/api/surveys/:id` | `authenticateToken` | `server/routes/surveys-routes.js:256` |
| `PUT` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:278` |
| `GET` | `/api/surveys/:id/export` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:759` |
| `GET` | `/api/surveys/:id/my-response` | `authenticateToken` | `server/routes/surveys-routes.js:620` |
| `POST` | `/api/surveys/:id/publish` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:322` |
| `POST` | `/api/surveys/:id/questions` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:357` |
| `DELETE` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:426` |
| `PUT` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:388` |
| `POST` | `/api/surveys/:id/questions/:questionId/duplicate` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:453` |
| `POST` | `/api/surveys/:id/questions/reorder` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:498` |
| `GET` | `/api/surveys/:id/responses` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:670` |
| `POST` | `/api/surveys/:id/submit` | `authenticateToken` | `server/routes/surveys-routes.js:528` |
| `GET` | `/api/surveys/module/:moduleId` | `authenticateToken` | `server/routes/surveys-routes.js:803` |
| `POST` | `/api/surveys/module/:moduleId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:845` |
| `DELETE` | `/api/surveys/module/:moduleId/:surveyId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:883` |
