# uploads API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

8 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `DELETE` | `/api/body-image/:type` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:256` |
| `GET` | `/api/bodymap-regions` | `(none)` | `server/routes/uploads-routes.js:296` |
| `POST` | `/api/bodymap-regions` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:311` |
| `POST` | `/api/upload` | `authenticateToken` | `server/routes/uploads-routes.js:130` |
| `POST` | `/api/upload-body-image` | `authenticateToken, requireAdmin` | `server/routes/uploads-routes.js:199` |
| `POST` | `/api/uploads/file` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:191` |
| `POST` | `/api/uploads/image` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:190` |
| `POST` | `/api/uploads/video` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:192` |
