# patient-record API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

5 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `DELETE` | `/api/patient-record/:sessionId` | `authenticateToken` | `server/routes/patient-record-routes.js:201` |
| `GET` | `/api/patient-record/:sessionId` | `authenticateToken` | `server/routes/patient-record-routes.js:124` |
| `GET` | `/api/patient-record/:sessionId/events` | `authenticateToken` | `server/routes/patient-record-routes.js:162` |
| `GET` | `/api/patient-record/:sessionId/summary` | `authenticateToken` | `server/routes/patient-record-routes.js:233` |
| `POST` | `/api/patient-record/sync` | `authenticateToken` | `server/routes/patient-record-routes.js:40` |
