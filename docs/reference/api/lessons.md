# lessons API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/cases/:caseId/course` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:298` |
| `GET` | `/api/courses/case-assignments` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:265` |
| `GET` | `/api/courses/for-case/:caseId` | `authenticateToken` | `server/routes/lessons-routes.js:227` |
| `DELETE` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:425` |
| `GET` | `/api/courses/lectures/:id` | `authenticateToken` | `server/routes/lessons-routes.js:371` |
| `PUT` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:386` |
| `POST` | `/api/courses/lectures/:id/complete` | `authenticateToken` | `server/routes/lessons-routes.js:488` |
| `POST` | `/api/courses/lectures/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:441` |
| `GET` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken` | `server/routes/lessons-routes.js:524` |
| `POST` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:551` |
| `PUT` | `/api/courses/lectures/:lectureId/sections/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:638` |
| `GET` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken` | `server/routes/lessons-routes.js:111` |
| `POST` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:150` |
| `PUT` | `/api/courses/modules/:moduleId/lectures/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:193` |
| `GET` | `/api/courses/modules/:moduleId/progress` | `authenticateToken` | `server/routes/lessons-routes.js:354` |
| `DELETE` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:622` |
| `PUT` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:589` |
