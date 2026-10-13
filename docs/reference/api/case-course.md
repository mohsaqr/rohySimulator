# case-course API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

3 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases/:caseId/course-state` | `authenticateToken, requireStudent` | `server/routes/case-course-routes.js:120` |
| `GET` | `/api/cases/:caseId/questionnaire-responses` | `authenticateToken, requireEducator` | `server/routes/case-course-routes.js:241` |
| `POST` | `/api/cases/:caseId/questionnaires/:questionnaireId/responses` | `authenticateToken, requireStudent` | `server/routes/case-course-routes.js:163` |
