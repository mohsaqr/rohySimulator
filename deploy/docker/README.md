# Docker / Compose deploy — `deploy/docker/`

Single-command rohy deploy. Use this if you want **the easy path**:

- No apt-get, no systemd, no nginx setup
- No Node version juggling
- No Python venv for Piper unless you opt in
- No "edit /etc/rohy/env then re-run" loop
- Works the same on Linux, macOS, and Windows (with Docker Desktop)

If you need bare-metal systemd + nginx (audit constraints, immutable infra,
etc.), see [`../README.md`](../README.md) instead.

## Quickstart (60 seconds)

From a fresh clone of rohy on any machine with Docker installed:

```bash
cd rohySimulator
cp deploy/docker/.env.example deploy/docker/.env
# Edit deploy/docker/.env: set ROHY_HOSTNAME=<your-hostname-or-IP>
docker compose -f deploy/docker/compose.yml up -d --build
```

That's it. Open `https://<your-hostname>/rohy/` in a browser.

First-time setup creates an admin login — set `ALLOW_DEFAULT_USERS=1` in
`.env` for the first start, log in as `admin`/`admin123`, change the
password, then **remove the line** and `docker compose up -d` again.

### Verify it's healthy

```bash
docker compose -f deploy/docker/compose.yml ps
# Both services should show "healthy" within ~30 seconds.

# Probe directly (skip-cert because of internal CA):
curl -ksS https://<your-hostname>/rohy/api/health | jq
# {"status":"ok",...}

# Or use the bundled smoke script (works against the container too):
ROHY_SMOKE_INSECURE=1 scripts/smoke.sh "https://<your-hostname>/rohy"
```

## What gets built

`docker compose up --build` triggers a multi-stage build (see the comments
in [`Dockerfile`](Dockerfile) for the full reasoning):

1. **builder** — clones `dynajs` from GitHub (because it's a `file:../dynajs`
   sibling in `package.json`), runs `npm install`, runs `vite build`,
   prunes dev deps.
2. **piper-builder** — only runs if `INCLUDE_PIPER=1`. Builds the Piper
   Python venv with espeak-ng baked in. Skipped by default.
3. **runtime** — `node:22-bookworm-slim` + the pruned `node_modules` +
   built frontend + `tini` for proper signal handling. Runs as the
   built-in `node` user, never root.

Image is ~400 MB without Piper, ~550 MB with.

## Three TLS modes

Set `ROHY_TLS_MODE` in `.env`:

| Mode | When to use | What you get |
|---|---|---|
| `auto` | Public deploy with a real DNS hostname | Let's Encrypt cert auto-provisioned + renewed by Caddy. Needs ports 80+443 reachable from the public internet. |
| `internal` (default) | LAN / classroom / on-prem | Caddy's internal CA issues a self-signed cert. Browsers warn until you trust the CA root once. |
| `off` | Localhost dev only | Plain HTTP. **Mic won't work** because `getUserMedia` requires HTTPS on non-localhost origins. |

To trust the internal CA on a client (one-time):

```bash
docker exec rohy-caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
# macOS:
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain caddy-root.crt
# Linux (Debian/Ubuntu):
sudo cp caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt && sudo update-ca-certificates
```

## What persists across `docker compose down`

| Volume | Holds | Loss impact |
|---|---|---|
| `rohy-db` | SQLite DB + auto-generated JWT secret | Total: every user, session, scenario, audit row, the JWT secret. **BACK THIS UP.** |
| `rohy-hf-cache` | Kokoro model + HF transformers cache (~330 MB) | Re-downloads on next TTS call. Slow but not destructive. |
| `caddy-data` | TLS certs from Let's Encrypt | Loss → fresh ACME challenge → Let's Encrypt rate limit pain. Back up if using `auto` mode. |
| `caddy-config` | Caddy state snapshots | Safe to wipe. |

To back up the DB:

```bash
docker exec rohy sqlite3 /var/lib/rohy/database.sqlite ".backup /var/lib/rohy/backup.sqlite"
docker cp rohy:/var/lib/rohy/backup.sqlite ./rohy-backup-$(date +%F).sqlite
```

## Common operations

### Logs

```bash
docker compose -f deploy/docker/compose.yml logs -f rohy        # live tail
docker compose -f deploy/docker/compose.yml logs --since=10m    # last 10min
```

### Restart after config change

```bash
$EDITOR deploy/docker/.env
docker compose -f deploy/docker/compose.yml up -d
```

### Upgrade to a newer rohy

```bash
git pull origin main
docker compose -f deploy/docker/compose.yml up -d --build
# Built artifacts replace the old container; volumes (DB, HF cache) persist.
```

### Reset to a clean state (KEEP your DB)

```bash
docker compose -f deploy/docker/compose.yml down
docker compose -f deploy/docker/compose.yml up -d --build
```

### NUKE everything (lose the DB)

```bash
docker compose -f deploy/docker/compose.yml down -v   # the -v wipes volumes
```

### Run rohy without Caddy (bring your own ingress)

```yaml
# In compose.yml, drop the `caddy` service and add port-publishing to rohy:
services:
  rohy:
    ports:
      - "4000:4000"
```

Then point your existing nginx/Traefik/HAProxy at `localhost:4000`. The
streaming-TTS knobs from [`../nginx/rohy.conf.example`](../nginx/rohy.conf.example)
(or the equivalent for your proxy) still apply.

## Customizing

### Different port

```env
# .env
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
```

### Different subpath (or root path)

The `vite build` step bakes `/rohy/` into the SPA. To serve at the root,
rebuild with a different base. The simplest path: keep `/rohy/` in the
URL — it costs nothing and matches the upstream build.

### Bring your own JWT secret

```env
# .env
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
```

If you set this explicitly, the entrypoint won't auto-generate one and
won't write to `/var/lib/rohy/.secrets/jwt_secret`. Useful for matching
secrets across multiple deployments.

### Pin the dynajs commit (recommended for production)

```env
# .env
DYNAJS_GIT_REF=v0.1.0   # tag or full SHA
```

## Troubleshooting

### `docker compose up --build` fails on the dynajs clone step

```
fatal: could not read Username for 'https://github.com'
```

`dynajs` is currently a public repo, so this shouldn't happen — but if
you've replaced it with a private fork, mount your SSH agent or use a
`DYNAJS_GIT_URL=git@...` SSH URL with a build secret.

### Browser shows "Not secure" / cert warning in `internal` mode

Expected. Either trust the Caddy root CA (one-time, instructions above)
or accept the warning during dev. Switching to `auto` mode requires a
real public hostname.

### `/api/tts` returns 502 in the browser, but works via curl

This was the symptom of the 2026-05-08 dbAdapter bug — fixed in commit
`fb66995`. Make sure your image was built from a commit at or after
that one (`git log --grep="TTS-502"`). Rebuild with `--build` to be sure.

### Container logs show `[entrypoint] FATAL: FRONTEND_URL is not set`

You're in `NODE_ENV=production` (the default) but `FRONTEND_URL` didn't
make it into the container. Check `deploy/docker/.env` exists and has
`ROHY_HOSTNAME=` set. The compose file derives `FRONTEND_URL` from it.

### Want to inspect inside the container

```bash
docker exec -it rohy sh
# Then:
ls /var/lib/rohy/                     # DB + secrets
ls /var/cache/rohy-hf/                # Kokoro model cache
sqlite3 /var/lib/rohy/database.sqlite '.tables'
node -e "console.log(process.env.FRONTEND_URL)"
```

## What this DOESN'T do

By design, intentionally:

- **Doesn't push anything anywhere.** No registry uploads, no auto-deploy
  to remote hosts. `docker compose up` is local only; if you want to
  publish the image, `docker tag rohy:latest <registry>/rohy:tag &&
  docker push`.
- **Doesn't manage your DNS.** `ROHY_HOSTNAME` has to resolve to this
  host before `auto` TLS can issue a cert.
- **Doesn't auto-update.** Run `docker compose up -d --build` yourself,
  or set up a watchtower/diun if you want auto-pull.
- **Doesn't bake secrets into the image.** All env vars come from `.env`
  at runtime; the image is the same regardless of operator.
