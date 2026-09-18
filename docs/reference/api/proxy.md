# proxy API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

12 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/llm/models` | `authenticateToken` | `server/routes/proxy-routes.js:1058` |
| `GET` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1871` |
| `PUT` | `/api/llm/pricing` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1887` |
| `GET` | `/api/llm/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1763` |
| `GET` | `/api/llm/usage/all` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1801` |
| `GET` | `/api/llm/usage/platform` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1827` |
| `POST` | `/api/proxy/llm` | `authenticateToken` | `server/routes/proxy-routes.js:114` |
| `POST` | `/api/tts` | `authenticateToken` | `server/routes/proxy-routes.js:1297` |
| `POST` | `/api/tts/preview` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1304` |
| `GET` | `/api/tts/usage` | `authenticateToken` | `server/routes/proxy-routes.js:1069` |
| `GET` | `/api/tts/voice-usage` | `authenticateToken, requireAdmin` | `server/routes/proxy-routes.js:1166` |
| `GET` | `/api/tts/voices` | `authenticateToken` | `server/routes/proxy-routes.js:1135` |
