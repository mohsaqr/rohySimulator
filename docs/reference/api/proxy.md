# proxy API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

13 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/llm/models` | `authenticateToken` | `server/routes/proxy-routes.js:1611` |
| `GET` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2465` |
| `PUT` | `/api/llm/pricing` | `authenticateToken` | `server/routes/proxy-routes.js:2483` |
| `GET` | `/api/llm/usage` | `authenticateToken` | `server/routes/proxy-routes.js:2361` |
| `GET` | `/api/llm/usage/all` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2397` |
| `GET` | `/api/llm/usage/platform` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2426` |
| `POST` | `/api/proxy/llm` | `authenticateToken` | `server/routes/proxy-routes.js:239` |
| `GET` | `/api/sessions/:id/patient-prompt` | `authenticateToken, requireReviewer` | `server/routes/proxy-routes.js:215` |
| `POST` | `/api/tts` | `authenticateToken` | `server/routes/proxy-routes.js:1859` |
| `POST` | `/api/tts/preview` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1866` |
| `GET` | `/api/tts/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1622` |
| `GET` | `/api/tts/voice-usage` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1723` |
| `GET` | `/api/tts/voices` | `authenticateToken` | `server/routes/proxy-routes.js:1692` |
