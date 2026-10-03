# orders API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

37 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:516` |
| `PUT` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:606` |
| `DELETE` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:785` |
| `PUT` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:711` |
| `PUT` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2554` |
| `GET` | `/api/cases/:id/investigations` | `authenticateToken` | `server/routes/orders-routes.js:53` |
| `POST` | `/api/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:67` |
| `GET` | `/api/labs/all` | `authenticateToken` | `server/routes/orders-routes.js:361` |
| `GET` | `/api/labs/group/:groupName` | `authenticateToken` | `server/routes/orders-routes.js:347` |
| `GET` | `/api/labs/grouped` | `authenticateToken` | `server/routes/orders-routes.js:373` |
| `GET` | `/api/labs/groups` | `authenticateToken` | `server/routes/orders-routes.js:337` |
| `POST` | `/api/labs/import` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:468` |
| `POST` | `/api/labs/reload` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:493` |
| `GET` | `/api/labs/search` | `authenticateToken` | `server/routes/orders-routes.js:321` |
| `GET` | `/api/labs/stats` | `authenticateToken, requireReviewer` | `server/routes/orders-routes.js:383` |
| `DELETE` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:441` |
| `POST` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:393` |
| `PUT` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:413` |
| `PUT` | `/api/orders/:id/view` | `authenticateToken` | `server/routes/orders-routes.js:217` |
| `GET` | `/api/radiology-database` | `authenticateToken` | `server/routes/orders-routes.js:1414` |
| `POST` | `/api/sessions/:id/order` | `authenticateToken` | `server/routes/orders-routes.js:82` |
| `GET` | `/api/sessions/:id/orders` | `authenticateToken` | `server/routes/orders-routes.js:147` |
| `GET` | `/api/sessions/:sessionId/active-effects` | `authenticateToken` | `server/routes/orders-routes.js:2433` |
| `POST` | `/api/sessions/:sessionId/administer/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2099` |
| `GET` | `/api/sessions/:sessionId/available-labs` | `authenticateToken` | `server/routes/orders-routes.js:839` |
| `GET` | `/api/sessions/:sessionId/available-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1472` |
| `GET` | `/api/sessions/:sessionId/available-treatments` | `authenticateToken` | `server/routes/orders-routes.js:1822` |
| `PUT` | `/api/sessions/:sessionId/discontinue/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2291` |
| `GET` | `/api/sessions/:sessionId/lab-results` | `authenticateToken` | `server/routes/orders-routes.js:1311` |
| `PUT` | `/api/sessions/:sessionId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:1356` |
| `POST` | `/api/sessions/:sessionId/order-labs` | `authenticateToken` | `server/routes/orders-routes.js:1002` |
| `POST` | `/api/sessions/:sessionId/order-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1570` |
| `POST` | `/api/sessions/:sessionId/order-treatment` | `authenticateToken` | `server/routes/orders-routes.js:1941` |
| `GET` | `/api/sessions/:sessionId/radiology-orders` | `authenticateToken` | `server/routes/orders-routes.js:1530` |
| `GET` | `/api/sessions/:sessionId/treatment-debrief` | `authenticateToken` | `server/routes/orders-routes.js:2368` |
| `GET` | `/api/sessions/:sessionId/treatment-orders` | `authenticateToken` | `server/routes/orders-routes.js:2326` |
| `GET` | `/api/treatment-effects` | `authenticateToken` | `server/routes/orders-routes.js:2641` |
