# help API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

2 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/help/diagnostics` | `authenticateToken, requireAuth` | `server/routes/help-routes.js:100` |
| `GET` | `/api/help/release-notes` | `authenticateToken, requireAuth` | `server/routes/help-routes.js:88` |
