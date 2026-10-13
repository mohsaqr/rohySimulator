# report API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

4 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/report` | `authenticateToken, requireAuth` | `server/routes/report-routes.js:103` |
| `GET` | `/api/reports/:id/messages` | `authenticateToken, requireAuth` | `server/routes/report-routes.js:143` |
| `POST` | `/api/reports/:id/messages` | `authenticateToken, requireAuth` | `server/routes/report-routes.js:154` |
| `GET` | `/api/reports/mine` | `authenticateToken, requireAuth` | `server/routes/report-routes.js:121` |
