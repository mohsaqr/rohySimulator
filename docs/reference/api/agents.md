# agents API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

23 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/agents/templates` | `authenticateToken` | `server/routes/agents-routes.js:196` |
| `POST` | `/api/agents/templates` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:262` |
| `DELETE` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:492` |
| `GET` | `/api/agents/templates/:id` | `authenticateToken` | `server/routes/agents-routes.js:227` |
| `PUT` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:339` |
| `POST` | `/api/agents/templates/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:832` |
| `POST` | `/api/agents/templates/:id/reset-to-default` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:567` |
| `POST` | `/api/agents/templates/:id/test-llm` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:682` |
| `GET` | `/api/cases/:caseId/agents` | `authenticateToken` | `server/routes/agents-routes.js:910` |
| `POST` | `/api/cases/:caseId/agents` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:977` |
| `DELETE` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1172` |
| `PUT` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1084` |
| `POST` | `/api/cases/:caseId/agents/add-defaults` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1212` |
| `GET` | `/api/sessions/:sessionId/agents` | `authenticateToken` | `server/routes/agents-routes.js:1288` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/arrive` | `authenticateToken` | `server/routes/agents-routes.js:1525` |
| `DELETE` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1697` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1612` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1645` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/depart` | `authenticateToken` | `server/routes/agents-routes.js:1552` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/page` | `authenticateToken` | `server/routes/agents-routes.js:1434` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/status` | `authenticateToken` | `server/routes/agents-routes.js:1577` |
| `GET` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1723` |
| `POST` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1749` |
