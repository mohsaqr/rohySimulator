# Architecture seams

This page maps the request path and the cross-cutting machinery you can't
infer from any single route file. Read it before you add an endpoint, touch
the DB, or debug why a response looks the way it does.

For the endpoint catalogue see the generated [API reference](/reference/api/);
for tables see the [data model](/reference/data/); for terms see the
[glossary](/reference/glossary).

## The request path

A request to `/api/...` flows through three layers, in this order:

1. **`server/server.js`** — process bootstrap: CORS, security headers,
   Kokoro warmup, the voice-catalogue audit. It does *not* define routes.
2. **`server/routes.js`** — route-group composition. It mounts the health
   router, the rate limiter, the per-route timeout, then every area router,
   and conditionally mounts Oyon.
3. **`server/routes/<area>-routes.js`** — the ~20 area routers that hold the
   200+ actual handlers (largest: `admin-routes.js`, `analytics-routes.js`,
   `orders-routes.js`).

Never inline a new endpoint in `server.js`. Pick the matching area router
(or `routes.js` for the legacy `/api/master/*` surface) and add it there.

## Mount order in `routes.js` (order is load-bearing)

```text
healthRoutes            // public, BEFORE the limiter so probes can't be throttled
generalLimiter          // 600 req/min/IP; skips /tts and /proxy/llm
routeTimeout()          // 504 after ROHY_ROUTE_TIMEOUT_MS (default 30s); skips streams
/catalogue → catalogueRouter
authRoutes, usersRoutes, tenantsRoutes, uploadsRoutes,
casesRoutes, sessionsRoutes, analyticsRoutes, notificationRoutes,
ordersRoutes, proxyRoutes, adminRoutes, patientRecordRoutes,
agentsRoutes, notesRoutes, cohortsRoutes
/addons/oyon → live router OR a structured 503 stub
```

Health and readiness are mounted **before** `generalLimiter` on purpose: a
request storm must not be able to rate-limit the monitoring probes. The
per-route timeout is mounted **after** the limiter (so probes are already
answered and exempt) and **before** the handlers (so they're all covered).
It internally skips `/tts` and `/proxy/llm` because those are legitimate
long-running streams.

### Oyon mounts in one of three states

The emotion-capture add-on (`OyonR/`) mounts at `/api/addons/oyon/*`:

- `OYON_ENABLED=1` and the module imports → the live router.
- `OYON_ENABLED=1` but the import throws → a JSON 503 stub with
  `code: 'OYON_IMPORT_FAILED'`.
- `OYON_ENABLED` unset → a JSON 503 stub with `code: 'OYON_DISABLED'`.

The stub matters: an unrouted path would produce a bare Express 404 with no
JSON body, and the frontend would show a generic "Request failed (404)" with
no actionable cause. The stub responds with a structured body so the client
renders an "Oyon is disabled, here's how to enable it" panel instead.

## Cross-cutting middleware

The auth chain lives in `server/middleware/auth.js` and is applied per route,
not globally. See [API authentication](/integrator/api-auth) for the full
contract. The pieces:

- `requestId` propagates `X-Request-Id` for log correlation.
- `requestLogger` writes the NDJSON access log.
- `authenticateToken` resolves the JWT (header or cookie), enforces
  server-side revocation via `active_sessions`, loads the live user row, and
  runs the CSRF check for cookie-auth state-changing requests.
- Role gates are **rank comparisons**, never string equality. Use the
  convenience wrappers `requireAdmin` / `requireEducator` / `requireReviewer`
  / `requireStudent`, or `requireRole(ROLE_RANKS.x)`. The rank ladder is
  `guest(0) < student(1) < reviewer(2) < educator(3) < admin(4)`. The
  constant is `ROLE_RANKS` (not `RANKS`).
- `requireSameTenant(getter)` enforces tenant scoping on routes that need it
  — don't sprinkle ad-hoc `WHERE tenant_id=` in handlers.
- `errorHandler` is last-mile: `throw` or `next(err)` and it formats the
  response.

## Database access goes through `dbAdapter`

New code uses `server/dbAdapter.js`, not the raw `server/db.js` handle. The
adapter wraps the same sqlite3 connection (it does **not** open a second one)
and exposes Promise-returning `get` / `all` / `run` / `serialize` /
`transaction` / `prepare`, plus the portability helpers `now()` and
`upsert()`. This is the Stage E8 Postgres-readiness surface.

Each method accepts an optional Node-style callback, so it bridges old
callback call sites and new `await` ones:

```js
import dbAdapter from '../dbAdapter.js';

// Promise style (preferred in new code)
const row = await dbAdapter.get(
  'SELECT id, role FROM users WHERE id = ?',
  [userId]
);

// Atomic multi-statement work
await dbAdapter.transaction(async () => {
  await dbAdapter.run('UPDATE cohorts SET name = ? WHERE id = ?', [name, id]);
  await dbAdapter.run('INSERT INTO audit_log (action) VALUES (?)', ['rename']);
});
```

Two footguns the adapter actively guards against:

- **Pass params as an array.** `dbAdapter.run(a, b, c, fn)` throws a
  `TypeError` immediately rather than silently shifting `b` into the callback
  slot. Always `dbAdapter.run(sql, [a, b, c], fn)`.
- **Fire-and-forget transaction control is logged.** A bare
  `dbAdapter.run('COMMIT')` with no callback that fails (BUSY, constraint)
  is logged loudly at the adapter level — a silently-failed COMMIT leaves
  the connection in a pending transaction and the next `BEGIN` throws (the
  cascade behind the 2026-05-08 chat 502 incident). Pass a callback or
  `await` the promise if you need to handle the error.

Portability fragments for code that must outlive SQLite:

```js
import { now, upsert } from '../dbAdapter.js';

// now()    → "datetime('now')"  (maps to NOW() on Postgres)
// upsert() → INSERT ... ON CONFLICT (...) DO UPDATE SET ...
const sql = upsert('cohort_members', ['cohort_id', 'user_id'], ['member_role']);
```

## Response redaction

`server/redaction.js` centralizes which fields get stripped before any
response leaves the server (`apiKey`, tokens, scope-controlled PII). If you
add a sensitive field anywhere, register it there — do not `delete obj.foo`
at the call site, or it will leak through every other path that returns the
same shape.

## Snapshot binding (an invariant that spans files)

When a session starts, the server **freezes** `cases.config` +
`cases.scenario` into `sessions.case_snapshot`. The running monitor, orders,
and exam surfaces read from the snapshot, not the live `cases` row. Two
consequences you must design around:

- Admin edits to a case during a live session **do not bleed in**.
- A bug fix that touches case data **won't help an already-running session**
  until it restarts.

This is regression-locked at the unit and e2e layers (Stage-1 audit fix).
Don't "fix" it by reading the live row in a running session.

::: tip
The two parallel surfaces over the same drug/lab data
(`/api/master/*` scope-blind legacy vs `/api/catalogue/*` scope-aware) are
deliberate during the Session-3 migration, not duplication. Edit/delete
authz for the catalogue is centralized in `canMutate()` in
`server/routes/catalogue.js` — don't reimplement it at call sites.
:::
