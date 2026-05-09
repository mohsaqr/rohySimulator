# Rohy Deployment Fix Plan

This document captures the deployment issues identified in the recent review and proposes a minimal, prioritized fix plan.

## Scope

- Systemd bootstrap path: `deploy/bootstrap.sh`, `deploy/nginx/rohy.conf.example`, `deploy/systemd/rohy.service.example`, `deploy/env.example`
- Docker deploy path: `deploy/docker/compose.yml`, `deploy/docker/Caddyfile`, `deploy/docker/entrypoint.sh`
- Rollout safety scripts: `deploy/preflight.sh`, `deploy/rollback.sh`, `scripts/smoke.sh`
- Legacy path: `production/deploy.sh`

## Priority 1 (High): parity for Oyon routes in nginx template

### Problem
The nginx example currently proxies only `/rohy/*` to the backend, but runtime Oyon features also depend on root-absolute paths such as:
- `/oyon/...`
- `/standalone/...`
- `/api/addons/oyon...`

Without explicit location handling, Oyon/standalone flows can fail on nginx-based installs even when health checks pass.

### Fix
Update `deploy/nginx/rohy.conf.example` to add proxy blocks for:
- `location /oyon/ { ... proxy_pass http://127.0.0.1:4000/oyon/; ... }`
- `location /standalone/ { ... proxy_pass http://127.0.0.1:4000/standalone/; ... }`
- `location /api/addons/oyon { ... proxy_pass http://127.0.0.1:4000/api/addons/oyon; ... }`

Keep streaming and timeout settings from the `/rohy/` location (or clone the important knobs from the TTS settings) so large Oyon payloads behave consistently.

### Acceptance criteria
- Oyon launcher, standalone page, and addon endpoints load end-to-end through nginx.
- `scripts/smoke.sh <https://host/rohy>` succeeds and frontend asset probes pass.

---

## Priority 2 (Medium): align Docker TLS mode documentation with runtime behavior

### Problem
`deploy/docker/.env.example` advertises `ROHY_TLS_MODE` values that are not consumed by the shipped `deploy/docker/Caddyfile` in this revision, which causes operator confusion and inconsistent behavior.

### Fix options (pick one)
1. Remove `ROHY_TLS_MODE` from `.env.example` and docs, and make docs explicit that TLS mode is edited in `Caddyfile` manually.
2. Implement env-driven template substitution in compose/entrypoint to generate `Caddyfile` from a template, honoring `auto|internal|off`.

### Recommendation
For lowest risk and minimal blast radius, implement option 1 now and add explicit warnings near `caddy` service startup steps.

### Acceptance criteria
- No contradictory config references remain.
- Operators can configure TLS mode without guessing.

---

## Priority 3 (Medium): reduce accidental use of legacy `production/deploy.sh`

### Problem
`production/deploy.sh` is outdated relative to bootstrap/preflight/rollback/smoke flow and is not part of the documented primary paths in `README`.

### Fix
- Add a hard guard comment at top: “legacy path; not production-safe by default”
- Print explicit warning and exit non-zero unless `PRODUCTION_DEPLOY_FORCE=1`.
- Recommend the supported path in message output:
  - Docker path: `docker compose -f deploy/docker/compose.yml up -d --build`
  - Linux/systemd path: `deploy/bootstrap.sh ...`

### Acceptance criteria
- Operators get a visible warning before they run legacy flow.
- New accidental deployments from this script are reduced.

---

## Priority 4 (Low): validate writable dirs as service user in preflight

### Problem
`deploy/preflight.sh` checks writability using the invoking user context, which can mask permission issues for the runtime account used by systemd.

### Fix
- Add checks that also validate parent dirs are writable by target service user/group (from env-driven context or from `systemd` unit if available).
- Re-run checks with the same failure/warning semantics used today.

### Acceptance criteria
- Preflight fails (or warns) when service account cannot write `ROHY_DB` parent or `TRANSFORMERS_CACHE` parent.

---

## Priority 5 (Low): dynajs pin drift during bootstrap upgrades

### Problem
When `--with-dynajs` is used, existing sibling clone/checkout is currently accepted as-is.

### Fix
- If `DYNAJS_GIT_REF` is set and clone exists, fetch and checkout/verify target commit (or at least emit deterministic mismatch warning).

### Acceptance criteria
- Bootstrap + with-dynajs path does not retain a stale dynajs checkout after ref changes.

---

## Implementation order
1. Nginx Oyon path parity (highest user impact)
2. TLS-mode documentation consistency
3. Legacy production script guard
4. Preflight ownership-aware validation
5. dynajs bootstrap pin behavior

## Suggested verification
- Run smoke for each path after changes:
  - `scripts/smoke.sh https://host/rohy`
  - `scripts/smoke.sh http://host:3000` (local/dev)
- Run a quick Oyon smoke check through each ingress type:
  - `GET /oyon/standalone/`
  - `GET /api/addons/oyon/config`

## Notes
- This plan is derived from a code review only and should be treated as a deployment hardening backlog.
