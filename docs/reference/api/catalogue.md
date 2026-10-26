# catalogue API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

19 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/catalogue/` | `authenticateToken` | `server/routes/catalogue.js:587` |
| `POST` | `/api/catalogue/` | `authenticateToken` | `server/routes/catalogue.js:608` |
| `DELETE` | `/api/catalogue/:id` | `authenticateToken` | `server/routes/catalogue.js:657` |
| `PUT` | `/api/catalogue/:id` | `authenticateToken` | `server/routes/catalogue.js:636` |
| `GET` | `/api/catalogue/:id/items` | `authenticateToken` | `server/routes/catalogue.js:674` |
| `POST` | `/api/catalogue/:id/items` | `authenticateToken` | `server/routes/catalogue.js:693` |
| `DELETE` | `/api/catalogue/:id/items/:itemId` | `authenticateToken` | `server/routes/catalogue.js:715` |
| `GET` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:401` |
| `POST` | `/api/catalogue/lab-tests` | `authenticateToken` | `server/routes/catalogue.js:430` |
| `DELETE` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:504` |
| `PUT` | `/api/catalogue/lab-tests/:id` | `authenticateToken` | `server/routes/catalogue.js:472` |
| `POST` | `/api/catalogue/lab-tests/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:524` |
| `GET` | `/api/catalogue/lab-tests/search` | `authenticateToken` | `server/routes/catalogue.js:547` |
| `GET` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:212` |
| `POST` | `/api/catalogue/medications` | `authenticateToken` | `server/routes/catalogue.js:243` |
| `DELETE` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:325` |
| `PUT` | `/api/catalogue/medications/:id` | `authenticateToken` | `server/routes/catalogue.js:289` |
| `POST` | `/api/catalogue/medications/:id/promote` | `authenticateToken, requireAdmin` | `server/routes/catalogue.js:346` |
| `GET` | `/api/catalogue/medications/search` | `authenticateToken` | `server/routes/catalogue.js:374` |
