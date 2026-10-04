# proxy API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

13 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/llm/models` | `authenticateToken` | `server/routes/proxy-routes.js:1263` |
| `GET` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2076` |
| `PUT` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2092` |
| `GET` | `/api/llm/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1968` |
| `GET` | `/api/llm/usage/all` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2006` |
| `GET` | `/api/llm/usage/platform` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2032` |
| `POST` | `/api/proxy/llm` | `authenticateToken` | `server/routes/proxy-routes.js:156` |
| `GET` | `/api/sessions/:id/patient-prompt` | `authenticateToken, requireReviewer` | `server/routes/proxy-routes.js:132` |
| `POST` | `/api/tts` | `authenticateToken` | `server/routes/proxy-routes.js:1502` |
| `POST` | `/api/tts/preview` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1509` |
| `GET` | `/api/tts/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1274` |
| `GET` | `/api/tts/voice-usage` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1371` |
| `GET` | `/api/tts/voices` | `authenticateToken` | `server/routes/proxy-routes.js:1340` |
