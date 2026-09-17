# terms API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

5 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/platform-settings/terms` | `authenticateToken, requireAdmin` | `server/routes/terms-routes.js:157` |
| `PUT` | `/api/platform-settings/terms` | `authenticateToken, requireAdmin` | `server/routes/terms-routes.js:172` |
| `GET` | `/api/terms` | `(none)` | `server/routes/terms-routes.js:90` |
| `POST` | `/api/terms/accept` | `authenticateToken` | `server/routes/terms-routes.js:117` |
| `GET` | `/api/terms/status` | `authenticateToken` | `server/routes/terms-routes.js:99` |
