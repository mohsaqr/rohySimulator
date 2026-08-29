# sessions API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

5 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/sessions` | `authenticateToken` | `server/routes/sessions-routes.js:46` |
| `GET` | `/api/sessions/:id` | `authenticateToken` | `server/routes/sessions-routes.js:246` |
| `PUT` | `/api/sessions/:id/end` | `authenticateToken` | `server/routes/sessions-routes.js:280` |
| `GET` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:352` |
| `POST` | `/api/sessions/:id/vitals` | `authenticateToken` | `server/routes/sessions-routes.js:324` |
