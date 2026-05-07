# Deploy Checklist — rohy

One-page runbook for deploying rohy to production. Read this before every
non-trivial deploy. Hotfix path is at the bottom.

> **Per-deployment context.** This doc is repo-shipped and intentionally
> URL-agnostic. The actual deploy URL, server, and systemd unit are
> environment-specific — keep them in your shell, not in this file:
>
> ```bash
> export ROHY_DEPLOY_URL=https://your-deploy/rohy   # the public URL of YOUR deploy
> export ROHY_SSH=user@your-host                    # ssh target for journalctl/restart
> ```
>
> Then every command below substitutes `$ROHY_DEPLOY_URL` and `$ROHY_SSH`
> automatically. For `AGENT-NOTE-DEPLOY-2026-05-07.md` readers — that
> note documents one specific deploy (LAN-only at 192.168.50.39:4001);
> use it as a worked example, not as the canonical URL.

## TL;DR

```bash
# from ~/Documents/Github/rohySimulator (the rohy repo)
npm test                                                # gate

# from ~/Documents/Github/JStats/website (the deploy hub)
./deploy.sh rohy

# verify (from anywhere)
~/Documents/Github/rohySimulator/scripts/smoke.sh "$ROHY_DEPLOY_URL"
```

If `npm test` is red OR `smoke.sh` exits non-zero, **do not declare the
deploy successful** — see the rollback section.

---

## Normal deploy (5 minutes)

### 1. Pre-flight

```bash
cd ~/Documents/Github/rohySimulator
git status               # working tree should be clean (or only files you mean to ship)
git pull origin main     # don't deploy a branch that's behind
npm test                 # full suite — gate. Should be green.
npm run build            # the build deploy.sh will rsync; surface build errors here, not on the box
```

If you touched `dynajs` (sibling repo at `~/Documents/Github/dynajs`),
deploy it first — rohy bundles dynajs statically and won't pick up
changes until rohy is rebuilt:

```bash
cd ~/Documents/Github/JStats/website
./deploy.sh dynajs       # this also forces a rohy rebuild + restart
# ↑ skip the next step if you only needed the dynajs change
```

### 2. Push

```bash
cd ~/Documents/Github/JStats/website
./deploy.sh rohy         # mac-push: rsync dist/ + server/, restart systemd unit
```

### 3. Verify (smoke check)

```bash
~/Documents/Github/rohySimulator/scripts/smoke.sh
# → probes /api/health, /api/ready, / on $ROHY_DEPLOY_URL
# → exits 0 if all green, 1 if any probe failed after retries
```

For a freshly-restarted node, give it a few extra retries:

```bash
ROHY_SMOKE_RETRIES=12 ~/Documents/Github/rohySimulator/scripts/smoke.sh
```

### 4. Watch the first minute of logs

```bash
ssh "$ROHY_SSH" 'sudo journalctl -u rohy.service -f' | head -100
# look for: "http server listening", "database schema is current"
# do NOT see: stack traces, "uncaught exception", "unhandled rejection"
```

If logs show errors but smoke passed, click around the production app
yourself and reproduce a real-user flow before walking away.

---

## Hotfix deploy

A hotfix is "I have a one-line fix for a production crash; tests can wait."
The compromise: test gate is bypassed, smoke check is **not** optional.

```bash
cd ~/Documents/Github/rohySimulator
git diff                                # confirm the diff is what you think
npm run build                           # still build — catches syntax errors

cd ~/Documents/Github/JStats/website
./deploy.sh rohy                        # push

~/Documents/Github/rohySimulator/scripts/smoke.sh   # ALWAYS run — non-negotiable
```

After the hotfix lands and you can breathe, **come back and write the
test** that would have caught the bug, then `git commit && deploy.sh
rohy` normally.

---

## Rollback

If smoke fails or you observe production breakage:

### A. Code rollback (most common)

The deploy hub keeps the previous build under `/opt/repos/rohy.bak/` on
the server (set up by `update-sites.sh` automatically; for mac-push
deploys you may need to do this manually).

```bash
# Confirm previous-good commit on the server
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && git log --oneline -5'

# Roll back to the previous-good commit
ssh "$ROHY_SSH" 'cd /opt/repos/rohy && git checkout <previous-sha> && npm run build && sudo systemctl restart rohy'

# Re-smoke
~/Documents/Github/rohySimulator/scripts/smoke.sh
```

### B. Database rollback (rare — only if a migration corrupted data)

`server/db.js` snapshots the SQLite file BEFORE applying any new
migration. Snapshots live next to the DB:

```bash
ssh "$ROHY_SSH" 'ls -lt /opt/data/rohy/database.sqlite.bak.*'
```

To restore:

```bash
ssh "$ROHY_SSH" 'sudo systemctl stop rohy'
ssh "$ROHY_SSH" 'cp /opt/data/rohy/database.sqlite.bak.<TIMESTAMP>.<VERSION> /opt/data/rohy/database.sqlite'
# Then roll the code back to the version that matches that schema (above).
ssh "$ROHY_SSH" 'sudo systemctl start rohy'
```

**Important**: schema rollback ≠ data rollback. Restoring a snapshot
loses every write that landed between the snapshot and the failed
migration. Tell affected users.

---

## Where the moving parts live

| Concern | Path |
|---|---|
| Deploy dispatcher | `~/Documents/Github/JStats/website/deploy.sh` |
| Service config | `~/Documents/Github/JStats/website/sites.conf` (`MODE_rohy=both`, etc.) |
| Smoke check | `~/Documents/Github/rohySimulator/scripts/smoke.sh` |
| Server systemd unit | `$ROHY_SSH:/etc/systemd/system/rohy.service` |
| Server logs | `ssh "$ROHY_SSH" sudo journalctl -u rohy.service` |
| Server repo | `$ROHY_SSH:/opt/repos/rohy` |
| Server DB | `$ROHY_SSH:/opt/data/rohy/database.sqlite` (kept out of repo via `ROHY_DB` env) |
| nginx vhost | `$ROHY_SSH:/etc/nginx/conf.d/rohy*.conf` (proxies `/rohy/` → `127.0.0.1:4000/`) |
| Public URL | `$ROHY_DEPLOY_URL/` |

## Things to never do

- **Never bypass the smoke check.** Hotfixes can skip the test gate; smoke is non-negotiable.
- **Never `systemctl restart rohy` on the server during high-load minutes** without graceful-shutdown verification — in-flight requests may TCP-RST. (We have graceful shutdown wired, but stay paranoid.)
- **Never edit files directly on the server** (`/opt/repos/rohy`). The next deploy will overwrite them. If you need to test something, branch in the rohy repo and deploy that branch.
- **Never delete `*.bak.*` snapshots** without ssh-checking that the deployed version no longer needs the schema they represent.
- **Never deploy on Friday afternoon.** Rollback is harder when nobody's around.
