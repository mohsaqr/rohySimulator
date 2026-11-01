# surveys API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

18 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/surveys` | `authenticateToken` | `server/routes/surveys-routes.js:212` |
| `POST` | `/api/surveys` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:265` |
| `DELETE` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:337` |
| `GET` | `/api/surveys/:id` | `authenticateToken` | `server/routes/surveys-routes.js:285` |
| `PUT` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:307` |
| `GET` | `/api/surveys/:id/export` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:788` |
| `GET` | `/api/surveys/:id/my-response` | `authenticateToken` | `server/routes/surveys-routes.js:649` |
| `POST` | `/api/surveys/:id/publish` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:351` |
| `POST` | `/api/surveys/:id/questions` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:386` |
| `DELETE` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:455` |
| `PUT` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:417` |
| `POST` | `/api/surveys/:id/questions/:questionId/duplicate` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:482` |
| `POST` | `/api/surveys/:id/questions/reorder` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:527` |
| `GET` | `/api/surveys/:id/responses` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:699` |
| `POST` | `/api/surveys/:id/submit` | `authenticateToken` | `server/routes/surveys-routes.js:557` |
| `GET` | `/api/surveys/module/:moduleId` | `authenticateToken` | `server/routes/surveys-routes.js:832` |
| `POST` | `/api/surveys/module/:moduleId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:878` |
| `DELETE` | `/api/surveys/module/:moduleId/:surveyId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:916` |
