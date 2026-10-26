# orders API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

38 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:589` |
| `PUT` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:690` |
| `DELETE` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:857` |
| `PUT` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:783` |
| `GET` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2758` |
| `PUT` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2787` |
| `GET` | `/api/cases/:id/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:68` |
| `POST` | `/api/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:82` |
| `GET` | `/api/labs/all` | `authenticateToken` | `server/routes/orders-routes.js:407` |
| `GET` | `/api/labs/group/:groupName` | `authenticateToken` | `server/routes/orders-routes.js:393` |
| `GET` | `/api/labs/grouped` | `authenticateToken` | `server/routes/orders-routes.js:419` |
| `GET` | `/api/labs/groups` | `authenticateToken` | `server/routes/orders-routes.js:383` |
| `POST` | `/api/labs/import` | `authenticateToken, requireAdmin` | `server/routes/orders-routes.js:525` |
| `POST` | `/api/labs/reload` | `authenticateToken, requireAdmin` | `server/routes/orders-routes.js:550` |
| `GET` | `/api/labs/search` | `authenticateToken` | `server/routes/orders-routes.js:367` |
| `GET` | `/api/labs/stats` | `authenticateToken, requireReviewer` | `server/routes/orders-routes.js:429` |
| `DELETE` | `/api/labs/test` | `authenticateToken, requireAdmin` | `server/routes/orders-routes.js:498` |
| `POST` | `/api/labs/test` | `authenticateToken, requireAdmin` | `server/routes/orders-routes.js:450` |
| `PUT` | `/api/labs/test` | `authenticateToken, requireAdmin` | `server/routes/orders-routes.js:470` |
| `PUT` | `/api/orders/:id/view` | `authenticateToken` | `server/routes/orders-routes.js:263` |
| `GET` | `/api/radiology-database` | `authenticateToken` | `server/routes/orders-routes.js:1553` |
| `POST` | `/api/sessions/:id/order` | `authenticateToken` | `server/routes/orders-routes.js:108` |
| `GET` | `/api/sessions/:id/orders` | `authenticateToken` | `server/routes/orders-routes.js:185` |
| `GET` | `/api/sessions/:sessionId/active-effects` | `authenticateToken` | `server/routes/orders-routes.js:2634` |
| `POST` | `/api/sessions/:sessionId/administer/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2300` |
| `GET` | `/api/sessions/:sessionId/available-labs` | `authenticateToken` | `server/routes/orders-routes.js:887` |
| `GET` | `/api/sessions/:sessionId/available-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1611` |
| `GET` | `/api/sessions/:sessionId/available-treatments` | `authenticateToken` | `server/routes/orders-routes.js:2008` |
| `PUT` | `/api/sessions/:sessionId/discontinue/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2491` |
| `GET` | `/api/sessions/:sessionId/lab-results` | `authenticateToken` | `server/routes/orders-routes.js:1441` |
| `PUT` | `/api/sessions/:sessionId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:1486` |
| `POST` | `/api/sessions/:sessionId/order-labs` | `authenticateToken` | `server/routes/orders-routes.js:1081` |
| `POST` | `/api/sessions/:sessionId/order-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1727` |
| `POST` | `/api/sessions/:sessionId/order-treatment` | `authenticateToken` | `server/routes/orders-routes.js:2133` |
| `GET` | `/api/sessions/:sessionId/radiology-orders` | `authenticateToken` | `server/routes/orders-routes.js:1669` |
| `GET` | `/api/sessions/:sessionId/treatment-debrief` | `authenticateToken` | `server/routes/orders-routes.js:2569` |
| `GET` | `/api/sessions/:sessionId/treatment-orders` | `authenticateToken` | `server/routes/orders-routes.js:2527` |
| `GET` | `/api/treatment-effects` | `authenticateToken` | `server/routes/orders-routes.js:2858` |
