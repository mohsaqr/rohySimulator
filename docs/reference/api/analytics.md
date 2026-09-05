# analytics API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

51 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/alarms/:id/acknowledge` | `authenticateToken` | `server/routes/analytics-routes.js:2745` |
| `GET` | `/api/alarms/config` | `authenticateToken` | `server/routes/analytics-routes.js:2790` |
| `POST` | `/api/alarms/config` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2831` |
| `GET` | `/api/alarms/config/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:2806` |
| `POST` | `/api/alarms/log` | `authenticateToken` | `server/routes/analytics-routes.js:2721` |
| `GET` | `/api/analytics/case-insights` | `authenticateToken` | `server/routes/analytics-routes.js:1406` |
| `GET` | `/api/analytics/daily-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3007` |
| `GET` | `/api/analytics/events` | `authenticateToken` | `server/routes/analytics-routes.js:2915` |
| `GET` | `/api/analytics/filter-options` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3066` |
| `GET` | `/api/analytics/hourly-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3017` |
| `GET` | `/api/analytics/login-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:359` |
| `GET` | `/api/analytics/rejected-events` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:904` |
| `GET` | `/api/analytics/sessions` | `authenticateToken` | `server/routes/analytics-routes.js:208` |
| `GET` | `/api/analytics/sessions/:id` | `authenticateToken` | `server/routes/analytics-routes.js:247` |
| `GET` | `/api/analytics/sessions/:id/reconcile` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:948` |
| `GET` | `/api/analytics/settings-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:378` |
| `GET` | `/api/analytics/stats` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3046` |
| `GET` | `/api/analytics/summary` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3037` |
| `GET` | `/api/analytics/timeline-series` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3028` |
| `GET` | `/api/analytics/tna-sequences` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2976` |
| `GET` | `/api/analytics/top-resources` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3057` |
| `GET` | `/api/analytics/user-stats/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:282` |
| `GET` | `/api/chat-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:1850` |
| `GET` | `/api/chat-log/turns` | `authenticateToken` | `server/routes/analytics-routes.js:1320` |
| `GET` | `/api/client-logs` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:720` |
| `POST` | `/api/client-logs/batch` | `authenticateToken` | `server/routes/analytics-routes.js:674` |
| `GET` | `/api/emotion-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3139` |
| `POST` | `/api/emotion-logs` | `authenticateToken` | `server/routes/analytics-routes.js:3120` |
| `GET` | `/api/export/complete-session/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:411` |
| `GET` | `/api/export/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:1722` |
| `GET` | `/api/export/questionnaire-responses` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3167` |
| `GET` | `/api/export/system-log/:source` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2207` |
| `POST` | `/api/interactions` | `authenticateToken` | `server/routes/analytics-routes.js:162` |
| `GET` | `/api/interactions/:session_id` | `authenticateToken` | `server/routes/analytics-routes.js:184` |
| `POST` | `/api/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:545` |
| `GET` | `/api/learning-events/all` | `authenticateToken` | `server/routes/analytics-routes.js:999` |
| `GET` | `/api/learning-events/analytics/summary` | `authenticateToken` | `server/routes/analytics-routes.js:836` |
| `POST` | `/api/learning-events/batch` | `authenticateToken` | `server/routes/analytics-routes.js:605` |
| `GET` | `/api/learning-events/detailed/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:1606` |
| `GET` | `/api/learning-events/moments` | `authenticateToken` | `server/routes/analytics-routes.js:1297` |
| `GET` | `/api/learning-events/recent` | `authenticateToken` | `server/routes/analytics-routes.js:971` |
| `GET` | `/api/learning-events/session/:id` | `authenticateToken` | `server/routes/analytics-routes.js:756` |
| `GET` | `/api/learning-events/user/:id` | `authenticateToken` | `server/routes/analytics-routes.js:784` |
| `GET` | `/api/learning-events/verbs` | `authenticateToken` | `server/routes/analytics-routes.js:898` |
| `GET` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3253` |
| `POST` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3234` |
| `GET` | `/api/sessions/:id/events` | `authenticateToken` | `server/routes/analytics-routes.js:510` |
| `POST` | `/api/settings/log` | `authenticateToken` | `server/routes/analytics-routes.js:325` |
| `GET` | `/api/system-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2296` |
| `GET` | `/api/system-log/table/:name` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2674` |
| `GET` | `/api/system-log/tables` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2648` |
