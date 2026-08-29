# catalogue API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

19 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/catalogue/` | `authenticateToken` | `server/routes/catalogue.js:558` |
| `POST` | `/api/catalogue/` | `authenticateToken` | `server/routes/catalogue.js:579` |
| `DELETE` | `/api/catalogue/:id` | `authenticateToken` | `server/routes/catalogue.js:628` |
| `PUT` | `/api/catalogue/:id` | `authenticateToken` | `server/routes/catalogue.js:607` |
| `GET` | `/api/catalogue/:id/items` | `authenticateToken` | `server/routes/catalogue.js:645` |
| `POST` | `/api/catalogue/:id/items` | `authenticateToken` | `server/routes/catalogue.js:664` |
| `DELETE` | `/api/catalogue/:id/items/:itemId` | `authenticateToken` | `server/routes/catalogue.js:686` |
| `GET` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:376` |
| `POST` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:404` |
| `DELETE` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:478` |
| `PUT` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:446` |
| `POST` | `/api/catalogue/lab-tests/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:498` |
| `GET` | `/api/catalogue/lab-tests/search` | `authenticateToken` | `server/routes/catalogue.js:518` |
| `GET` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:193` |
| `POST` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:223` |
| `DELETE` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:305` |
| `PUT` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:269` |
| `POST` | `/api/catalogue/medications/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:326` |
| `GET` | `/api/catalogue/medications/search` | `authenticateToken` | `server/routes/catalogue.js:349` |
