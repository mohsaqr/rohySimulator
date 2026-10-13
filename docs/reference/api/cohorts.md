# cohorts API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

33 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:259` |
| `POST` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:152` |
| `DELETE` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:443` |
| `GET` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:320` |
| `PATCH` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:367` |
| `GET` | `/api/cohorts/:id/analytics/events` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1950` |
| `GET` | `/api/cohorts/:id/analytics/filter-options` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1543` |
| `GET` | `/api/cohorts/:id/analytics/hourly-counts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1914` |
| `GET` | `/api/cohorts/:id/analytics/pulse` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1598` |
| `GET` | `/api/cohorts/:id/analytics/stats` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1925` |
| `GET` | `/api/cohorts/:id/analytics/summary` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1892` |
| `GET` | `/api/cohorts/:id/analytics/timeline-series` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1903` |
| `GET` | `/api/cohorts/:id/analytics/tna-sequences` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1976` |
| `GET` | `/api/cohorts/:id/analytics/top-resources` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1936` |
| `POST` | `/api/cohorts/:id/cases` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:599` |
| `DELETE` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:700` |
| `PATCH` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:727` |
| `GET` | `/api/cohorts/:id/export` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1431` |
| `GET` | `/api/cohorts/:id/feed` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1380` |
| `GET` | `/api/cohorts/:id/grid` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1267` |
| `DELETE` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1020` |
| `POST` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1001` |
| `POST` | `/api/cohorts/:id/members` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:529` |
| `DELETE` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:564` |
| `PATCH` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:782` |
| `POST` | `/api/cohorts/:id/members/bulk` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:836` |
| `GET` | `/api/cohorts/:id/roster` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1221` |
| `GET` | `/api/cohorts/:id/student/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1318` |
| `POST` | `/api/cohorts/:id/teachers` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:939` |
| `DELETE` | `/api/cohorts/:id/teachers/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:972` |
| `POST` | `/api/cohorts/bulk-enroll` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:875` |
| `POST` | `/api/cohorts/join` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:1036` |
| `GET` | `/api/cohorts/mine` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:303` |
