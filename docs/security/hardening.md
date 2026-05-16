# Hardening checklist

Production hardening **beyond** the install and deploy steps. This page is
for the security reviewer signing off a deployment; the operator-facing
deploy procedure is the canonical source for the commands themselves.

## Secrets

- [ ] **`JWT_SECRET` is strong and unique.** Generate with
  `openssl rand -hex 32`. The server **refuses to start** without it
  (`server/middleware/auth.js` logs FATAL and exits). It signs and verifies
  every auth token. See `JWT_SECRET` in the
  [config reference](/reference/config/).

::: danger
Rotating `JWT_SECRET` invalidates **every** session at once — all tokens
become unverifiable. Rotate only during a maintenance window with a server
restart. There is no automatic secret rotation.
:::

- [ ] **LLM / TTS API keys are scoped to this deployment.** The
  secret-bearing env vars — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_API_KEY`, `GOOGLE_TTS_API_KEY` (full list and source locations in
  the [config reference](/reference/config/)) — should be per-project keys,
  separate from personal keys, with provider-side quotas set. These values
  are backstopped by the [redaction](/security/redaction) secret-key
  pattern so they are never echoed in a response, but quota and scope are
  still the operator's responsibility.
- [ ] **No secrets in client-reachable config.** Confirm any new
  secret-bearing field is registered in `server/redaction.js` (see
  [Redaction &amp; PII](/security/redaction)) before it can appear in a
  response.

## Transport &amp; reverse proxy

- [ ] **TLS terminates in front of Express.** Never expose the Node port
  directly. nginx, Caddy, or a tunnel are all acceptable; Caddy and
  certbot/Let's Encrypt automate renewal.
- [ ] **`FRONTEND_URL` is set to the exact public origin** so CORS allows
  only that origin (`FRONTEND_URL` in the
  [config reference](/reference/config/); CORS rejects non-localhost
  origins when unset).
- [ ] **SPA base matches the mount path.** A bundle built with one base
  served at another 404s every asset — keep `--base` and the proxy path
  consistent.
- [ ] **Security headers present** — CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, HSTS. Verified by the deploy
  verifier below.

## Identity &amp; access

- [ ] **Default seeded users are disabled.** This is the default under
  `NODE_ENV=production`; confirm `ALLOW_DEFAULT_USERS` is **not** set.
- [ ] **First admin password rotated** if a bootstrap credential was used.
- [ ] **Role/tenant model understood** — access is rank comparison and the
  live `users` row is re-read every request, so demotion/suspension is
  immediate; logout/force-logout revokes via `active_sessions`
  immediately. See [RBAC &amp; auth model](/security/rbac).
- [ ] **MFA added at the edge if required.** Rohy does not provide MFA on
  operator accounts; add it via the reverse proxy (e.g. OIDC / Authelia).

## Data lifecycle

- [ ] **Retention sweep cron installed** and the window set deliberately
  (default 90 days). The sweep is a physical `DELETE` — see
  [Data retention](/security/retention).
- [ ] **Per-tenant Oyon retention reviewed** if Oyon is enabled
  (Settings → Oyon).
- [ ] **Off-site, ideally encrypted, backups configured** before enabling
  the retention cron, since the sweep also truncates `system_audit_log`.
- [ ] **Audit-chain verification has an owner.** Decide who runs
  `verifyAuditChain` / `bash scripts/audit-auditlog.sh` and how a
  non-`ok` result is escalated (it is a tamper indicator, not a
  data-quality bug). See [Audit chain](/security/audit-chain).

## Optional features

- [ ] **Oyon governance sign-off obtained** if `OYON_ENABLED=1`, including
  EU AI Act Art. 5 review. Disable with `OYON_ENABLED=0`
  ([config reference](/reference/config/)). See
  [Oyon &amp; EU AI Act](/security/oyon-ai-act).
- [ ] **Medical-training scope communicated** — only synthetic data, no
  real patients. See the
  [Medical-training disclaimer](/security/disclaimer).

## Deploy verifiers

Boot-an-isolated-server audit scripts assert the contracts in this guide.
Wire the relevant ones into CI / cron:

| Verifier | Asserts |
|---|---|
| `bash scripts/audit-rbac.sh` | Rank gates, protected-route refusal |
| `bash scripts/audit-auth.sh` | Token extraction, malformed-header handling |
| `bash scripts/audit-redaction.sh` | Response data-classification contract |
| `bash scripts/audit-auditlog.sh` | Audit-log surface + chain |
| `bash scripts/audit-retention.sh` | Retention window + sweep behavior |
| `bash scripts/audit-tenant.sh` | Cross-tenant access denial |
| `scripts/tech-test.sh https://your-host` | 27-check live-deploy verifier (liveness, bundle, Oyon mount, auth gating, security headers, timing); **arm the Oyon contract probe** with credentials so every deploy POSTs a malformed emotion batch and asserts a 400 — see [Oyon &amp; EU AI Act](/security/oyon-ai-act) |

::: tip
The Oyon contract probe credentials can be any real low-privilege user —
the probe only needs to pass `authenticateToken` so the request reaches the
validator; it reads no data. If the creds file is absent, the probe
silently skips and the deploy still passes the other checks.
:::

## What Rohy does not do

State these explicitly when attesting a deployment:

- **No MFA** on operator accounts (add at the edge).
- **No automatic secret rotation** (`JWT_SECRET` rotation is a manual,
  session-invalidating, maintenance-window operation).
- **No FIPS / HIPAA / medical-device certification.** The codebase is
  built to support these postures but holds no formal attestation. See the
  [Medical-training disclaimer](/security/disclaimer).
