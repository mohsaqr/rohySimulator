# orders API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

37 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:510` |
| `PUT` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:600` |
| `DELETE` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:779` |
| `PUT` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:705` |
| `PUT` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2571` |
| `GET` | `/api/cases/:id/investigations` | `authenticateToken` | `server/routes/orders-routes.js:51` |
| `POST` | `/api/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:65` |
| `GET` | `/api/labs/all` | `authenticateToken` | `server/routes/orders-routes.js:355` |
| `GET` | `/api/labs/group/:groupName` | `authenticateToken` | `server/routes/orders-routes.js:343` |
| `GET` | `/api/labs/grouped` | `authenticateToken` | `server/routes/orders-routes.js:367` |
| `GET` | `/api/labs/groups` | `authenticateToken` | `server/routes/orders-routes.js:333` |
| `POST` | `/api/labs/import` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:462` |
| `POST` | `/api/labs/reload` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:487` |
| `GET` | `/api/labs/search` | `authenticateToken` | `server/routes/orders-routes.js:317` |
| `GET` | `/api/labs/stats` | `authenticateToken, requireReviewer` | `server/routes/orders-routes.js:377` |
| `DELETE` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:435` |
| `POST` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:387` |
| `PUT` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:407` |
| `PUT` | `/api/orders/:id/view` | `authenticateToken` | `server/routes/orders-routes.js:205` |
| `GET` | `/api/radiology-database` | `authenticateToken` | `server/routes/orders-routes.js:1427` |
| `POST` | `/api/sessions/:id/order` | `authenticateToken` | `server/routes/orders-routes.js:80` |
| `GET` | `/api/sessions/:id/orders` | `authenticateToken` | `server/routes/orders-routes.js:135` |
| `GET` | `/api/sessions/:sessionId/active-effects` | `authenticateToken` | `server/routes/orders-routes.js:2450` |
| `POST` | `/api/sessions/:sessionId/administer/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2116` |
| `GET` | `/api/sessions/:sessionId/available-labs` | `authenticateToken` | `server/routes/orders-routes.js:833` |
| `GET` | `/api/sessions/:sessionId/available-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1485` |
| `GET` | `/api/sessions/:sessionId/available-treatments` | `authenticateToken` | `server/routes/orders-routes.js:1839` |
| `PUT` | `/api/sessions/:sessionId/discontinue/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2308` |
| `GET` | `/api/sessions/:sessionId/lab-results` | `authenticateToken` | `server/routes/orders-routes.js:1314` |
| `PUT` | `/api/sessions/:sessionId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:1359` |
| `POST` | `/api/sessions/:sessionId/order-labs` | `authenticateToken` | `server/routes/orders-routes.js:995` |
| `POST` | `/api/sessions/:sessionId/order-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1582` |
| `POST` | `/api/sessions/:sessionId/order-treatment` | `authenticateToken` | `server/routes/orders-routes.js:1958` |
| `GET` | `/api/sessions/:sessionId/radiology-orders` | `authenticateToken` | `server/routes/orders-routes.js:1542` |
| `GET` | `/api/sessions/:sessionId/treatment-debrief` | `authenticateToken` | `server/routes/orders-routes.js:2385` |
| `GET` | `/api/sessions/:sessionId/treatment-orders` | `authenticateToken` | `server/routes/orders-routes.js:2343` |
| `GET` | `/api/treatment-effects` | `authenticateToken` | `server/routes/orders-routes.js:2658` |
