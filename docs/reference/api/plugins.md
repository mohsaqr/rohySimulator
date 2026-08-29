# plugins API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

9 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/plugins/:pluginId/*splat` | `authenticateToken, requireStudent` | `server/routes/plugins-routes.js:388` |
| `GET` | `/api/plugins/:pluginId/catalog` | `authenticateToken` | `server/routes/plugins-routes.js:130` |
| `GET` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:301` |
| `PUT` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:330` |
| `GET` | `/api/plugins/pathology/assets` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:157` |
| `PUT` | `/api/plugins/pathology/assets/:assetId/calibration` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:195` |
| `POST` | `/api/plugins/pathology/imports` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:68` |
| `GET` | `/api/plugins/pathology/jobs/:jobId` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:133` |
| `POST` | `/api/plugins/pathology/jobs/:jobId/cancel` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:144` |
