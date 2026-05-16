# tenants API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

2 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/tenants` | `authenticateToken, requireAdmin` | `server/routes/tenants-routes.js:37` |
| `POST` | `/api/users/:id/tenant` | `authenticateToken, requireAdmin` | `server/routes/tenants-routes.js:75` |
