# proxy API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

13 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/llm/models` | `authenticateToken` | `server/routes/proxy-routes.js:1386` |
| `GET` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2199` |
| `PUT` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2215` |
| `GET` | `/api/llm/usage` | `authenticateToken` | `server/routes/proxy-routes.js:2091` |
| `GET` | `/api/llm/usage/all` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2129` |
| `GET` | `/api/llm/usage/platform` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:2155` |
| `POST` | `/api/proxy/llm` | `authenticateToken` | `server/routes/proxy-routes.js:164` |
| `GET` | `/api/sessions/:id/patient-prompt` | `authenticateToken, requireReviewer` | `server/routes/proxy-routes.js:140` |
| `POST` | `/api/tts` | `authenticateToken` | `server/routes/proxy-routes.js:1625` |
| `POST` | `/api/tts/preview` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1632` |
| `GET` | `/api/tts/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1397` |
| `GET` | `/api/tts/voice-usage` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1494` |
| `GET` | `/api/tts/voices` | `authenticateToken` | `server/routes/proxy-routes.js:1463` |
