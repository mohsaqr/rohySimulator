# notes API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

2 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/sessions/:sessionId/discussion-notes` | `authenticateToken` | `server/routes/notes-routes.js:36` |
| `PUT` | `/api/sessions/:sessionId/discussion-notes` | `authenticateToken` | `server/routes/notes-routes.js:53` |
