# analytics API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

51 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/alarms/:id/acknowledge` | `authenticateToken` | `server/routes/analytics-routes.js:2783` |
| `GET` | `/api/alarms/config` | `authenticateToken` | `server/routes/analytics-routes.js:2828` |
| `POST` | `/api/alarms/config` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2869` |
| `GET` | `/api/alarms/config/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:2844` |
| `POST` | `/api/alarms/log` | `authenticateToken` | `server/routes/analytics-routes.js:2759` |
| `GET` | `/api/analytics/case-insights` | `authenticateToken` | `server/routes/analytics-routes.js:1440` |
| `GET` | `/api/analytics/daily-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3045` |
| `GET` | `/api/analytics/events` | `authenticateToken` | `server/routes/analytics-routes.js:2953` |
| `GET` | `/api/analytics/filter-options` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3104` |
| `GET` | `/api/analytics/hourly-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3055` |
| `GET` | `/api/analytics/login-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:377` |
| `GET` | `/api/analytics/rejected-events` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:937` |
| `GET` | `/api/analytics/sessions` | `authenticateToken` | `server/routes/analytics-routes.js:210` |
| `GET` | `/api/analytics/sessions/:id` | `authenticateToken` | `server/routes/analytics-routes.js:257` |
| `GET` | `/api/analytics/sessions/:id/reconcile` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:981` |
| `GET` | `/api/analytics/settings-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:396` |
| `GET` | `/api/analytics/stats` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3084` |
| `GET` | `/api/analytics/summary` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3075` |
| `GET` | `/api/analytics/timeline-series` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3066` |
| `GET` | `/api/analytics/tna-sequences` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3014` |
| `GET` | `/api/analytics/top-resources` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3095` |
| `GET` | `/api/analytics/user-stats/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:292` |
| `GET` | `/api/chat-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:1887` |
| `GET` | `/api/chat-log/turns` | `authenticateToken` | `server/routes/analytics-routes.js:1354` |
| `GET` | `/api/client-logs` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:753` |
| `POST` | `/api/client-logs/batch` | `authenticateToken` | `server/routes/analytics-routes.js:707` |
| `GET` | `/api/emotion-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3177` |
| `POST` | `/api/emotion-logs` | `authenticateToken` | `server/routes/analytics-routes.js:3158` |
| `GET` | `/api/export/complete-session/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:429` |
| `GET` | `/api/export/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:1756` |
| `GET` | `/api/export/questionnaire-responses` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3205` |
| `GET` | `/api/export/system-log/:source` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2244` |
| `POST` | `/api/interactions` | `authenticateToken` | `server/routes/analytics-routes.js:164` |
| `GET` | `/api/interactions/:session_id` | `authenticateToken` | `server/routes/analytics-routes.js:186` |
| `POST` | `/api/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:578` |
| `GET` | `/api/learning-events/all` | `authenticateToken` | `server/routes/analytics-routes.js:1032` |
| `GET` | `/api/learning-events/analytics/summary` | `authenticateToken` | `server/routes/analytics-routes.js:869` |
| `POST` | `/api/learning-events/batch` | `authenticateToken` | `server/routes/analytics-routes.js:638` |
| `GET` | `/api/learning-events/detailed/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:1640` |
| `GET` | `/api/learning-events/moments` | `authenticateToken` | `server/routes/analytics-routes.js:1331` |
| `GET` | `/api/learning-events/recent` | `authenticateToken` | `server/routes/analytics-routes.js:1004` |
| `GET` | `/api/learning-events/session/:id` | `authenticateToken` | `server/routes/analytics-routes.js:789` |
| `GET` | `/api/learning-events/user/:id` | `authenticateToken` | `server/routes/analytics-routes.js:817` |
| `GET` | `/api/learning-events/verbs` | `authenticateToken` | `server/routes/analytics-routes.js:931` |
| `GET` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3291` |
| `POST` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3272` |
| `GET` | `/api/sessions/:id/events` | `authenticateToken` | `server/routes/analytics-routes.js:543` |
| `POST` | `/api/settings/log` | `authenticateToken` | `server/routes/analytics-routes.js:335` |
| `GET` | `/api/system-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2333` |
| `GET` | `/api/system-log/table/:name` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2712` |
| `GET` | `/api/system-log/tables` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2686` |
