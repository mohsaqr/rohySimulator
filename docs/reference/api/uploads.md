# uploads API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

8 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `DELETE` | `/api/body-image/:type` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:337` |
| `GET` | `/api/bodymap-regions` | `(none)` | `server/routes/uploads-routes.js:377` |
| `POST` | `/api/bodymap-regions` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:416` |
| `POST` | `/api/upload` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:189` |
| `POST` | `/api/upload-body-image` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:280` |
| `POST` | `/api/uploads/file` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:272` |
| `POST` | `/api/uploads/image` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:271` |
| `POST` | `/api/uploads/video` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:273` |
