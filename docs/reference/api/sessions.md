# sessions API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

5 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/sessions` | `authenticateToken` | `server/routes/sessions-routes.js:47` |
| `GET` | `/api/sessions/:id` | `authenticateToken` | `server/routes/sessions-routes.js:266` |
| `PUT` | `/api/sessions/:id/end` | `authenticateToken` | `server/routes/sessions-routes.js:300` |
| `GET` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:380` |
| `POST` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:352` |
