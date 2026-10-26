# cohorts API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

33 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:281` |
| `POST` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:167` |
| `DELETE` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:473` |
| `GET` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:346` |
| `PATCH` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:393` |
| `GET` | `/api/cohorts/:id/analytics/events` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1988` |
| `GET` | `/api/cohorts/:id/analytics/filter-options` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1581` |
| `GET` | `/api/cohorts/:id/analytics/hourly-counts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1952` |
| `GET` | `/api/cohorts/:id/analytics/pulse` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1636` |
| `GET` | `/api/cohorts/:id/analytics/stats` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1963` |
| `GET` | `/api/cohorts/:id/analytics/summary` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1930` |
| `GET` | `/api/cohorts/:id/analytics/timeline-series` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1941` |
| `GET` | `/api/cohorts/:id/analytics/tna-sequences` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:2014` |
| `GET` | `/api/cohorts/:id/analytics/top-resources` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1974` |
| `POST` | `/api/cohorts/:id/cases` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:634` |
| `DELETE` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:735` |
| `PATCH` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:762` |
| `GET` | `/api/cohorts/:id/export` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1469` |
| `GET` | `/api/cohorts/:id/feed` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1418` |
| `GET` | `/api/cohorts/:id/grid` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1305` |
| `DELETE` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1058` |
| `POST` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1039` |
| `POST` | `/api/cohorts/:id/members` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:564` |
| `DELETE` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:599` |
| `PATCH` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:817` |
| `POST` | `/api/cohorts/:id/members/bulk` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:871` |
| `GET` | `/api/cohorts/:id/roster` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1259` |
| `GET` | `/api/cohorts/:id/student/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1356` |
| `POST` | `/api/cohorts/:id/teachers` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:974` |
| `DELETE` | `/api/cohorts/:id/teachers/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1010` |
| `POST` | `/api/cohorts/bulk-enroll` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:910` |
| `POST` | `/api/cohorts/join` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:1074` |
| `GET` | `/api/cohorts/mine` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:325` |
