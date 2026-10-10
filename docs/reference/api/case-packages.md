# case-packages API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

9 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/case-packages/jobs/:id` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:120` |
| `GET` | `/api/case-packages/jobs/:id/download` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:126` |
| `POST` | `/api/case-packages/uploads` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:148` |
| `DELETE` | `/api/case-packages/uploads/:id` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:179` |
| `PUT` | `/api/case-packages/uploads/:id/chunks/:index` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:159` |
| `POST` | `/api/case-packages/uploads/:id/complete` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:171` |
| `POST` | `/api/cases/:id/package` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:107` |
| `GET` | `/api/platform-settings/case-packages` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:70` |
| `PUT` | `/api/platform-settings/case-packages` | `authenticateToken, requireAdmin` | `server/routes/case-packages-routes.js:78` |
