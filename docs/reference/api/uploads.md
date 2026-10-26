# uploads API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

8 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `DELETE` | `/api/body-image/:type` | `authenticateToken` | `server/routes/uploads-routes.js:352` |
| `GET` | `/api/bodymap-regions` | `(none)` | `server/routes/uploads-routes.js:392` |
| `POST` | `/api/bodymap-regions` | `authenticateToken` | `server/routes/uploads-routes.js:432` |
| `POST` | `/api/upload` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:193` |
| `POST` | `/api/upload-body-image` | `authenticateToken` | `server/routes/uploads-routes.js:288` |
| `POST` | `/api/uploads/file` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:276` |
| `POST` | `/api/uploads/image` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:275` |
| `POST` | `/api/uploads/video` | `authenticateToken, requireEducator` | `server/routes/uploads-routes.js:277` |
