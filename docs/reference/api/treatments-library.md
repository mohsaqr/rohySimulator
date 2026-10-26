# treatments-library API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

4 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/treatment-effects` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:199` |
| `DELETE` | `/api/treatment-effects/:id` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:333` |
| `PUT` | `/api/treatment-effects/:id` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:248` |
| `PUT` | `/api/treatment-effects/:id/restore` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:336` |
