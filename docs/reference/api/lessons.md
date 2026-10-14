# lessons API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

19 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/cases/:caseId/course` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:363` |
| `GET` | `/api/cases/:caseId/course-lessons` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:785` |
| `PUT` | `/api/cases/:caseId/course-locks` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:825` |
| `GET` | `/api/courses/case-assignments` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:330` |
| `GET` | `/api/courses/for-case/:caseId` | `authenticateToken` | `server/routes/lessons-routes.js:288` |
| `DELETE` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:509` |
| `GET` | `/api/courses/lectures/:id` | `authenticateToken` | `server/routes/lessons-routes.js:454` |
| `PUT` | `/api/courses/lectures/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:470` |
| `POST` | `/api/courses/lectures/:id/complete` | `authenticateToken` | `server/routes/lessons-routes.js:578` |
| `POST` | `/api/courses/lectures/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:525` |
| `GET` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken` | `server/routes/lessons-routes.js:615` |
| `POST` | `/api/courses/lectures/:lectureId/sections` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:643` |
| `PUT` | `/api/courses/lectures/:lectureId/sections/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:730` |
| `GET` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken` | `server/routes/lessons-routes.js:158` |
| `POST` | `/api/courses/modules/:moduleId/lectures` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:211` |
| `PUT` | `/api/courses/modules/:moduleId/lectures/reorder` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:254` |
| `GET` | `/api/courses/modules/:moduleId/progress` | `authenticateToken` | `server/routes/lessons-routes.js:437` |
| `DELETE` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:714` |
| `PUT` | `/api/courses/sections/:id` | `authenticateToken, requireEducator` | `server/routes/lessons-routes.js:681` |
