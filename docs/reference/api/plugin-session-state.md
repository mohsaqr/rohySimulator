# plugin-session-state API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

3 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/sessions/:sessionId/plugin-state` | `authenticateToken, requireEducator` | `server/routes/plugin-session-state-routes.js:198` |
| `GET` | `/api/sessions/:sessionId/plugin-state/:pluginId/:name` | `authenticateToken` | `server/routes/plugin-session-state-routes.js:87` |
| `PUT` | `/api/sessions/:sessionId/plugin-state/:pluginId/:name` | `authenticateToken` | `server/routes/plugin-session-state-routes.js:100` |
