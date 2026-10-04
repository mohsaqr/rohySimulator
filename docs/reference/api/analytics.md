# analytics API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

51 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `PUT` | `/api/alarms/:id/acknowledge` | `authenticateToken` | `server/routes/analytics-routes.js:2762` |
| `GET` | `/api/alarms/config` | `authenticateToken` | `server/routes/analytics-routes.js:2807` |
| `POST` | `/api/alarms/config` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2848` |
| `GET` | `/api/alarms/config/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:2823` |
| `POST` | `/api/alarms/log` | `authenticateToken` | `server/routes/analytics-routes.js:2738` |
| `GET` | `/api/analytics/case-insights` | `authenticateToken` | `server/routes/analytics-routes.js:1423` |
| `GET` | `/api/analytics/daily-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3024` |
| `GET` | `/api/analytics/events` | `authenticateToken` | `server/routes/analytics-routes.js:2932` |
| `GET` | `/api/analytics/filter-options` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3083` |
| `GET` | `/api/analytics/hourly-counts` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3034` |
| `GET` | `/api/analytics/login-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:376` |
| `GET` | `/api/analytics/rejected-events` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:921` |
| `GET` | `/api/analytics/sessions` | `authenticateToken` | `server/routes/analytics-routes.js:209` |
| `GET` | `/api/analytics/sessions/:id` | `authenticateToken` | `server/routes/analytics-routes.js:256` |
| `GET` | `/api/analytics/sessions/:id/reconcile` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:965` |
| `GET` | `/api/analytics/settings-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:395` |
| `GET` | `/api/analytics/stats` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3063` |
| `GET` | `/api/analytics/summary` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3054` |
| `GET` | `/api/analytics/timeline-series` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3045` |
| `GET` | `/api/analytics/tna-sequences` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2993` |
| `GET` | `/api/analytics/top-resources` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3074` |
| `GET` | `/api/analytics/user-stats/:userId` | `authenticateToken` | `server/routes/analytics-routes.js:291` |
| `GET` | `/api/chat-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:1867` |
| `GET` | `/api/chat-log/turns` | `authenticateToken` | `server/routes/analytics-routes.js:1337` |
| `GET` | `/api/client-logs` | `authenticateToken, requireEducator` | `server/routes/analytics-routes.js:737` |
| `POST` | `/api/client-logs/batch` | `authenticateToken` | `server/routes/analytics-routes.js:691` |
| `GET` | `/api/emotion-logs` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3156` |
| `POST` | `/api/emotion-logs` | `authenticateToken` | `server/routes/analytics-routes.js:3137` |
| `GET` | `/api/export/complete-session/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:428` |
| `GET` | `/api/export/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:1739` |
| `GET` | `/api/export/questionnaire-responses` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:3184` |
| `GET` | `/api/export/system-log/:source` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2224` |
| `POST` | `/api/interactions` | `authenticateToken` | `server/routes/analytics-routes.js:163` |
| `GET` | `/api/interactions/:session_id` | `authenticateToken` | `server/routes/analytics-routes.js:185` |
| `POST` | `/api/learning-events` | `authenticateToken` | `server/routes/analytics-routes.js:562` |
| `GET` | `/api/learning-events/all` | `authenticateToken` | `server/routes/analytics-routes.js:1016` |
| `GET` | `/api/learning-events/analytics/summary` | `authenticateToken` | `server/routes/analytics-routes.js:853` |
| `POST` | `/api/learning-events/batch` | `authenticateToken` | `server/routes/analytics-routes.js:622` |
| `GET` | `/api/learning-events/detailed/:sessionId` | `authenticateToken` | `server/routes/analytics-routes.js:1623` |
| `GET` | `/api/learning-events/moments` | `authenticateToken` | `server/routes/analytics-routes.js:1314` |
| `GET` | `/api/learning-events/recent` | `authenticateToken` | `server/routes/analytics-routes.js:988` |
| `GET` | `/api/learning-events/session/:id` | `authenticateToken` | `server/routes/analytics-routes.js:773` |
| `GET` | `/api/learning-events/user/:id` | `authenticateToken` | `server/routes/analytics-routes.js:801` |
| `GET` | `/api/learning-events/verbs` | `authenticateToken` | `server/routes/analytics-routes.js:915` |
| `GET` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3270` |
| `POST` | `/api/questionnaire-responses` | `authenticateToken` | `server/routes/analytics-routes.js:3251` |
| `GET` | `/api/sessions/:id/events` | `authenticateToken` | `server/routes/analytics-routes.js:527` |
| `POST` | `/api/settings/log` | `authenticateToken` | `server/routes/analytics-routes.js:334` |
| `GET` | `/api/system-log/feed` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2313` |
| `GET` | `/api/system-log/table/:name` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2691` |
| `GET` | `/api/system-log/tables` | `authenticateToken, requireAdmin` | `server/routes/analytics-routes.js:2665` |
