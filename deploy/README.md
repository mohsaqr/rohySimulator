# `deploy/` — canonical deploy artifacts for rohy

Four deploy paths, pick the one that fits your situation. **Self-contained,
no assumptions about the operator's personal tooling, no hardcoded URLs,
no secrets in repo.**

> **Not sure which path?** See [`PORTABILITY.md`](PORTABILITY.md) — decision
> tree + per-environment recipes.

## The four paths

| Path | When to use | Time | Sudo | TLS |
|---|---|---|---|---|
| **[`docker/`](docker/README.md)** ← recommended | Most cases — Linux, macOS, Windows | ~3 min | only Docker daemon | Caddy auto-TLS |
| [`bootstrap.sh`](bootstrap.sh) | Bare-metal Linux production with native systemd | ~10 min | yes | nginx + Let's Encrypt |
| [`local-install.sh`](local-install.sh) | Personal devbox, classroom lab, demo | ~5 min | no | optional self-signed |
| Manual `npm run production` | You read every config and want full control | varies | varies | DIY |

## Quickstart by path

### Path A — Docker (recommended)

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
cp deploy/docker/.env.example deploy/docker/.env
# edit .env: set ROHY_HOSTNAME and ROHY_TLS_MODE
docker compose -f deploy/docker/compose.yml up -d --build
```

Open `https://<your-hostname>/rohy/`. Done. See
[`docker/README.md`](docker/README.md) for the full guide.

### Path B — Native systemd (Linux)

The bootstrap script can now do the whole flow in one shot — clone dynajs,
npm install + build, write the env file, install systemd + nginx/Caddy,
optionally pre-warm Kokoro:

```bash
# On the server (Ubuntu/Debian/Fedora/RHEL):
git clone https://github.com/mohsaqr/rohySimulator.git /opt/repos/rohy
cd /opt/repos/rohy
sudo deploy/bootstrap.sh \
    --frontend-url https://your-host/rohy \
    --with-dynajs \
    --admin-bootstrap \
    --prewarm-kokoro
```

That single command:
- detects `apt` / `dnf` / `brew` and installs prereqs
- clones dynajs from GitHub (no manual sibling-clone step)
- runs `npm install + npm run build` for rohy
- installs Piper TTS (skip with `--no-piper` if you only use Kokoro/Google)
- pre-warms the Kokoro model so the first TTS request isn't a slow download
- generates `/etc/rohy/env` with a fresh `JWT_SECRET` and your `FRONTEND_URL`
- installs the systemd unit + nginx vhost (use `--reverse-proxy=caddy` for Caddy, `--reverse-proxy=none` for BYO)
- enables `rohy.service` and starts it

After it finishes:

1. Open the deploy URL, log in as `admin/admin123`, change the password
2. **Remove** `ALLOW_DEFAULT_USERS=1` from `/etc/rohy/env`
3. `sudo systemctl restart rohy`
4. `deploy/preflight.sh && scripts/smoke.sh "$ROHY_DEPLOY_URL"`

### Path C — Local install (no systemd, no sudo)

For a devbox, demo box, classroom machine, or evaluation install:

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
bash deploy/local-install.sh --port 4000 --allow-defaults --prewarm-kokoro
npm run production
# Browser → http://localhost:4000/rohy
```

See [`local-install.sh`](local-install.sh) `--help` for all flags. No
systemd unit, no nginx, no `/etc/rohy/env` — everything stays inside the
repo's `data/` and `.env`.

## What's in here

| File | Purpose |
|---|---|
| [`PORTABILITY.md`](PORTABILITY.md) | Decision tree: your environment → the path that fits. Read first if you're not sure. |
| [`docker/`](docker/README.md) | Docker Compose path. Dockerfile + Caddyfile + entrypoint + `.env.example`. |
| [`local-install.sh`](local-install.sh) | Non-systemd installer: clone dynajs, npm install + build, generate `.env`, optionally pre-warm Kokoro. |
| [`bootstrap.sh`](bootstrap.sh) | Linux + systemd installer. Distro-aware (apt / dnf / brew). One-shot with `--frontend-url + --with-dynajs + --admin-bootstrap`. |
| [`preflight.sh`](preflight.sh) | Pre-deploy verifier (works regardless of path). Checks env file, paths, ports, dynajs sibling, disk space. Exit 0 = safe to deploy. |
| [`rollback.sh`](rollback.sh) | Code + DB rollback for systemd installs. `--code <sha>`, `--db <bak>`, `--i-am-sure-this-loses-data`. |
| [`env.example`](env.example) | Annotated template for `/etc/rohy/env`. Every var documented inline; severity tags match `validateEnv.js`. |
| [`systemd/rohy.service.example`](systemd/rohy.service.example) | Canonical systemd unit. `TRANSFORMERS_CACHE` outside `node_modules`, hardened defaults. |
| [`nginx/rohy.conf.example`](nginx/rohy.conf.example) | Canonical nginx vhost — includes streaming TTS knobs you can't remove. |
| [`../scripts/smoke.sh`](../scripts/smoke.sh) | Post-deploy smoke probe. Three probes: `/api/health`, `/api/ready`, `/`. |

## Required env (cheat-sheet)

These are the bare minimum. The full annotated list is in
[`env.example`](env.example); `server/config/validateEnv.js` enforces them
at startup.

```
JWT_SECRET=<32+ random bytes; node -e "..." snippet in env.example>
NODE_ENV=production
FRONTEND_URL=https://your-deploy/rohy
ROHY_DB=/opt/data/rohy/database.sqlite          # absolute, OUTSIDE the repo
TRANSFORMERS_CACHE=/var/cache/rohy-hf           # OUTSIDE node_modules
```

In the Docker path, the entrypoint auto-generates `JWT_SECRET` and persists
it; you only need `FRONTEND_URL` (auto-derived from `ROHY_HOSTNAME` in the
compose file). In the bootstrap-systemd path, `--frontend-url=...` writes
`FRONTEND_URL` for you. In the local-install path, `local-install.sh`
generates `.env` complete.

If any required var is missing, boot logs say what to fix. Look for
`[env]` lines in `journalctl -u rohy` or `docker compose logs rohy`.

## Two ongoing-deploy flows (after initial bootstrap)

### A. Server-pull cron (recommended for "just keep prod current")

Cron pulls the repo every N minutes and restarts rohy if HEAD changed. No
operator action between `git push` and prod being current. The pseudocode
for the cron's update step (you write this — it isn't in the repo, since
deploy automation is operator-specific):

```bash
cd /opt/repos/rohy
LOCAL_BEFORE=$(git rev-parse HEAD)
git pull --ff-only origin main
LOCAL_AFTER=$(git rev-parse HEAD)
[[ "$LOCAL_BEFORE" == "$LOCAL_AFTER" ]] && exit 0
cd /opt/repos/dynajs && npm install --prefer-offline --silent  # if siblings
cd /opt/repos/rohy
npm ci --prefer-offline --silent
npm run build
deploy/preflight.sh || exit 1                                  # gate
systemctl restart rohy
sleep 3
ROHY_DEPLOY_URL="$YOUR_URL" scripts/smoke.sh                   # gate
```

Docker path equivalent: a cron that runs
`git pull && docker compose up -d --build` every N min.

### B. Operator-push (rsync / docker push)

Runbook lives in [`../docs/DEPLOY_CHECKLIST.md`](../docs/DEPLOY_CHECKLIST.md).
Same shape regardless of path — the difference is what you push.

## When something breaks

In rough order of "what to check first":

1. **`scripts/smoke.sh` failed.** The output names which probe failed
   (liveness, readiness, frontend) — start there. `journalctl -u rohy -n 100`
   (systemd) or `docker compose logs --tail=100 rohy`.
2. **502 from the proxy, no rohy log line.** rohy isn't listening. Check
   `systemctl status rohy` / `docker compose ps`. Look for `EADDRINUSE`,
   `JWT_SECRET not set`, `ECONNREFUSED` to the DB.
3. **502 with rohy logs but a stack trace.** Code-side bug. Roll back:
   `sudo deploy/rollback.sh --code <previous-good-sha>` (systemd) or
   `git checkout <sha> && docker compose up -d --build` (docker).
4. **CORS error in browser console.** `FRONTEND_URL` doesn't match the
   browser's origin. Edit env, restart.
5. **Mic doesn't work.** Origin isn't HTTPS. Use `auto`/`internal` TLS in
   Docker, or generate a self-signed cert with
   [`scripts/gen-self-signed-tls.sh`](../scripts/gen-self-signed-tls.sh).
6. **Kokoro crash loop.** `TRANSFORMERS_CACHE` is inside `node_modules` and
   got wiped. Move it outside (`bootstrap.sh` and Docker do this for you).

For symptom-organized triage, see
[`../docs/DEPLOY_TROUBLESHOOTING.md`](../docs/DEPLOY_TROUBLESHOOTING.md).
For the lessons learned during the 2026-05-07 LAN deploy, see
[`../AGENT-NOTE-DEPLOY-2026-05-07.md`](../AGENT-NOTE-DEPLOY-2026-05-07.md).

## Things this `deploy/` directory deliberately does NOT do

- **Doesn't write secrets to git.** All templates use `REPLACE_ME_…`
  placeholders. The bootstrap script and Docker entrypoint generate
  `JWT_SECRET` at install time and never commit it.
- **Doesn't bake URLs/IPs/hostnames into repo files.** Everything is
  `$ROHY_DEPLOY_URL`-driven, `# CHANGE — …`-marked, or operator-supplied
  via flags / env vars.
- **Doesn't auto-run migrations destructively.** `server/db.js` snapshots
  the DB before applying any pending migration; rollback can restore one.
- **Doesn't auto-substitute providers.** If Kokoro crashes, the runtime
  returns 503 `KOKORO_DISABLED` — admin switches `tts_provider` in
  Settings. No silent fallback to Piper because different deployments
  use different providers (Google, OpenAI, Piper, Kokoro).
- **Doesn't push code to GitHub.** That's a separate `git push` decision
  made by the human running the deploy.
