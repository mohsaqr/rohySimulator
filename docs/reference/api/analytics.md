# analytics API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

51 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/alarms/:id/acknowledge` | `authenticateToken` | `server/routes/analytics-routes.js:2896` |
| `GET` | `/api/alarms/config` | `authenticateToken` | `server/routes/analytics-routes.js:2941` |
| `POST` | `/api/alarms/config` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2982` |
| `GET` | `/api/alarms/config/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:2957` |
| `POST` | `/api/alarms/log` | `authenticateToken` | `server/routes/analytics-routes.js:2872` |
| `GET` | `/api/analytics/case-insights` | `authenticateToken` | `server/routes/analytics-routes.js:1519` |
| `GET` | `/api/analytics/daily-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3159` |
| `GET` | `/api/analytics/events` | `authenticateToken` | `server/routes/analytics-routes.js:3066` |
| `GET` | `/api/analytics/filter-options` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3218` |
| `GET` | `/api/analytics/hourly-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3169` |
| `GET` | `/api/analytics/login-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:439` |
| `GET` | `/api/analytics/rejected-events` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:1007` |
| `GET` | `/api/analytics/sessions` | `authenticateToken` | `server/routes/analytics-routes.js:229` |
| `GET` | `/api/analytics/sessions/:id` | `authenticateToken` | `server/routes/analytics-routes.js:276` |
| `GET` | `/api/analytics/sessions/:id/reconcile` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:1051` |
| `GET` | `/api/analytics/settings-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:458` |
| `GET` | `/api/analytics/stats` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3198` |
| `GET` | `/api/analytics/summary` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3189` |
| `GET` | `/api/analytics/timeline-series` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3180` |
| `GET` | `/api/analytics/tna-sequences` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3128` |
| `GET` | `/api/analytics/top-resources` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3209` |
| `GET` | `/api/analytics/user-stats/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:311` |
| `GET` | `/api/chat-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:1967` |
| `GET` | `/api/chat-log/turns` | `authenticateToken` | `server/routes/analytics-routes.js:1430` |
| `GET` | `/api/client-logs` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:821` |
| `POST` | `/api/client-logs/batch` | `authenticateToken` | `server/routes/analytics-routes.js:768` |
| `GET` | `/api/emotion-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3301` |
| `POST` | `/api/emotion-logs` | `authenticateToken` | `server/routes/analytics-routes.js:3272` |
| `GET` | `/api/export/complete-session/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:491` |
| `GET` | `/api/export/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:1836` |
| `GET` | `/api/export/questionnaire-responses` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3329` |
| `GET` | `/api/export/system-log/:source` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2330` |
| `POST` | `/api/interactions` | `authenticateToken` | `server/routes/analytics-routes.js:176` |
| `GET` | `/api/interactions/:session_id` | `authenticateToken` | `server/routes/analytics-routes.js:205` |
| `POST` | `/api/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:639` |
| `GET` | `/api/learning-events/all` | `authenticateToken` | `server/routes/analytics-routes.js:1104` |
| `GET` | `/api/learning-events/analytics/summary` | `authenticateToken` | `server/routes/analytics-routes.js:939` |
| `POST` | `/api/learning-events/batch` | `authenticateToken` | `server/routes/analytics-routes.js:699` |
| `GET` | `/api/learning-events/detailed/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:1719` |
| `GET` | `/api/learning-events/moments` | `authenticateToken` | `server/routes/analytics-routes.js:1407` |
| `GET` | `/api/learning-events/recent` | `authenticateToken` | `server/routes/analytics-routes.js:1074` |
| `GET` | `/api/learning-events/session/:id` | `authenticateToken` | `server/routes/analytics-routes.js:857` |
| `GET` | `/api/learning-events/user/:id` | `authenticateToken` | `server/routes/analytics-routes.js:885` |
| `GET` | `/api/learning-events/verbs` | `authenticateToken` | `server/routes/analytics-routes.js:1001` |
| `GET` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3449` |
| `POST` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3396` |
| `GET` | `/api/sessions/:id/events` | `authenticateToken` | `server/routes/analytics-routes.js:604` |
| `POST` | `/api/settings/log` | `authenticateToken` | `server/routes/analytics-routes.js:388` |
| `GET` | `/api/system-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2440` |
| `GET` | `/api/system-log/table/:name` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2822` |
| `GET` | `/api/system-log/tables` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2807` |
