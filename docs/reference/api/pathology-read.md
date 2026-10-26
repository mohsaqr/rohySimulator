# pathology-read API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

2 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/sessions/:sessionId/pathology-reads` | `authenticateToken, requireEducator` | `server/routes/pathology-read-routes.js:249` |
| `POST` | `/api/sessions/:sessionId/pathology-reads` | `authenticateToken` | `server/routes/pathology-read-routes.js:136` |
