# surveys API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/surveys` | `authenticateToken` | `server/routes/surveys-routes.js:112` |
| `POST` | `/api/surveys` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:165` |
| `DELETE` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:237` |
| `GET` | `/api/surveys/:id` | `authenticateToken` | `server/routes/surveys-routes.js:185` |
| `PUT` | `/api/surveys/:id` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:207` |
| `GET` | `/api/surveys/:id/export` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:616` |
| `GET` | `/api/surveys/:id/my-response` | `authenticateToken` | `server/routes/surveys-routes.js:490` |
| `POST` | `/api/surveys/:id/publish` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:251` |
| `POST` | `/api/surveys/:id/questions` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:286` |
| `DELETE` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:355` |
| `PUT` | `/api/surveys/:id/questions/:questionId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:317` |
| `POST` | `/api/surveys/:id/questions/reorder` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:375` |
| `GET` | `/api/surveys/:id/responses` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:527` |
| `POST` | `/api/surveys/:id/submit` | `authenticateToken` | `server/routes/surveys-routes.js:405` |
| `GET` | `/api/surveys/module/:moduleId` | `authenticateToken` | `server/routes/surveys-routes.js:660` |
| `POST` | `/api/surveys/module/:moduleId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:702` |
| `DELETE` | `/api/surveys/module/:moduleId/:surveyId` | `authenticateToken, requireEducator` | `server/routes/surveys-routes.js:740` |
