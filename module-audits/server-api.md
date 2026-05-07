# Server API Module Audit

Files reviewed:
- `server/routes.js`
- `server/routes/catalogue.js`
- `server/server.js`

Enterprise assessment:
- Route surface is broad: 229 route declarations across the primary router and catalogue router.
- Most business endpoints are protected by `authenticateToken`; mutation routes generally add role middleware where appropriate.
- Rate limiting is present globally and separately for auth/register.
- Request IDs, request logging, and terminal error middleware are wired in `server/server.js`.

Findings:
- Medium: public reference endpoints should remain intentionally public only if they contain no tenant, learner, or instructor data. Current unauthenticated routes include `/bodymap-regions`, `/learning-events/verbs`, several `/master/*` reads, and `/platform-settings/monitor`. These look mostly static, but they should be tracked as an explicit allowlist with tests so future additions do not accidentally become public.
- Medium: `server/routes.js` is very large and mixes auth, analytics, case lifecycle, orders, TTS, settings, and patient-record concerns. This raises review cost and increases the chance that a future endpoint misses tenant or role scoping.
- Low: CORS allows all origins in development. This is acceptable for local work, but enterprise pre-prod should run with production CORS settings during smoke tests to catch integration drift.

Recommended next tests:
- Add per-domain route tests for public master-data responses to prove they do not include secrets or tenant-scoped records.

Status:
- Added `tests/server/route-auth-allowlist.test.js` to fail on newly public routes unless explicitly allowlisted.
