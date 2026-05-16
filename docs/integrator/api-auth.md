# API authentication

Every `/api/*` endpoint except the public health probes and the
login/register pair requires an authenticated request. This page is the
contract for getting and using a token. Endpoint shapes are in the generated
[auth reference](/reference/api/auth); roles are in the
[glossary](/reference/glossary).

## Two token transports

`authenticateToken` (in `server/middleware/auth.js`) accepts the JWT from
**either**:

- the `Authorization: Bearer <token>` header (legacy / programmatic
  clients), **or**
- the `rohy_auth` **HttpOnly cookie** (preferred for browsers).

When both are present the **header wins** — this covers the migration window
where a tab might briefly hold a localStorage token while the cookie is not
yet set. A present-but-malformed `Authorization` header is treated as a
client bug: it returns **400** with a `code` (`no-scheme-separator`,
`unsupported-scheme`, `empty-token`, `whitespace-in-token`) rather than
silently falling through to 401.

`/api/auth/login` returns the JWT in the JSON body **and** sets two cookies:

- `rohy_auth` — HttpOnly, the JWT. Browser JS cannot read it.
- `rohy_csrf` — **not** HttpOnly, a CSRF token. Browser JS reads it.

## CSRF (cookie-auth path only)

Because the auth cookie is auto-attached cross-site, cookie-authenticated
**state-changing** requests (`POST` / `PUT` / `PATCH` / `DELETE`) must carry
an `X-CSRF-Token` header whose value equals the `rohy_csrf` cookie
(double-submit pattern, timing-safe compared server-side). Mismatch → 403.

CSRF is **not** enforced when:

- the request authed via the **Bearer header** (a cross-site attacker cannot
  auto-attach an `Authorization` header), or
- the method is a read (`GET` / `HEAD`), or
- the path is login/register (no session yet).

So a server-to-server client using the Bearer header never needs the CSRF
header. A browser client using cookies must echo it on every mutation.

## Server-side revocation (`active_sessions`)

A valid JWT signature is **not** sufficient. After verifying the signature
and expiry, `authenticateToken` looks up the token's SHA-256 hash in
`active_sessions`:

- Row exists and `is_active = 0` → **401 Session revoked** (logout, admin
  force-logout, or password change), even though the JWT is still
  cryptographically valid.
- Row exists and `expires_at` is past → **401 Session expired**.
- No row at all → accepted (legacy token issued before this check landed;
  bounded by the 4h JWT TTL).

The default JWT TTL is 4h (`JWT_EXPIRY` env var overrides it, e.g. `7d` for
a kiosk). Logout revokes the exact session via the stashed token hash;
admins revoke others via the active-sessions admin endpoints.

## Roles

Authorization is rank comparison, never string equality:

```text
guest(0) < student(1) < reviewer(2) < educator(3) < admin(4)
```

The wire role `educator` is surfaced in the UI as **Teacher**; only the
label changed. The role `user` is normalized to `student` (same rank).

## Worked example: login then an authenticated call

### Bearer header (programmatic — no CSRF needed)

```bash
# 1. Log in. Capture the token from the JSON body.
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# 2. Use it. GET needs no CSRF header regardless of transport.
curl -s http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $TOKEN"

# 3. A state-changing call over Bearer also needs no CSRF header.
curl -s -X POST http://localhost:3000/api/settings/log \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"event":"docs-smoke-test"}'
```

### Cookie + CSRF (browser-style)

```bash
# 1. Log in, persisting both cookies to a jar.
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}' > /dev/null

# 2. Read the (non-HttpOnly) CSRF cookie value out of the jar.
CSRF=$(awk '$6=="rohy_csrf"{print $7}' cookies.txt)

# 3. State-changing call: send the cookie jar AND the matching header.
curl -s -b cookies.txt -X POST http://localhost:3000/api/settings/log \
  -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"event":"docs-smoke-test"}'

# 4. Log out — this flips is_active=0 on the active_sessions row, so the
#    token is dead even before its 4h TTL.
curl -s -b cookies.txt -X POST http://localhost:3000/api/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

::: warning
Replace `http://localhost:3000` with your deployment origin and use real
credentials. The `rohy_auth` cookie is HttpOnly by design — a browser
client never reads it; it only ever reads `rohy_csrf` to populate the
`X-CSRF-Token` header.
:::
