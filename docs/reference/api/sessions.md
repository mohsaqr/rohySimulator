# sessions API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

7 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/sessions` | `authenticateToken` | `server/routes/sessions-routes.js:44` |
| `GET` | `/api/sessions/:id` | `authenticateToken` | `server/routes/sessions-routes.js:204` |
| `PUT` | `/api/sessions/:id/end` | `authenticateToken` | `server/routes/sessions-routes.js:233` |
| `GET` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:305` |
| `POST` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:277` |
| `GET` | `/api/sessions/:sessionId/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:346` |
| `POST` | `/api/sessions/:sessionId/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:324` |
