# lessons API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

19 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/cases/:caseId/course` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:357` |
| `GET` | `/api/cases/:caseId/course-lessons` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:773` |
| `PUT` | `/api/cases/:caseId/course-locks` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:807` |
| `GET` | `/api/courses/case-assignments` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:324` |
| `GET` | `/api/courses/for-case/:caseId` | `authenticateToken` | `server/routes/lessons-routes.js:286` |
| `DELETE` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:503` |
| `GET` | `/api/courses/lectures/:id` | `authenticateToken` | `server/routes/lessons-routes.js:448` |
| `PUT` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:464` |
| `POST` | `/api/courses/lectures/:id/complete` | `authenticateToken` | `server/routes/lessons-routes.js:566` |
| `POST` | `/api/courses/lectures/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:519` |
| `GET` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken` | `server/routes/lessons-routes.js:603` |
| `POST` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:631` |
| `PUT` | `/api/courses/lectures/:lectureId/sections/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:718` |
| `GET` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken` | `server/routes/lessons-routes.js:157` |
| `POST` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:209` |
| `PUT` | `/api/courses/modules/:moduleId/lectures/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:252` |
| `GET` | `/api/courses/modules/:moduleId/progress` | `authenticateToken` | `server/routes/lessons-routes.js:431` |
| `DELETE` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:702` |
| `PUT` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:669` |
