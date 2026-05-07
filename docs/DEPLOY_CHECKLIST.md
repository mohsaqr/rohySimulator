# Deploy Checklist — rohy

One-page runbook for deploying rohy to production. Read this before every
non-trivial deploy. Hotfix path is at the bottom; troubleshooting lives in
[`docs/DEPLOY_TROUBLESHOOTING.md`](DEPLOY_TROUBLESHOOTING.md).

> **Per-deployment context.** This doc is repo-shipped and intentionally
> URL-agnostic. Every deploy specific (URL, host, ssh target) belongs in
> your shell, not in this file:
>
> ```bash
> export ROHY_DEPLOY_URL=https://your-deploy/rohy   # public URL of YOUR deploy
> export ROHY_SSH=user@your-host                    # ssh target for journalctl/restart
> ```

If this is a **fresh server**, jump to [`deploy/README.md`](../deploy/README.md)
for the bootstrap path. This checklist covers ongoing deploys to an
already-bootstrapped server.

---

## TL;DR — by deploy mode

There are two shipped flows. Pick the one that matches how your server
gets new code.

### Mode A: Server-pull cron (the boring, safe flow)

A cron job on the server pulls + rebuilds + restarts whenever HEAD
changes. **You only push to GitHub.** Latency is the cron interval.

```bash
# from ~/Documents/Github/rohySimulator
npm test                          # gate
git push origin main              # publish
# cron picks it up within N min, runs:
#   git pull && npm ci && npm run build && deploy/preflight.sh && systemctl restart rohy
# verify:
scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

### Mode B: Operator-push rsync (immediate)

You run a deploy from your laptop that rsyncs to the server, restarts,
smokes. The deploy script lives in your own tooling (e.g.
`~/Documents/Github/JStats/website/deploy.sh` for the maintainer's setup
— see "Maintainer-specific paths" below).

```bash
# from ~/Documents/Github/rohySimulator
npm test                          # gate
npm run build                     # surface build errors locally, not on the box

# from wherever your push tool lives
./deploy.sh rohy                  # rsync + ssh restart (your own script)

# verify (from anywhere)
scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

If `npm test` is red OR `scripts/smoke.sh` exits non-zero, **do not
declare the deploy successful** — see [Rollback](#rollback).

---

## Normal deploy (5 minutes)

### 1. Pre-flight

On your laptop:

```bash
cd ~/Documents/Github/rohySimulator
git status                        # working tree clean (or only files you mean to ship)
git pull --ff-only origin main    # don't deploy a branch that's behind
npm test                          # full suite — gate. Should be green.
npm run build                     # build locally to surface errors before the box does
```

If you touched the dynajs sibling (rohy bundles dynajs at
`file:../dynajs`), build it FIRST so rohy's build picks up the fresh
`dist/`:

```bash
cd ~/Documents/Github/dynajs
npm install --prefer-offline      # NOT npm ci — npm ci skips the prepare script
```

On the server, before restarting (or as the first step of your
deploy script):

```bash
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && deploy/preflight.sh'
# Exits 0 → safe to restart. Exits 1 → fix what it reports first.
```

### 2. Push the code

Mode A:

```bash
git push origin main              # cron handles the rest
```

Mode B:

```bash
./your-deploy-tool.sh rohy        # rsync + restart
```

### 3. Verify (smoke check)

```bash
scripts/smoke.sh "$ROHY_DEPLOY_URL"
# → probes /api/health, /api/ready, / on the URL
# → exits 0 if all green, 1 if any probe failed after retries
```

For a freshly-restarted node, give it a few extra retries:

```bash
ROHY_SMOKE_RETRIES=12 scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

For LAN deploys with self-signed certs:

```bash
ROHY_SMOKE_INSECURE=1 scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

### 4. Watch the first minute of logs

```bash
ssh "$ROHY_SSH" 'sudo journalctl -u rohy.service -f' | head -100
# look for: "http server listening", "database schema is current"
# do NOT see: stack traces, "uncaught exception", "unhandled rejection"
# do NOT see: "[env]" warnings you didn't intend (validateEnv complains here)
```

If logs show errors but smoke passed, click around the production app
yourself and reproduce a real-user flow before walking away.

---

## Hotfix deploy

A hotfix is "I have a one-line fix for a production crash; tests can wait."
The compromise: test gate is bypassed, smoke check is **not** optional.

```bash
cd ~/Documents/Github/rohySimulator
git diff                          # confirm the diff is what you think
npm run build                     # still build — catches syntax errors

# then your push step (Mode A or Mode B)

scripts/smoke.sh "$ROHY_DEPLOY_URL"   # ALWAYS run — non-negotiable
```

After the hotfix lands and you can breathe, **come back and write the
test** that would have caught the bug, then deploy normally.

---

## Rollback

If smoke fails or you observe production breakage. The rollback script
under [`deploy/rollback.sh`](../deploy/rollback.sh) handles every case
below. Run it on the server.

### A. Code rollback (most common)

```bash
ssh "$ROHY_SSH"
sudo deploy/rollback.sh --list                       # show recent commits + DB snapshots
sudo deploy/rollback.sh --code <previous-good-sha>   # check out, rebuild, restart, smoke
```

### B. Database rollback (rare — only if a migration corrupted data)

`server/db.js` snapshots the DB BEFORE applying any pending migration.
Snapshots live next to the DB at
`/opt/data/rohy/database.sqlite.bak.<timestamp>.<targetVersion>`.

```bash
ssh "$ROHY_SSH"
sudo deploy/rollback.sh --list                                      # find a snapshot
sudo deploy/rollback.sh \
    --code <previous-good-sha> \
    --db /opt/data/rohy/database.sqlite.bak.<TS>.<VERSION> \
    --i-am-sure-this-loses-data
```

**Important**: schema rollback ≠ data rollback. Restoring a snapshot
loses every write that landed between the snapshot and the failed
migration. Tell affected users.

### C. Just-restart (something transient)

```bash
ssh "$ROHY_SSH" 'sudo systemctl restart rohy'
scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

---

## Where the moving parts live

| Concern | Path |
|---|---|
| Smoke check | `scripts/smoke.sh` |
| Pre-deploy verifier | `deploy/preflight.sh` |
| Rollback script | `deploy/rollback.sh` |
| Fresh-server bootstrap | `deploy/bootstrap.sh` |
| Env file template | `deploy/env.example` (canonical doc of every env var) |
| Systemd unit template | `deploy/systemd/rohy.service.example` |
| Nginx vhost template | `deploy/nginx/rohy.conf.example` |
| Server systemd unit | `$ROHY_SSH:/etc/systemd/system/rohy.service` |
| Server env file | `$ROHY_SSH:/etc/rohy/env` |
| Server logs | `ssh "$ROHY_SSH" sudo journalctl -u rohy.service` |
| Server repo | `$ROHY_SSH:/opt/repos/rohy` |
| Server DB | `$ROHY_SSH:/opt/data/rohy/database.sqlite` (kept out of repo via `ROHY_DB` env) |
| Server HF cache | `$ROHY_SSH:/var/cache/rohy-hf` (kept out of `node_modules` via `TRANSFORMERS_CACHE`) |
| nginx vhost | `$ROHY_SSH:/etc/nginx/conf.d/rohy*.conf` |
| Public URL | `$ROHY_DEPLOY_URL` |

## Maintainer-specific paths

If you are the rohy maintainer (mohsaqr) running deploys via the
multi-project shared deploy hub:

| Concern | Path |
|---|---|
| Deploy dispatcher | `~/Documents/Github/JStats/website/deploy.sh` |
| Service config | `~/Documents/Github/JStats/website/sites.conf` (`MODE_rohy=both`, etc.) |
| dynajs sibling repo | `~/Documents/Github/dynajs` (built before rohy in the deploy order) |

Anyone else: ignore that section. Use the generic flows above.

## Things to never do

- **Never bypass the smoke check.** Hotfixes can skip the test gate; smoke is non-negotiable.
- **Never `systemctl restart rohy` on the server during high-load minutes** without graceful-shutdown verification — in-flight requests will TCP-RST during the listener-close window. (Server-side graceful shutdown is wired; this caution is belt-and-braces.)
- **Never edit files directly on the server** (`/opt/repos/rohy`). Server-pull cron will `git reset --hard` over them; rsync deploys will overwrite them. If you need to test a fix, branch in the rohy repo, deploy that branch.
- **Never delete `*.bak.*` snapshots** without ssh-checking that the deployed version no longer needs the schema they represent. They are your DB rollback safety net.
- **Never commit a filled-in `/etc/rohy/env` to git.** It contains the production `JWT_SECRET`. The repo only ships `deploy/env.example` with `REPLACE_ME` placeholders.
- **Never deploy on Friday afternoon.** Rollback is harder when nobody's around.

## When things go wrong

[`docs/DEPLOY_TROUBLESHOOTING.md`](DEPLOY_TROUBLESHOOTING.md) is organized
by symptom (502, 503, blank page, mic blocked, TTS silent, etc.) — find
the symptom that matches what you see, follow the diagnostic steps.

For deeper subsystem-level playbooks (auth, CSRF, persistence,
audit-chain, TTS, JWT, DB):
[`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md).

For the lessons learned during the 2026-05-07 LAN deploy:
[`AGENT-NOTE-DEPLOY-2026-05-07.md`](../AGENT-NOTE-DEPLOY-2026-05-07.md).
