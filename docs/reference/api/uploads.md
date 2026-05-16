# uploads API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

4 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/bodymap-regions` | `(none)` | `server/routes/uploads-routes.js:180` |
| `POST` | `/api/bodymap-regions` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:195` |
| `POST` | `/api/upload` | `authenticateToken` | `server/routes/uploads-routes.js:129` |
| `POST` | `/api/upload-body-image` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:138` |
