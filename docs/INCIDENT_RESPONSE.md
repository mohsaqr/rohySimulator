# Incident response runbook

Operational playbooks for the failure modes the audit ("Things the audit
itself missed") and the cookie/auth/CSRF rollout introduced. This is a
living document — when a new incident shape happens, add the playbook.

The order below is roughly "most likely to need fast response" first.

---

## 1. "Every user is locked out"

### Symptoms
- Every authenticated request returns `401 "Session revoked"` or
  `401 "Session expired"`.
- New logins succeed but the next request immediately 401s.

### Likely cause
A migration or admin script set `is_active = 0` on every row in
`active_sessions`, OR set `expires_at` to a past timestamp.
`server/middleware/auth.js` consults this table and rejects any token
whose row is `is_active=0` or expired (audit #2). With no valid rows,
nobody can authenticate.

### Diagnosis (60 seconds)
```bash
# How many sessions are claimed-active vs reality?
sqlite3 server/database.sqlite \
  "SELECT COUNT(*) FROM active_sessions WHERE is_active=1 AND expires_at > datetime('now');"
```
If the count is zero or near-zero on a system that has logged-in users,
that's the smoking gun.

### Recovery (least to most disruptive)
1. **Restore the table from backup.** Cleanest. Stop the server, replace
   `active_sessions` rows from the most recent backup, restart.

2. **Truncate the table.** Forces every signed-in user to re-login. Less
   data-recovery work; same end result for users.
   ```sql
   DELETE FROM active_sessions;
   ```
   `authenticateToken` accepts tokens with NO `active_sessions` row at all
   (legacy compatibility — see audit #2). Existing JWTs continue working
   for their natural ~4h TTL; new logins create fresh rows. Worst case the
   user has to re-login at the 4h mark.

3. **Bulk-reactivate everything.** Last resort if you can't tell which
   rows were legitimately revoked vs. mass-corrupted.
   ```sql
   UPDATE active_sessions SET is_active = 1
   WHERE expires_at > datetime('now');
   ```
   Only do this if you're sure the corruption was unintentional —
   reactivating means restoring access for any user who was admin-revoked.

### Prevention
- Migrations that touch `active_sessions` should be reviewed for
  `UPDATE … SET is_active=0 WHERE …` with no narrow `WHERE`.
- Admin force-logout endpoint scopes by `id` and `tenant_id`; ad-hoc SQL
  in production should follow the same shape.

---

## 2. "Cookies are not being sent / CSRF rejecting everything"

### Symptoms
- Every state-changing request returns `403 "CSRF token missing"`.
- Login appears to succeed but subsequent requests fail.

### Likely causes (in order of frequency)
1. **Browser is blocking third-party cookies.** Cookie `SameSite=Lax`
   normally protects but a strict-blocking extension or a browser in
   strict-tracking mode can drop the cookie on cross-site navigations.
2. **Origin mismatch.** App is served from `app.example.com` but the
   API call goes to `api.example.com` — different origin, cookie
   doesn't auto-attach unless `credentials:'include'` is set AND the
   cookie was issued with `SameSite=None`.
3. **`rohy_csrf` cookie was never issued.** Login on a stale tab
   pre-dating the cookie deploy.

### Diagnosis
Open DevTools → Application → Cookies → check both `rohy_auth` and
`rohy_csrf` are present for the app's origin. If `rohy_csrf` is missing
but `rohy_auth` is there, the user logged in before the CSRF deploy.

### Recovery
- For an individual user: have them log out and log back in. Both cookies
  are set fresh on `/auth/login`.
- For an outage: confirm the server is setting both cookies in the login
  response (check Network → /auth/login → Response Headers → Set-Cookie).
  If the cookies aren't being set at all, look at
  `server/middleware/csrf.js` and `server/routes.js` for a deploy regression.

### Prevention
- The DiagnosticBar shows backend telemetry but doesn't yet count CSRF
  failures specifically. If CSRF-failure spikes show up downstream of a
  deploy, that's a strong signal something cookie-related changed.

---

## 3. "Backend persistence is silently dropping rows"

### Symptoms
- Alarm log table entries don't match in-memory clinical alarm
  occurrences.
- Learning analytics graphs are empty or sparse.

### Diagnosis
- Open DiagnosticBar on an admin/educator account (audit #22). The
  "Backend persistence (audit #20)" section shows live counters for
  `alarm-log fails`, `alarm-ack fails`, `telemetry fails`. Non-zero
  counters render in amber.
- Recent failures are listed with `kind` + `reason` + HTTP status.
- Read the response status: `0` = network failure, `4xx` = auth/validation
  drop, `5xx` = server error.

### Recovery
- 401 burst → an admin force-logout or password-change campaign just
  invalidated the user's session. They re-login, the next BackendSurface
  flush ships the queued telemetry.
- 5xx burst → backend route is broken. The bounded re-queue (max 500)
  drops oldest events first; you're losing data until the route recovers.
  Check `server/routes.js` for the relevant endpoint.

### Prevention
- BackendSurface telemetry counters can be wired to alerting once you
  have a metrics shipper. Today they're per-tab and lost on refresh —
  good for live triage, useless for trend tracking.

---

## 4. "Slow / unresponsive / 503 on TTS"

### Symptoms
- Voice playback never starts.
- Server logs show `FetchTimeoutError` from `server/services/openaiTts.js`
  or `server/services/googleTts.js`.

### Diagnosis
- The audit-#10 `fetchWithTimeout` wrapper caps each TTS provider call at
  30s. A hard `FetchTimeoutError` means the upstream provider is genuinely
  unresponsive.
- Check `process.env.OPENAI_API_KEY` / `GOOGLE_TTS_KEY` — bad/expired
  credentials manifest as 401 from the upstream, not a timeout.

### Recovery
- Switch TTS providers via `platform_settings.tts_provider`. Kokoro and
  Piper run locally and are unaffected by upstream cloud outages.
- If multiple providers fail simultaneously, voice mode is unavailable.
  The runtime falls back to text-only chat — no clinical capability is
  lost, just the voice channel.

### Prevention
- Add retry / circuit-breaker on top of `fetchWithTimeout` (audit #10
  follow-up — listed as deferred in the session handoff).

---

## 5. "Refresh-token loop / user can't stay logged in past 4 hours"

### Symptoms
- User reports being logged out after exactly the JWT TTL.
- DevTools shows `POST /api/auth/refresh` returning 401 repeatedly.

### Diagnosis
- `AuthContext` schedules a refresh every 3 hours. If the refresh 401s,
  the user is logged out client-side and must re-login.
- 401 from `/auth/refresh` means the active_sessions row was revoked
  between the user's last successful request and the refresh attempt
  (logout, admin force-logout, password change).
- 401 with `error: 'Session expired'` means the cookie's expires_at
  passed before the refresh fired (window was longer than 4h).

### Recovery
- For a single user: re-login. The refresh tick re-arms after `setUser`
  is called.
- For an outage (everyone refreshing fails): same as section 1 — likely
  active_sessions corruption or a clock-skew bug. Check the dev box's
  clock + the audit-fix that added `'Z'` to the expires_at parser.

### Prevention
- Refresh interval (3h) is well below the 4h JWT TTL with margin. If you
  shorten the JWT TTL via `JWT_EXPIRY` env var, also shorten the refresh
  interval in `src/contexts/AuthContext.jsx`.

---

## 6. "Admin says I rotated keys; clients still authenticate with old JWT"

### Symptoms
- Rotated `JWT_SECRET` in deploy; expected all sessions to invalidate.
- Some users keep working.

### Likely cause
The audit-#2 active_sessions check accepts tokens with NO row (legacy
compatibility). If JWT_SECRET was rotated but the active_sessions table
was not cleared, **the new server will reject the old JWT signatures
correctly** — so this concern is mostly moot. If users keep working,
their browser is using cookies the new server's secret can't verify, and
the request should 403 with `Invalid or expired token`.

### Recovery
- A JWT secret rotation is itself the invalidation. If users *aren't*
  being kicked out, the rotation didn't actually take effect — check the
  server's `process.env.JWT_SECRET` matches what you intended.
- Force-logout sweep:
  ```sql
  UPDATE active_sessions SET is_active = 0;
  ```
  Combined with the JWT secret rotation, no token from before the
  rotation can authenticate against the new server.

---

## 7. "Database is locked / slow"

### Symptoms
- Any SQL operation hangs or fails with `SQLITE_BUSY`.
- Server logs show queries piling up.

### Diagnosis
- SQLite is single-writer. A long-running migration or a large `INSERT`
  blocks all other writes.
- `dbAdapter.js` Promise wrappers serialize callbacks; the database file
  itself may be locked by another process (e.g. an admin running a query
  via `sqlite3` CLI).

### Recovery
1. `lsof server/database.sqlite` — find any process holding it.
2. If it's a stuck migration: there is no clean abort; restart the server.
   The migration runner uses BEGIN/COMMIT, so a partial run rolls back
   and the next boot retries (audit #13 covers this contract).
3. If volume is the cause, look at `instrumentSqliteDb()` slow-query
   alerts — the test `tests/server/observability/slow-query-alerting.test.js`
   pins the threshold mechanism.

---

## Adding a new playbook

Format:
- Heading: short title of the failure mode.
- Symptoms: what the operator sees.
- Likely cause: the most common root cause first.
- Diagnosis: a one-or-two-command check.
- Recovery: ordered from least to most disruptive.
- Prevention: what we'd add to make it not happen again.

Keep recovery steps in order of escalation. Don't bury "restore from backup"
under five other recipes.
