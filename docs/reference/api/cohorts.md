# cohorts API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

26 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:255` |
| `POST` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:151` |
| `DELETE` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:385` |
| `GET` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:278` |
| `PATCH` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:314` |
| `GET` | `/api/cohorts/:id/analytics/filter-options` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1135` |
| `GET` | `/api/cohorts/:id/analytics/hourly-counts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1194` |
| `GET` | `/api/cohorts/:id/analytics/stats` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1205` |
| `GET` | `/api/cohorts/:id/analytics/summary` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1172` |
| `GET` | `/api/cohorts/:id/analytics/timeline-series` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1183` |
| `GET` | `/api/cohorts/:id/analytics/tna-sequences` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1228` |
| `GET` | `/api/cohorts/:id/analytics/top-resources` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1216` |
| `POST` | `/api/cohorts/:id/cases` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:533` |
| `DELETE` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:595` |
| `GET` | `/api/cohorts/:id/export` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1024` |
| `GET` | `/api/cohorts/:id/feed` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:973` |
| `GET` | `/api/cohorts/:id/grid` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:864` |
| `DELETE` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:705` |
| `POST` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:686` |
| `POST` | `/api/cohorts/:id/members` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:463` |
| `DELETE` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:498` |
| `GET` | `/api/cohorts/:id/roster` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:818` |
| `GET` | `/api/cohorts/:id/student/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:915` |
| `POST` | `/api/cohorts/:id/teachers` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:624` |
| `DELETE` | `/api/cohorts/:id/teachers/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:657` |
| `POST` | `/api/cohorts/join` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:721` |
