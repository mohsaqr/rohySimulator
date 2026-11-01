# agents API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

22 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/agents/templates` | `authenticateToken` | `server/routes/agents-routes.js:288` |
| `POST` | `/api/agents/templates` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:354` |
| `DELETE` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:593` |
| `GET` | `/api/agents/templates/:id` | `authenticateToken` | `server/routes/agents-routes.js:319` |
| `PUT` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:433` |
| `POST` | `/api/agents/templates/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:767` |
| `POST` | `/api/agents/templates/:id/reset-to-default` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:666` |
| `GET` | `/api/cases/:caseId/agents` | `authenticateToken` | `server/routes/agents-routes.js:860` |
| `POST` | `/api/cases/:caseId/agents` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:949` |
| `DELETE` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1179` |
| `PUT` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1091` |
| `POST` | `/api/cases/:caseId/agents/add-defaults` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:1237` |
| `GET` | `/api/sessions/:sessionId/agents` | `authenticateToken` | `server/routes/agents-routes.js:1326` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/arrive` | `authenticateToken` | `server/routes/agents-routes.js:1569` |
| `DELETE` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1733` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1656` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1692` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/depart` | `authenticateToken` | `server/routes/agents-routes.js:1596` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/page` | `authenticateToken` | `server/routes/agents-routes.js:1477` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/status` | `authenticateToken` | `server/routes/agents-routes.js:1621` |
| `GET` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1759` |
| `POST` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1785` |
