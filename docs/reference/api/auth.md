# auth API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

6 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/auth/login` | `(none)` | `server/routes/auth-routes.js:204` |
| `POST` | `/api/auth/logout` | `authenticateToken` | `server/routes/auth-routes.js:466` |
| `GET` | `/api/auth/profile` | `authenticateToken` | `server/routes/auth-routes.js:449` |
| `POST` | `/api/auth/refresh` | `authenticateToken` | `server/routes/auth-routes.js:383` |
| `POST` | `/api/auth/register` | `(none)` | `server/routes/auth-routes.js:99` |
| `GET` | `/api/auth/verify` | `authenticateToken` | `server/routes/auth-routes.js:350` |
