# `deploy/` — canonical deploy artifacts for rohy

Everything you need to bring rohy up on a fresh server, verify a deploy is
healthy, and roll back when it isn't. **Self-contained — no assumptions
about the operator's personal tooling, no hardcoded URLs, no secrets.**

If you've never deployed rohy before, the path is:

```bash
# On a fresh Ubuntu/Debian server, as a non-root user with sudo:
git clone https://github.com/mohsaqr/rohySimulator.git /opt/repos/rohy
git clone https://github.com/mohsaqr/dynajs.git        /opt/repos/dynajs   # rohy bundles dynajs
cd /opt/repos/dynajs && npm install --prefer-offline                     # build dynajs first
cd /opt/repos/rohy   && sudo deploy/bootstrap.sh                          # everything else
# edit /etc/rohy/env to set FRONTEND_URL, then:
sudo systemctl start rohy
deploy/preflight.sh   && scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

That's it. Read the rest of this file once, then refer back as needed.

## What's in here

| File | Purpose |
|---|---|
| [`env.example`](env.example) | Annotated template for `/etc/rohy/env`. Every var documented inline with what happens if it's missing. Copy, fill, `chmod 600`. |
| [`systemd/rohy.service.example`](systemd/rohy.service.example) | Canonical `rohy.service` unit. Type=simple, EnvironmentFile, TRANSFORMERS_CACHE pre-set, sane hardening defaults. |
| [`nginx/rohy.conf.example`](nginx/rohy.conf.example) | Canonical nginx vhost. Includes the streaming directives needed for `/api/tts?stream=1`. |
| [`bootstrap.sh`](bootstrap.sh) | One-shot fresh-server installer. Idempotent. Generates the env file with a fresh `JWT_SECRET`, installs the unit + nginx vhost. |
| [`preflight.sh`](preflight.sh) | Pre-deploy verifier. Runs locally on the server, checks env file, paths, ports, dynajs sibling, disk space. Exit 0 = safe to restart. |
| [`rollback.sh`](rollback.sh) | Stop rohy, check out a previous commit (and optionally restore a DB snapshot), rebuild, restart, smoke. Refuses DB rollback without explicit `--i-am-sure-this-loses-data`. |
| [`../scripts/smoke.sh`](../scripts/smoke.sh) | Post-deploy smoke probe. Three-probe verification of `/api/health`, `/api/ready`, `/`. |

## Required env (cheat-sheet)

These are the bare minimum for a production boot. The full annotated list
is in [`env.example`](env.example); `server/config/validateEnv.js` enforces
them at startup.

```
JWT_SECRET=<32+ random bytes; node -e "..." snippet in env.example>
NODE_ENV=production
FRONTEND_URL=https://your-deploy/rohy
ROHY_DB=/opt/data/rohy/database.sqlite          # absolute, OUTSIDE the repo
TRANSFORMERS_CACHE=/var/cache/rohy-hf           # OUTSIDE node_modules
```

If any of these are missing in production, the boot logs will tell you
what to fix and the validator will warn (or refuse to start, in the case
of `JWT_SECRET`). Look for `[env]` lines in `journalctl -u rohy`.

## Two deploy flows

### A. Server-pull cron (recommended for "just keep prod current")

A cron job on the server pulls the repo every N minutes and restarts rohy
if HEAD changed. No operator action between `git push` and prod being
current.

Pseudocode for the cron's update step (you write your own — this isn't
in the rohy repo, since deploy automation is operator-specific):

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

### B. Operator-push rsync (for "I have a hotfix and won't wait")

You run a deploy from your laptop that rsyncs `dist/` + `server/` to the
server, runs `npm ci`, and restarts rohy. The runbook lives in
[`docs/DEPLOY_CHECKLIST.md`](../docs/DEPLOY_CHECKLIST.md).

## When something breaks

In rough order of "what to check first":

1. **`scripts/smoke.sh` failed.** The output names which probe failed
   (liveness, readiness, frontend) — start there. `journalctl -u rohy -n 100`.
2. **502 from nginx, no rohy log line.** rohy isn't listening. Check
   `systemctl status rohy`, look for `EADDRINUSE`, `JWT_SECRET not set`,
   `ECONNREFUSED` to the DB.
3. **502 with rohy logs but a stack trace.** Code-side bug. Roll the code
   back: `sudo deploy/rollback.sh --code <previous-good-sha>`.
4. **CORS error in browser console.** `FRONTEND_URL` doesn't match the
   browser's origin. Edit `/etc/rohy/env`, restart.
5. **Mic doesn't work.** Origin isn't HTTPS. Either let nginx terminate
   TLS, or set `TLS_CERT_PATH`/`TLS_KEY_PATH` for rohy itself.
6. **Kokoro crash loop.** `TRANSFORMERS_CACHE` lives in `node_modules` and
   got wiped. Set `TRANSFORMERS_CACHE` outside `node_modules` (the
   bootstrap script does this for you).

For symptom-organized triage, see
[`docs/DEPLOY_TROUBLESHOOTING.md`](../docs/DEPLOY_TROUBLESHOOTING.md).
For the lessons learned during the 2026-05-07 LAN deploy, see
[`AGENT-NOTE-DEPLOY-2026-05-07.md`](../AGENT-NOTE-DEPLOY-2026-05-07.md).

## Things this `deploy/` directory deliberately does NOT do

- **Doesn't write secrets to git.** All templates use `REPLACE_ME_…`
  placeholders. The bootstrap script generates `JWT_SECRET` at install
  time, never commits it.
- **Doesn't bake URLs/IPs/hostnames into repo files.** Everything is
  `$ROHY_DEPLOY_URL`-driven or `# CHANGE — …`-marked.
- **Doesn't auto-run migrations destructively.** `server/db.js` snapshots
  the DB before applying any pending migration; rollback can restore one.
- **Doesn't auto-substitute providers.** If Kokoro crashes, the runtime
  returns 503 `KOKORO_DISABLED` — admin switches `tts_provider` in
  settings. No silent fallback to Piper because different deployments
  use different providers (Google, OpenAI, Piper, Kokoro).
- **Doesn't push code to GitHub.** That's a separate `git push` decision
  made by the human running the deploy.
