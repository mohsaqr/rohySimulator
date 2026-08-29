# plugins API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

2 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/plugins/:pluginId/*splat` | `authenticateToken, requireStudent` | `server/routes/plugins-routes.js:188` |
| `GET` | `/api/plugins/:pluginId/catalog` | `authenticateToken` | `server/routes/plugins-routes.js:127` |
