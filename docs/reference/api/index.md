# API Reference

> **Generated file — do not hand-edit.** This page and its sibling
> `<area>.md` pages plus `openapi.json` are produced from
> `server/routes/*.js` by `scripts/docs-gen/gen-api.mjs` (single-sourcing
> rule: there is no hand-written endpoint list). Regenerate with:
>
> ```bash
> npm run docs:gen:api
> ```

## Overview

- **Routers:** 21
- **Endpoints:** 336
- **Base path:** all endpoints are mounted under `/api`.
- **Machine-readable spec:** [`openapi.json`](./openapi.json) (OpenAPI 3.1).
  Each operation carries an `x-rohy-source` extension pointing at the exact
  `file:line` it was scanned from.

## Router areas

| Area | Endpoints |
|------|-----------|
| [admin](./admin.md) | 55 |
| [agents](./agents.md) | 23 |
| [analytics](./analytics.md) | 48 |
| [auth](./auth.md) | 6 |
| [cases](./cases.md) | 17 |
| [catalogue](./catalogue.md) | 12 |
| [cohorts](./cohorts.md) | 31 |
| [health](./health.md) | 2 |
| [help](./help.md) | 2 |
| [lessons](./lessons.md) | 17 |
| [notes](./notes.md) | 2 |
| [notification](./notification.md) | 2 |
| [orders](./orders.md) | 36 |
| [oyon](./oyon.md) | 12 |
| [patient-record](./patient-record.md) | 5 |
| [proxy](./proxy.md) | 12 |
| [sessions](./sessions.md) | 7 |
| [surveys](./surveys.md) | 17 |
| [tenants](./tenants.md) | 2 |
| [uploads](./uploads.md) | 7 |
| [users](./users.md) | 21 |

## Authentication & authorization model

Roles are **rank-ordered**; routes gate on a minimum rank, never on string
equality:

| Role | Rank |
|------|------|
| guest | 0 |
| student | 1 |
| reviewer | 2 |
| educator | 3 |
| admin | 4 |

(`user` is a legacy alias normalised to `student`. Source of truth:
`server/middleware/auth.js` — `ROLE_RANKS`.)

- **Token transport:** a JWT is accepted either via the
  `Authorization: Bearer <token>` header **or** an HttpOnly cookie.
- **CSRF:** cookie-authenticated, state-changing requests
  (`POST`/`PUT`/`PATCH`/`DELETE`) must additionally send the
  `X-CSRF-Token` header. Bearer-header requests are exempt.
- **Immediate revocation:** the `active_sessions` table backs logout and
  password-change so a revoked token stops working immediately rather than at
  natural JWT expiry.
- **Middleware vocabulary** (what the *Auth* column in each area page shows):
  - `authenticateToken` — extracts/validates the JWT, populates `req.user`.
  - `requireAuth` — any authenticated user.
  - `requireStudent` / `requireReviewer` / `requireEducator` /
    `requireAdmin` — minimum-rank gates (rank 1 / 2 / 3 / 4).
  - `requireRole(n)` — explicit minimum rank.
  - `requireSameTenant` — tenant-isolation gate.
  - *(empty)* — no auth middleware on the registration line (public, or auth
    applied at router level).

## Error envelope & PII

Error responses and personally-identifiable fields are normalised centrally by
`server/redaction.js` before any response leaves the server. See the
[security / redaction policy](../../security/) for the field allowlist; do not
infer the wire shape from individual handlers.
