# lessons API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

20 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/cases/:caseId/course` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:488` |
| `GET` | `/api/cases/:caseId/course-lessons` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:954` |
| `PUT` | `/api/cases/:caseId/course-locks` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:994` |
| `GET` | `/api/courses/case-assignments` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:455` |
| `GET` | `/api/courses/for-case/:caseId` | `authenticateToken` | `server/routes/lessons-routes.js:413` |
| `DELETE` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:678` |
| `GET` | `/api/courses/lectures/:id` | `authenticateToken` | `server/routes/lessons-routes.js:579` |
| `PUT` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:639` |
| `POST` | `/api/courses/lectures/:id/complete` | `authenticateToken` | `server/routes/lessons-routes.js:747` |
| `POST` | `/api/courses/lectures/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:694` |
| `POST` | `/api/courses/lectures/:lectureId/mcq/check` | `authenticateToken` | `server/routes/lessons-routes.js:602` |
| `GET` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken` | `server/routes/lessons-routes.js:784` |
| `POST` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:812` |
| `PUT` | `/api/courses/lectures/:lectureId/sections/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:899` |
| `GET` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken` | `server/routes/lessons-routes.js:283` |
| `POST` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:336` |
| `PUT` | `/api/courses/modules/:moduleId/lectures/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:379` |
| `GET` | `/api/courses/modules/:moduleId/progress` | `authenticateToken` | `server/routes/lessons-routes.js:562` |
| `DELETE` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:883` |
| `PUT` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:850` |
