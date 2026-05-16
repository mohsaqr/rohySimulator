# sessions API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

7 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/sessions` | `authenticateToken` | `server/routes/sessions-routes.js:42` |
| `GET` | `/api/sessions/:id` | `authenticateToken` | `server/routes/sessions-routes.js:182` |
| `PUT` | `/api/sessions/:id/end` | `authenticateToken` | `server/routes/sessions-routes.js:211` |
| `GET` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:283` |
| `POST` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:255` |
| `GET` | `/api/sessions/:sessionId/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:324` |
| `POST` | `/api/sessions/:sessionId/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:302` |
