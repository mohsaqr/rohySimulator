# Deploy Troubleshooting — symptom-first triage

When something looks wrong in production, find the symptom below and follow
the diagnostic steps in order. Every entry maps a user-visible symptom to
its most common cause and the one-command fix.

For prevention rather than recovery, see
[`docs/DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md). For the full incident
retrospective behind these patterns, see
[`AGENT-NOTE-DEPLOY-2026-05-07.md`](../AGENT-NOTE-DEPLOY-2026-05-07.md).

## How to use this doc

1. Find the section that matches the symptom (the `## Symptom: …`
   headings are the index — Cmd-F them).
2. Run the diagnostic command in step 1 of that section.
3. Walk down the cause table until one matches your output.
4. Apply the fix. Re-smoke with `scripts/smoke.sh "$ROHY_DEPLOY_URL"`.

If none of the causes match, the section ends with a "still stuck" path —
usually `journalctl -u rohy -n 200` and a hand-off to
`docs/INCIDENT_RESPONSE.md`.

---

## Symptom: nginx returns 502 Bad Gateway

rohy isn't listening, OR it accepted the connection then died, OR nginx
can't reach it.

**Step 1 — is rohy running?**

```bash
sudo systemctl status rohy
```

| Output | Cause | Fix |
|---|---|---|
| `inactive (dead)` | The service isn't started. | `sudo systemctl start rohy` |
| `failed` + recent restarts | Crash loop. | Step 2. |
| `active (running)` | rohy IS up — proxy/upstream issue. | Step 3. |

**Step 2 — what's making it crash?**

```bash
sudo journalctl -u rohy.service -n 100 --no-pager
```

| Log line includes | Cause | Fix |
|---|---|---|
| `FATAL: JWT_SECRET environment variable is not set` | env file missing/unreadable. | `ls -la /etc/rohy/env`, check perms (`0600 root:root`). |
| `[env] JWT_SECRET is not set` | env file has the var but with empty value. | Re-generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, paste into `/etc/rohy/env`. |
| `EADDRINUSE` | Another process holds the port. | `sudo lsof -iTCP:4000 -sTCP:LISTEN`. Either stop the squatter or change `PORT=` in `/etc/rohy/env`. |
| `database is locked` repeatedly | DB locked by another writer (cron deploy mid-flight, dev tool open). | Stop the other writer, wait 5s, retry. If persists: `sudo fuser /opt/data/rohy/database.sqlite`. |
| ONNX-Runtime parse error / `Protobuf parsing failed` | Truncated Kokoro `.onnx` from a network blip during re-download. See AGENT-NOTE §4. | Quick-fix below. |
| `Error: Cannot find module '/opt/repos/rohy/node_modules/dynajs/dist/...'` | dynajs sibling repo not built. | `cd /opt/repos/dynajs && npm install --prefer-offline` (NOT `npm ci`). |

**Kokoro quick-fix (when ORT crash is the reason):**

```bash
sudo systemctl stop rohy
rm -rf /var/cache/rohy-hf/onnx-community/Kokoro-82M-v1.0-ONNX 2>/dev/null
rm -rf /opt/repos/rohy/node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX 2>/dev/null
sudo sqlite3 /opt/data/rohy/database.sqlite \
  "INSERT INTO platform_settings(setting_key, setting_value) VALUES ('tts_provider','piper') \
   ON CONFLICT(setting_key) DO UPDATE SET setting_value='piper';"
sudo systemctl start rohy
```

**Step 3 — rohy is up but nginx still 502s.**

```bash
curl -i http://127.0.0.1:4000/api/health      # bypass nginx, hit rohy directly
```

| Output | Cause | Fix |
|---|---|---|
| 200 + JSON body | rohy is fine; nginx upstream is wrong. | Check `proxy_pass` in `/etc/nginx/conf.d/rohy.conf` matches rohy's `PORT=` env. Reload: `sudo nginx -t && sudo systemctl reload nginx`. |
| `curl: (7) Failed to connect` | rohy isn't actually listening despite `active (running)`. | `sudo ss -ltn 'sport = :4000'`. If empty, restart rohy + watch the journal. |
| 200 with HTML but JSON expected | Frontend is serving where the API should be. | nginx `location /api/` block missing — add it. |

---

## Symptom: 503 from `/api/ready` but `/api/health` is 200

The process is up but not yet able to serve. Three sub-causes:

```bash
curl -sk "$ROHY_DEPLOY_URL/api/ready" | jq
```

| `checks.db` | `checks.migrations` | Cause | Fix |
|---|---|---|---|
| `error: ...` | `unknown` | DB unreachable from rohy. | Verify `ROHY_DB` path matches the file rohy can write. `ls -la /opt/data/rohy/`. Owner mismatch? |
| `ok` | `none_applied` | Migrations haven't run. Boot in progress, or `migration` table empty. | Wait 10s, re-probe. If persists, `sudo journalctl -u rohy -n 100` for migration errors. |
| `ok` | `error: ...` | Migration failed. | The new `db.js` snapshots before migrating — the snapshot lives at `/opt/data/rohy/database.sqlite.bak.<ts>.<targetVersion>`. See "DB rollback" below. |
| `ok` | `at NN (NN applied)` | Should be 200, not 503. | Stale ready response — restart rohy: `sudo systemctl restart rohy`. |

---

## Symptom: blank page in browser, all assets 500

CORS rejection masquerading as a generic 500. `server/middleware/errorHandler.js`
maps "Not allowed by CORS" to 403 since the 2026-05-07 hardening — but
a stale build that hasn't picked up that fix may still surface 500.

```bash
sudo journalctl -u rohy -n 200 | grep -i 'CORS Blocked'
```

If you see `[CORS] Blocked request from origin: <url>`, the browser's
origin doesn't match `FRONTEND_URL`. Fix:

```bash
# 1. Identify the origin the browser used (DevTools → Network → Headers → Origin).
# 2. Set FRONTEND_URL to match.
sudo nano /etc/rohy/env
sudo systemctl restart rohy
```

Common gotchas:
- Trailing slash matters. `https://example.com` ≠ `https://example.com/`. Match exactly.
- Subpath deploys: if you serve at `/rohy`, `FRONTEND_URL=https://example.com` is right (origin doesn't include path). 
- IPv6 vs IPv4: `[::1]` vs `127.0.0.1` are different origins. Add both if needed.

---

## Symptom: mic doesn't work / press-to-talk silent

`getUserMedia()` requires a secure context. Plain HTTP on a non-localhost
origin silently denies mic access — no permission prompt, no error.

```bash
echo "$ROHY_DEPLOY_URL"
```

| URL scheme/host | Mic works? | Fix if no |
|---|---|---|
| `https://*` | ✅ | — |
| `http://localhost:*` | ✅ (browser legacy carve-out) | — |
| `http://127.0.0.1:*` | ✅ | — |
| `http://*` (any other) | ❌ | Terminate TLS at nginx (use a self-signed cert if LAN). |

**Self-signed cert on a LAN deploy** (no warning fixup):

```bash
# On a machine with mkcert installed
mkcert -install                                      # local CA → keychain
mkcert -cert-file rohy.crt -key-file rohy.key 192.168.x.x your-host
sudo cp rohy.{crt,key} /etc/ssl/local/
# Then point nginx at /etc/ssl/local/rohy.{crt,key} and reload.
```

---

## Symptom: TTS audio is silent or arrives in one late burst

nginx is buffering audio chunks instead of streaming them. The streaming
TTS endpoint requires specific nginx directives.

```bash
sudo nginx -T 2>/dev/null | grep -E 'proxy_buffering|proxy_request_buffering|chunked_transfer_encoding' | head
```

If you see `proxy_buffering on` (or it's missing entirely — defaults to on),
that's the problem. Set the streaming knobs in
[`deploy/nginx/rohy.conf.example`](../deploy/nginx/rohy.conf.example) §
"Streaming TTS knobs". Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Symptom: rate-limiter rejecting legitimate users

The rate-limiter sees every request as coming from `127.0.0.1` because
Express isn't trusting the proxy.

```bash
sudo journalctl -u rohy | grep -i 'X-Forwarded-For' | tail
```

If you see `ValidationError: 'X-Forwarded-For' header is set but Express 'trust proxy' setting is false`,
the env var `ROHY_TRUST_PROXY` got unset or set wrong. Default is
`'loopback'`, which is right when nginx is on the same host.

```bash
grep ROHY_TRUST_PROXY /etc/rohy/env
# If empty, server.js falls back to 'loopback' — which should be fine.
# If the file explicitly sets 'false', remove it.
```

---

## Symptom: 504 Gateway Timeout / "ROUTE_TIMEOUT"

A request handler took longer than `ROHY_ROUTE_TIMEOUT_MS` (default 30s).
The `routeTimeout` middleware sends a clean 504 with `code: ROUTE_TIMEOUT`
rather than letting nginx surface a generic gateway timeout.

```bash
sudo journalctl -u rohy | grep route-timeout | tail
```

The log line names the path (e.g. `path: '/sessions/123/order'`). Two
common causes:

| Path | Likely cause | Investigation |
|---|---|---|
| `/sessions/.../order` | DB write lock, slow query | Check active queries: `sudo sqlite3 /opt/data/rohy/database.sqlite '.timeout 100' '.tables'` — if it hangs, the DB is locked. |
| `/sessions/.../administer/...` | Slow `treatment_effects` query, malformed effect row | Check the order's payload. The administer route is hardened against NULL fields, but a corrupted effect row can still slow things down. |
| Anything else | Genuinely slow handler — likely an upstream service hanging | Identify the slow upstream via `journalctl` for that path; raise `ROHY_ROUTE_TIMEOUT_MS` only as a last resort. |

The TTS and LLM proxy routes are exempt from this timeout (they stream).
If you see 504 ROUTE_TIMEOUT for `/tts` or `/proxy/llm`, the exemption
list in `server/middleware/routeTimeout.js` got out of sync — file a bug.

---

## Symptom: deploy succeeded but `/api/ready` shows old version

Your `npm run build` didn't run, OR the systemd unit didn't restart, OR
the cron-pull didn't actually pick up the new commit.

```bash
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && git log --oneline -3'
```

| Top commit on server | Cause | Fix |
|---|---|---|
| Matches your local HEAD | Restart didn't happen. | `ssh "$ROHY_SSH" 'sudo systemctl restart rohy'` then re-smoke. |
| One or more commits behind | Cron didn't fire / git pull failed. | SSH in, `cd /opt/repos/rohy && git pull --ff-only origin main` manually. |
| Same commit, but `package.json` changed | `npm ci` didn't run, so a new dep is missing. | `cd /opt/repos/rohy && npm ci --prefer-offline && npm run build && sudo systemctl restart rohy`. |

---

## Symptom: data appears to vanish (settings, OpenAI key, etc.)

This is the canonical incident from 2026-05-07. The root cause is the
audit-chain mutex bug, fixed in commit `6ffff91`. If you see this on a
deploy that includes that commit:

```bash
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && git log --grep="audit-chain" --oneline'
```

Should show the fix commit. If the symptom still reproduces, capture
journal output during the repro:

```bash
sudo journalctl -u rohy -f | tee /tmp/rohy-audit-repro.log
# In another terminal: reproduce the multi-setting save.
# Then grep:
grep -E 'SQLITE_ERROR|cannot start a transaction|audit_chain' /tmp/rohy-audit-repro.log
```

If `cannot start a transaction within a transaction` appears, the mutex
isn't doing its job — check the running file actually contains the FIFO
chain (`grep -A 5 'in-process FIFO' /opt/repos/rohy/server/audit-chain.js`).

If no SQLITE_ERROR but data still vanishes, it's likely a UI/save-path
bug — check `journalctl` for `[audit] entry appended` lines around the
save event.

---

## DB rollback (last resort)

`server/db.js` snapshots the SQLite file before applying any pending
migration. Snapshots live next to the DB:

```bash
ssh "$ROHY_SSH" 'ls -lt /opt/data/rohy/database.sqlite.bak.*'
```

To restore one (this DESTROYS every write since the snapshot):

```bash
sudo deploy/rollback.sh \
    --db /opt/data/rohy/database.sqlite.bak.<TIMESTAMP>.<VERSION> \
    --code <previous-good-sha> \
    --i-am-sure-this-loses-data
```

Refer to [`deploy/rollback.sh`](../deploy/rollback.sh) for the full safety
contract.

---

## Still stuck

```bash
# Capture everything for a hand-off
ssh "$ROHY_SSH" 'sudo journalctl -u rohy -n 500 --no-pager' > rohy-incident-$(date +%s).log
ssh "$ROHY_SSH" 'sudo systemctl status rohy --no-pager' >> rohy-incident-*.log
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && git log --oneline -10' >> rohy-incident-*.log
ssh "$ROHY_SSH" 'cat /etc/rohy/env | sed "s/=.*$/=<redacted>/"' >> rohy-incident-*.log
```

Then read [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) for the
operational playbooks per subsystem (auth, CSRF, persistence, audit-chain,
TTS, JWT, DB).
