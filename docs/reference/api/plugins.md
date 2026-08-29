# plugins API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

4 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/plugins/:pluginId/*splat` | `authenticateToken, requireStudent` | `server/routes/plugins-routes.js:346` |
| `GET` | `/api/plugins/:pluginId/catalog` | `authenticateToken` | `server/routes/plugins-routes.js:130` |
| `GET` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:259` |
| `PUT` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:288` |
