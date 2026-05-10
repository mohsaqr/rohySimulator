# Deploying Rohy to production

Once you've installed (see [INSTALL.md](INSTALL.md)), this document
covers production hardening: reverse proxy, TLS, environment, security
checklist, deploy verification, and monitoring. For ongoing upgrades
see [UPDATING.md](UPDATING.md).

---

## Build-from-source vs published-image

Two ways to get rohy running in production:

| Approach | When to use | Source of truth |
|---|---|---|
| **Pulled image** (recommended) | You want a byte-identical deploy across boxes, with the same image other operators are running | `ghcr.io/mohsaqr/rohy:vX.Y.Z` published per tagged release. Each tag is verified by the release workflow's `verify-published-image` job *before* the artifact is announced — boots, answers `/api/health`, passes `tech-test.sh`, serves every Oyon vendor asset. |
| **Built from source** | You're modifying rohy / running on an arch we don't publish (ARM64 boards beyond the matrix) | `docker compose build` against the local checkout. Use this for `main` HEAD or for forks. |

For production deploys, **prefer pulled images**. The release workflow
runs every check `tech-test.sh` runs *against the actual published
artifact* before the tag is finalised — so "tag exists" already means
"verified to boot." Building from source on a fresh box adds 10-12 min
to deploy time and re-walks every install-path failure mode that the
nightly install-from-scratch workflow already catches.

The compose file ships with `build:` directive uncommented for the
source path. Switch to image-pull:

```yaml
# deploy/docker/compose.yml
services:
  rohy:
    # build: { context: ../.., dockerfile: deploy/docker/Dockerfile }
    image: ghcr.io/mohsaqr/rohy:v1.0.0
    # … rest of service config unchanged
```

Pin to an exact tag (not `:latest`) for reproducible deploys. Operators
who deploy `:latest` get a moving target with every push to `main` once
we publish more tags.

---

## Production checklist

Walk this before any user touches the box:

- [ ] **Strong, unique `JWT_SECRET`** in `/etc/rohy/env` (`openssl rand -hex 32`). Server refuses to start without one.
- [ ] **HTTPS in front** of Express. Never expose port 4000 directly. nginx, Caddy, or Cloudflare Tunnel are all fine.
- [ ] **`FRONTEND_URL`** set to your public origin so CORS allows only that origin.
- [ ] **Default seeded users disabled** (default in `NODE_ENV=production` — confirm `ALLOW_DEFAULT_USERS` is *not* set).
- [ ] **First admin password rotated** if you used `--admin-bootstrap`. Default credentials are intentionally short-lived.
- [ ] **Rate limits reviewed** in Platform Settings → Rate limits.
- [ ] **LLM API keys scoped** to this app — at minimum, separate from your personal keys. Anthropic / OpenAI / Google all support per-project keys.
- [ ] **Retention sweep cron installed** (see [§ Retention](#retention) below).
- [ ] **Off-site backup configured** (see [UPDATING.md § Off-site backups](UPDATING.md#off-site-backups)).
- [ ] **Observability log shipper wired** to NDJSON stdout, or set `ROHY_LOG_LEVEL=warn` if you don't ship logs.
- [ ] **Migration to Postgres considered** if you expect >50 concurrent users (Stage E8 adapter is ready; see [§ Postgres](#postgres-readiness)).
- [ ] **Deploy verifier wired** into your CI/cron (see [§ Deploy verification](#deploy-verification--live-monitoring)).
- [ ] **Contract probe armed** if you care about Oyon validator drift (see [§ Contract probe](#oyon-contract-probe-armed-deploy-verification)).

---

## Reverse proxy

### nginx (default)

`bootstrap.sh --proxy=nginx` writes a tested vhost. The key parts (if
you're rolling your own):

```nginx
server {
    listen 443 ssl http2;
    server_name your-host;

    ssl_certificate     /etc/letsencrypt/live/your-host/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-host/privkey.pem;

    # rohy mounts at /rohy (path-prefix). Adjust if you mount at root.
    location /rohy/ {
        proxy_pass         http://127.0.0.1:4000/;     # trailing slash strips /rohy
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 300s;
        client_max_body_size 25M;                     # for case JSON imports + image uploads
    }

    # Oyon standalone analytics page (optional — only if you've enabled Oyon)
    location /oyon/ {
        proxy_pass         http://127.0.0.1:4000/oyon/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

Reload after edits: `sudo nginx -t && sudo systemctl reload nginx`.

### Caddy

`deploy/docker/compose.yml` ships with Caddy. Auto-TLS via Let's
Encrypt, no cert renewal cron needed. The Caddyfile template:

```
{$CADDY_DOMAIN} {
    reverse_proxy rohy:4000
    encode gzip
    tls {$CADDY_EMAIL}
}
```

For a non-Docker Caddy, the principle is identical — `reverse_proxy
127.0.0.1:4000` with the path-prefix you want.

### Path-prefix vs root

`bootstrap.sh --frontend-url=https://your-host/rohy` builds the SPA
with `--base=/rohy/`. For root-mount (`https://your-host/`), pass
`--frontend-url=https://your-host` (no trailing path) and the build
runs with `--base=/`. **Do not mix**: a SPA built with `/rohy/` base
served at `/` will 404 every asset.

---

## TLS

### Public host (Let's Encrypt)

```bash
sudo certbot --nginx -d your-host
```

certbot installs a renewal timer automatically. Confirm:

```bash
sudo systemctl list-timers | grep certbot
```

### LAN host (self-signed)

For internal labs without a public DNS name:

```bash
sudo bash scripts/gen-self-signed-tls.sh \
    --domain 192.168.50.39 \
    --out /etc/ssl/rohy/
```

Then point nginx at the generated cert. **Self-signed means clients
must accept the cert manually** the first time. For deploy verification
against a self-signed host, pass `ROHY_INSECURE=1` to `tech-test.sh`.

---

## Environment reference

Set in `/etc/rohy/env` (systemd) or `deploy/docker/.env` (compose):

### Required

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Server refuses to start without it. `openssl rand -hex 32`. |

### Common

| Variable | Default | Effect |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` in real deploys. Disables seeded default users. |
| `PORT` | `3000` (dev) / `4000` (bootstrap) | Express upstream port. Falls through to next free in dev only. |
| `FRONTEND_URL` | none | Allowed CORS origin in production. Required if your reverse proxy is on a different host. |
| `JWT_EXPIRY` | `4h` | Token TTL. Roles/status refresh from `users` on every request anyway. |
| `ROHY_DB` | platform-default | Override the SQLite file location. Use this for non-default install paths. |
| `OYON_ENABLED` | `1` | Disable Oyon routes (`0`) — Settings tab shows a friendly panel, binary bundles still ship. |
| `ALLOW_DEFAULT_USERS` | unset | Set to `1` to keep seeded `admin/admin123` etc. in production (do not use unless you're seeding and immediately rotating). |

### Observability

| Variable | Default | Effect |
|---|---|---|
| `ROHY_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. Change to `warn` in production if you're not shipping logs. |
| `ROHY_LOG_SKIP_PATHS` | `/api/proxy/llm,/health` | Comma-separated paths to exclude from access logging. LLM proxy is excluded by default because the body contains the full prompt. |
| `ROHY_SLOW_QUERY_MS` | `100` | Log a warning when a SQL query exceeds this. |
| `ROHY_RETENTION_DAYS` | `90` | Default retention for time-bounded logs (overrideable in Platform Settings). |

### LLM (set per-provider in Platform Settings, but env overrides work)

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Override Platform Settings. Per-platform precedence: platform-setting → env → none. |
| `OLLAMA_BASE_URL`, `LM_STUDIO_BASE_URL` | Local LLM endpoints. Default to `http://localhost:11434` and `http://localhost:1234`. |

---

## Deploy verification & live monitoring

### Smoke (lightweight)

```bash
scripts/smoke.sh https://your-host/rohy
```

Just liveness — does the service answer, does the SPA shell load.

### Full verify (27 checks)

```bash
scripts/tech-test.sh https://your-host/rohy
ROHY_INSECURE=1 scripts/tech-test.sh ...               # for self-signed certs
ROHY_VERBOSE=1  scripts/tech-test.sh ...               # print response bodies on FAIL
```

Sections:

1. **Liveness** — `/api/health`, `/api/ready`, SPA shell
2. **Frontend bundle** — JS + CSS bundles load with content-hashed filenames
3. **Oyon API surface** — every Oyon route returns 401 (mounted) or 503 (disabled stub) — never bare 404
4. **Oyon static assets** — nginx parity for `/oyon/standalone/`
5. **Auth gating** — protected routes refuse 2xx without a token
6. **Oyon contract probe** (auth'd, optional — see below)
7. **Security headers** — CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS
8. **Response timing** — every check under 5s

Wired automatically into:
- **`bin/rohy-update`** — runs after every successful upgrade; failure rolls back
- **SaqrServer hub deploy** — `POST_VERIFY_rohy` line in `JStats/website/sites.conf`

### Oyon contract probe (armed deploy verification)

Without arming, `tech-test.sh` only verifies routes are *mounted* — not
that the validator actually catches malformed batches. To make every
deploy POST a deliberately-bad emotion batch and assert the validator
responds 400 with the correct error message:

```bash
# One-time per operator host
cat > ~/.rohy-deploy-creds <<EOF
ROHY_LOGIN_URL='https://your-host/rohy/api/auth/login'
ROHY_DEPLOY_USER='deploy-verifier'
ROHY_DEPLOY_PASS='<password>'
EOF
chmod 600 ~/.rohy-deploy-creds
```

The credentials must belong to a real rohy user — any role works, the
contract probe doesn't read data, it just needs to pass
`authenticateToken` so the route reaches the validator. A dedicated
low-privilege account is recommended.

After that, **the wrapper handles the rest automatically** — `bin/rohy-update`
prefers `scripts/post-verify-rohy.sh` (mints a token, runs tech-test.sh
with `ROHY_TOKEN` set), and the SaqrServer hub deploy points
`POST_VERIFY_rohy` at the same wrapper. If the creds file is absent,
the probe silently skips and the deploy still passes on the other 27
checks. Strict no-regression.

What this catches: the May-2026 "label-set drift" bug class — when
client and server disagree about which emotions are valid. The probe
sends a 7-of-8 batch summing to 0.875 and asserts the server returns
400 + "sum close to 1" in the body. If the validator's tolerance is
ever silently relaxed, the probe fails the deploy.

### Live operator dashboard

```bash
curl -ksS https://your-host/rohy/api/addons/oyon/admin/health \
     -H "Authorization: Bearer $TOKEN" | jq
# → {
#     "endpoints": {
#         "POST /emotion-records": { "count_5m": 0, "count_1h": 0, ... },
#         ...
#     },
#     "total_5m": 0,
#     "total_1h": 0,
#     "generated_at": "2026-05-10T..."
# }
```

`/api/addons/oyon/admin/health` returns per-endpoint 4xx + 5xx
rejection counts for the last 5 minutes and last hour. In-memory,
per-process — lost on restart, which is fine for a "did the last
deploy break something?" indicator.

Operator gate matches `/admin/live` — educator+ role with the per-role
view-enabled flag set on the tenant.

**Use cases**:
- After deploy: curl it. `total_5m` should be 0. Non-zero → something
  in the new build is rejecting traffic.
- During incident: curl it. Tells you which endpoint is spiking 4xx
  without parsing journalctl.
- Ongoing: scrape it from Prometheus / your monitoring of choice via a
  10-line exporter.

---

## Retention

Time-bounded tables (logs, audit, login_logs, llm_request_log,
tts_usage, learning_events, oyon_emotion_records when retention is
configured per-tenant) are swept by:

```bash
node scripts/retention-sweep.js
```

Cron pattern (runs daily at 03:00):

```cron
0 3 * * * cd /opt/repos/rohy && /usr/bin/node scripts/retention-sweep.js >> /var/log/rohy/retention-sweep.log 2>&1
```

Default retention is 90 days, overrideable in Platform Settings →
Retention. Per-tenant Oyon retention is set in Settings → Oyon (uses
`oyon_settings.retention_days`).

---

## Backups

Standalone snapshot:

```bash
sudo scripts/rohy-backup.sh --label baseline
sudo scripts/rohy-backup.sh --check                   # verify the snapshot is readable
sudo scripts/rohy-backup.sh --list                    # show local snapshots
```

`bin/rohy-update apply` snapshots automatically before every upgrade.
Retention by default keeps the **last 10 snapshots** + **monthly for 12
months** + always protects snapshots <24h old.

Off-site backup is an operator concern and not done automatically by
default. See [UPDATING.md § Off-site backups](UPDATING.md#off-site-backups)
for rsync and rclone recipes (1-line cron each).

Restore:

```bash
sudo rohy-update list-backups                         # show snapshots
sudo rohy-update restore-backup <snapshot-name>       # restore arbitrary
sudo rohy-update rollback                             # restore most-recent
```

---

## Postgres readiness

Stage E8 (Connection pooling + portability) added a Promise-based
`dbAdapter.js` shim with SQL fragment helpers (`now()`, `upsert()`).
The codebase is Postgres-ready in the sense that:

- All SQL goes through the adapter
- No SQLite-specific syntax in route handlers
- `uuid_generate_v4()` style functions are abstracted

What's needed to actually flip:

1. Provision Postgres (managed: RDS / Cloud SQL / Neon / Supabase, or self-hosted)
2. Set `ROHY_DB_DRIVER=postgres` and `ROHY_DB_URL=postgresql://...` in env
3. Run migrations against the new DB (the runner accepts both drivers)
4. Re-stamp baseline + dump from SQLite → Postgres if you have data to migrate

Worth doing if you expect >50 concurrent users or want to scale the
read path with read replicas. SQLite is fine for everything below that
on modern hardware (we hit ~100 sustained req/s on a Raspberry Pi 4
with WAL mode in `bench/`).

---

## Security

### What's protected by default

- **Secrets redacted** before any response leaves the server (`server/redaction.js` policy at Stage E5). API keys, tokens, password hashes scrubbed.
- **CSRF**: SPA uses bearer tokens, not cookies, so classic CSRF doesn't apply. The `rohy_session` cookie is for the *standalone* Oyon page only.
- **CORS** scoped to `FRONTEND_URL`.
- **Rate limits**: 10 logins / 15min / IP, 5 registrations / hour / IP, 600 req/min/IP general (configurable in Platform Settings).
- **bcrypt** password hashing, JWT tokens with 4h default TTL.
- **Audit logging** on sensitive mutations (Stage E4) — `oldValue`, `newValue`, metadata, hash chain.
- **Soft-delete + retention sweep** (Stage E7).
- **Multi-tenant scoping** (`tenant_id` on 40+ tables, `requireSameTenant()` middleware).
- **Mass-assignment-resistant inserts** via column allowlists in route handlers.

### What you should add

- **WAF / rate-limiter at the edge** (Cloudflare, AWS WAF, fail2ban with nginx logs). Express's rate-limiter is per-process; behind a load balancer it's per-instance.
- **Log shipper** for the NDJSON access log. SIEM, Loki, or just `journalctl --output=cat` piped to S3 daily.
- **Backup encryption** if you're rsync'ing snapshots off-site (`gpg --symmetric` is fine).
- **Egress monitoring** if you've granted LLM API keys — set per-provider quotas in their dashboards.

### What we don't do

- **No MFA on operator accounts.** Add it via your reverse proxy (Caddy + OIDC, nginx + Authelia) if you need it.
- **No automatic secret rotation.** `JWT_SECRET` rotation invalidates all sessions; do it during a maintenance window with `bin/rohy-update apply` triggering a restart.
- **No FIPS / HIPAA compliance attestation.** The codebase is built to pass these in principle but has no formal certification.

---

## Multi-user setup

### Roles

| Rank | Role | Capabilities |
|---|---|---|
| 0 | guest | Pre-authentication |
| 1 | student / trainee | Run sessions, talk to patient, order labs/treatments, view own history |
| 2 | reviewer | Read-only analytics + catalog access |
| 3 | educator | Create / edit cases, scenarios, agents, lab catalogs |
| 4 | admin | Full authoring + user management, platform settings, audit logs, soft-delete + purge |

Hierarchy enforced via `requireRole()` middleware. Token refresh on
every request re-reads role/status/tenant_id from the `users` table so
demotions / suspensions take effect immediately.

### Tenants (Stage E6)

Multi-tenant ready. `tenants` table + `tenant_id` columns on 40+
tables, scoped queries everywhere, `requireSameTenant()` middleware
prevents cross-tenant reads. Single-tenant deploys still create a
default tenant (id=1) so the schema is consistent.

To enable a second tenant: create the row in `tenants`, then assign
users via `users.tenant_id`. The admin UI exposes this under Settings
→ Users → Tenant assignment.

### Cohorts

Optional grouping within a tenant. `cohorts` table + `users.cohort_id`.
Used by analytics roll-ups to filter by class / group / cohort.

---

## Disabling features

| Feature | How to disable |
|---|---|
| **Oyon (emotion capture)** | `OYON_ENABLED=0` in `/etc/rohy/env`, restart. Settings tab shows friendly disabled panel; binary bundles still ship. |
| **Local TTS (Piper)** | Don't run `install-piper.sh`; Settings → Voice will hide Piper voices. |
| **Local TTS (Kokoro)** | Set Voice → Provider to anything else; Kokoro download skips. |
| **Cloud LLMs** | Don't set the provider's API key in Platform Settings. UI disables that provider. |
| **Self-registration** | Set `ALLOW_REGISTRATION=0` in env. Users must be created by an admin. |
| **Default seeded users** | Default in `NODE_ENV=production`. Re-enable for dev with `ALLOW_DEFAULT_USERS=1`. |

---

## Next

- **Need to upgrade?** → [UPDATING.md](UPDATING.md)
- **Audit / compliance review?** → [`docs/audits/`](audits/)
- **Embedding Oyon into another app?** → [`OyonR/INSTALL.md`](../OyonR/INSTALL.md)
- **Adding tests?** → CLAUDE.md (project-level testing pyramid policy)
