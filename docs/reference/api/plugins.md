# plugins API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

10 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/plugins/:pluginId/*splat` | `authenticateToken, requireStudent` | `server/routes/plugins-routes.js:434` |
| `GET` | `/api/plugins/:pluginId/catalog` | `authenticateToken` | `server/routes/plugins-routes.js:225` |
| `GET` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:347` |
| `PUT` | `/api/plugins/:pluginId/settings` | `authenticateToken` | `server/routes/plugins-routes.js:376` |
| `GET` | `/api/plugins/pathology/assets` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:157` |
| `DELETE` | `/api/plugins/pathology/assets/:assetId` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:203` |
| `PUT` | `/api/plugins/pathology/assets/:assetId/calibration` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:230` |
| `POST` | `/api/plugins/pathology/imports` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:68` |
| `GET` | `/api/plugins/pathology/jobs/:jobId` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:133` |
| `POST` | `/api/plugins/pathology/jobs/:jobId/cancel` | `authenticateToken, requireEducator` | `server/plugins/pathology/index.js:144` |
