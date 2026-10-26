# agents API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

22 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/agents/templates` | `authenticateToken` | `server/routes/agents-routes.js:287` |
| `POST` | `/api/agents/templates` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:353` |
| `DELETE` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:592` |
| `GET` | `/api/agents/templates/:id` | `authenticateToken` | `server/routes/agents-routes.js:318` |
| `PUT` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:432` |
| `POST` | `/api/agents/templates/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:766` |
| `POST` | `/api/agents/templates/:id/reset-to-default` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:665` |
| `GET` | `/api/cases/:caseId/agents` | `authenticateToken` | `server/routes/agents-routes.js:859` |
| `POST` | `/api/cases/:caseId/agents` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:948` |
| `DELETE` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1178` |
| `PUT` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1090` |
| `POST` | `/api/cases/:caseId/agents/add-defaults` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1236` |
| `GET` | `/api/sessions/:sessionId/agents` | `authenticateToken` | `server/routes/agents-routes.js:1325` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/arrive` | `authenticateToken` | `server/routes/agents-routes.js:1568` |
| `DELETE` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1755` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1655` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1694` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/depart` | `authenticateToken` | `server/routes/agents-routes.js:1595` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/page` | `authenticateToken` | `server/routes/agents-routes.js:1476` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/status` | `authenticateToken` | `server/routes/agents-routes.js:1620` |
| `GET` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1781` |
| `POST` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1807` |
