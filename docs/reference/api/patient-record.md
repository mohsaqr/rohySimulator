# patient-record API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

5 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `DELETE` | `/api/patient-record/:sessionId` | `authenticateToken` | `server/routes/patient-record-routes.js:190` |
| `GET` | `/api/patient-record/:sessionId` | `authenticateToken` | `server/routes/patient-record-routes.js:113` |
| `GET` | `/api/patient-record/:sessionId/events` | `authenticateToken` | `server/routes/patient-record-routes.js:151` |
| `GET` | `/api/patient-record/:sessionId/summary` | `authenticateToken` | `server/routes/patient-record-routes.js:220` |
| `POST` | `/api/patient-record/sync` | `authenticateToken` | `server/routes/patient-record-routes.js:38` |
