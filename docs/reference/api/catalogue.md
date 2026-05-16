# catalogue API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

12 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:352` |
| `POST` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:380` |
| `DELETE` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:454` |
| `PUT` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:422` |
| `POST` | `/api/catalogue/lab-tests/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:474` |
| `GET` | `/api/catalogue/lab-tests/search` | `authenticateToken` | `server/routes/catalogue.js:494` |
| `GET` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:170` |
| `POST` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:200` |
| `DELETE` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:282` |
| `PUT` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:246` |
| `POST` | `/api/catalogue/medications/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:303` |
| `GET` | `/api/catalogue/medications/search` | `authenticateToken` | `server/routes/catalogue.js:326` |
