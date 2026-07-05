# cohorts API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

31 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:273` |
| `POST` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:169` |
| `DELETE` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:404` |
| `GET` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:296` |
| `PATCH` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:333` |
| `GET` | `/api/cohorts/:id/analytics/filter-options` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1449` |
| `GET` | `/api/cohorts/:id/analytics/hourly-counts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1808` |
| `GET` | `/api/cohorts/:id/analytics/pulse` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1492` |
| `GET` | `/api/cohorts/:id/analytics/stats` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1819` |
| `GET` | `/api/cohorts/:id/analytics/summary` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1786` |
| `GET` | `/api/cohorts/:id/analytics/timeline-series` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1797` |
| `GET` | `/api/cohorts/:id/analytics/tna-sequences` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1842` |
| `GET` | `/api/cohorts/:id/analytics/top-resources` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1830` |
| `POST` | `/api/cohorts/:id/cases` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:560` |
| `DELETE` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:661` |
| `PATCH` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:688` |
| `GET` | `/api/cohorts/:id/export` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1338` |
| `GET` | `/api/cohorts/:id/feed` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1287` |
| `GET` | `/api/cohorts/:id/grid` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1174` |
| `DELETE` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:961` |
| `POST` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:942` |
| `POST` | `/api/cohorts/:id/members` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:490` |
| `DELETE` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:525` |
| `PATCH` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:723` |
| `POST` | `/api/cohorts/:id/members/bulk` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:777` |
| `GET` | `/api/cohorts/:id/roster` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1128` |
| `GET` | `/api/cohorts/:id/student/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1225` |
| `POST` | `/api/cohorts/:id/teachers` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:880` |
| `DELETE` | `/api/cohorts/:id/teachers/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:913` |
| `POST` | `/api/cohorts/bulk-enroll` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:816` |
| `POST` | `/api/cohorts/join` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:977` |
