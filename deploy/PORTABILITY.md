# Deploy portability — pick the right path for your shape

rohy ships **four** deploy paths so you don't have to bend an environment to
match a single recipe. This doc maps your situation → the artifact to use.

## Decision tree

```
Are you on Windows or macOS without systemd?
├─ yes → deploy/docker/   (Docker Compose, works identically on Win/Mac/Linux)
└─ no
   │
   Is this a multi-user / public / production deploy?
   ├─ yes → Do you want managed TLS + zero apt commands?
   │        ├─ yes → deploy/docker/        (Caddy auto-TLS, no nginx setup)
   │        └─ no  → deploy/bootstrap.sh   (apt + systemd + nginx, classic)
   │
   └─ no  → deploy/local-install.sh        (one-machine, no systemd, no sudo)
```

## The four paths at a glance

| Path | Best for | Time to running | Sudo? | Systemd? | TLS |
|---|---|---|---|---|---|
| [`deploy/docker/`](docker/README.md) | **Most cases.** Public deploys, LAN deploys, dev boxes. Linux, macOS, Windows. | ~3 min | only Docker daemon | no | Caddy auto-TLS |
| [`deploy/bootstrap.sh`](bootstrap.sh) | Bare-metal Linux production. Audit constraints requiring native systemd. | ~10 min | yes | yes | nginx + Let's Encrypt |
| [`deploy/local-install.sh`](local-install.sh) | Personal devbox, classroom lab, demo machine, evaluation install. | ~5 min | no | no | optional self-signed |
| Manual `npm run production` | You read every config file and want to compose your own setup. | varies | varies | varies | DIY |

## Picking by environment

### "I'm on a fresh Ubuntu/Debian VPS"

You have two good options:

1. **Docker (recommended unless you specifically want native systemd):**
   ```bash
   git clone https://github.com/mohsaqr/rohySimulator.git
   cd rohySimulator
   cp deploy/docker/.env.example deploy/docker/.env
   # Edit deploy/docker/.env: ROHY_HOSTNAME=your-domain.com, ROHY_TLS_MODE=auto
   docker compose -f deploy/docker/compose.yml up -d --build
   ```
   You get auto-TLS, persistent volumes, healthchecks, signal handling, all
   without an apt install of nginx + Node + Python.

2. **Native systemd:**
   ```bash
   sudo deploy/bootstrap.sh \
       --frontend-url https://your-domain.com/rohy \
       --with-dynajs --prewarm-kokoro
   ```
   Then edit `/etc/rohy/env` only to add API keys (the bootstrap fills in
   everything else). Better for: existing systemd-based monitoring stacks,
   air-gapped environments where you can't pull a Caddy image, audit
   environments that mandate native installs.

### "I'm on a fresh Fedora/RHEL/CentOS box"

`deploy/bootstrap.sh` detects `dnf` and adapts. If you hit a package name
mismatch, fall back to Docker:

```bash
sudo dnf install docker docker-compose
docker compose -f deploy/docker/compose.yml up -d --build
```

### "I'm on macOS (laptop / mac mini server)"

Use Docker Desktop or OrbStack:

```bash
brew install --cask docker          # or orbstack
docker compose -f deploy/docker/compose.yml up -d --build
```

For a non-Docker dev install:
```bash
brew install node@22
bash deploy/local-install.sh --bind localhost --port 4000
```

### "I'm on Windows"

Docker Desktop with WSL2:

```powershell
docker compose -f deploy/docker/compose.yml up -d --build
```

Native Windows deploys (without WSL/Docker) aren't supported — `bcrypt` and
`sqlite3` build cleanly via `windows-build-tools` but the Piper venv path
and the bundled deploy scripts assume a POSIX shell. Use WSL2.

### "I'm on a Raspberry Pi / ARM64"

Docker:

```bash
docker buildx build --platform linux/arm64 -f deploy/docker/Dockerfile -t rohy:arm64 .
docker compose -f deploy/docker/compose.yml up -d
```

Bare-metal: use `deploy/local-install.sh` — Node 22 has official ARM64
builds; `bcrypt` and `sqlite3` build from source.

### "I'm in a classroom / lab and want one-machine demo installs"

`deploy/local-install.sh` is for exactly this:

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
bash deploy/local-install.sh --port 4000 --allow-defaults --prewarm-kokoro
npm run production
# Browser → http://localhost:4000/rohy
# First login: admin/admin123 → change immediately
```

If you want LAN access from other classroom machines:

```bash
bash deploy/local-install.sh --bind 0.0.0.0 --port 4000 --prewarm-kokoro
# But also: generate a self-signed cert, see scripts/gen-self-signed-tls.sh
# (mic won't work on plain HTTP from non-localhost origins)
```

### "I'm running multiple rohy instances on one host"

Use Docker — each instance gets its own compose project:

```bash
COMPOSE_PROJECT_NAME=rohy-classroom-a docker compose \
    -f deploy/docker/compose.yml up -d \
    --env-file deploy/docker/.env.classroom-a
COMPOSE_PROJECT_NAME=rohy-classroom-b docker compose \
    -f deploy/docker/compose.yml up -d \
    --env-file deploy/docker/.env.classroom-b
```

Each gets isolated volumes, hostnames, and ports.

## What persists across upgrades

This is the same regardless of path you pick:

| Lives in | Path (bootstrap) | Path (Docker) | Path (local-install) |
|---|---|---|---|
| SQLite DB | `/opt/data/rohy/database.sqlite` | volume `rohy-db` | `data/database.sqlite` |
| HF / Kokoro cache | `/var/cache/rohy-hf` | volume `rohy-hf-cache` | `data/hf-cache` |
| Piper venv (if used) | `server/data/piper/venv` | inside image | `server/data/piper/venv` |
| TLS certs | `/etc/letsencrypt/...` | volume `caddy-data` | DIY (`scripts/gen-self-signed-tls.sh`) |
| Secrets (JWT) | `/etc/rohy/env` | volume `rohy-db/.secrets` | `.env` |

**Backup priority:** the SQLite DB and HF cache are the only two things
worth backing up regularly. Everything else can be regenerated from a
fresh clone + `.env` recovery.

## "It worked on my localhost but breaks on the server"

The 80/20 of cross-environment surprises:

| Surprise | Root cause | Fix |
|---|---|---|
| Mic doesn't work | `getUserMedia` requires HTTPS on non-localhost origins | Use Docker (`auto` or `internal` TLS mode), or generate a self-signed cert via `scripts/gen-self-signed-tls.sh`. |
| Blank page, all assets 500 | `FRONTEND_URL` doesn't match the browser's origin (CORS) | Set `FRONTEND_URL` exactly to what the browser shows (no trailing slash mismatch). |
| First TTS request crashes the server | Kokoro model truncated during download | Pre-warm with `--prewarm-kokoro` (`local-install.sh`) or `--prewarm-kokoro` flag added to `bootstrap.sh`. Or set `TRANSFORMERS_CACHE` outside `node_modules`. |
| Process exits, systemd loops it | dbAdapter variadic-args bug (commit `fb66995`) | Make sure your build is at or after `fb66995`. `git log --grep="TTS-502"` should find it. |
| Rate-limiter rejects all logins | `'X-Forwarded-For' header is set but Express 'trust proxy' setting is false` | `ROHY_TRUST_PROXY=loopback` (Docker default) or `'uniquelocal'` for multi-hop chains. |
| `npm ci` wiped the Kokoro model and now it's redownloading on every restart | Default cache lives in `node_modules/` | `TRANSFORMERS_CACHE=/abs/path/outside/repo`. Already set in Docker + bootstrap; check `local-install.sh` `.env`. |

For full triage trees see [`docs/DEPLOY_TROUBLESHOOTING.md`](../docs/DEPLOY_TROUBLESHOOTING.md).

## Cross-cutting environment knobs

These work the same regardless of deploy path. Set in `.env` (local /
docker), `/etc/rohy/env` (bootstrap), or shell env:

| Var | Default | What it controls |
|---|---|---|
| `NODE_ENV` | (none — server defaults to dev seeders) | `production` disables seeders + dev helpers |
| `PORT` | 3000 | HTTP listener port |
| `JWT_SECRET` | (none — fatal if unset in prod) | Signs auth tokens |
| `FRONTEND_URL` | (none — fatal in prod) | CORS allowlist origin |
| `ROHY_DB` | relative to `__dirname` | Absolute path to SQLite DB |
| `TRANSFORMERS_CACHE` | inside `node_modules` (BAD) | HF / Kokoro cache directory |
| `ROHY_TRUST_PROXY` | `loopback` | Express trust-proxy setting |
| `ROHY_ROUTE_TIMEOUT_MS` | 30000 | 504 timeout (excludes /tts + /proxy/llm) |
| `ROHY_SHUTDOWN_GRACE_MS` | 15000 | Drain time on SIGTERM |
| `ALLOW_DEFAULT_USERS` | (unset) | Set to 1 once for first-boot admin seed |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | (unset) | If set, rohy serves HTTPS directly (skip if reverse proxy) |

## When in doubt

- **First time deploying rohy?** Use `deploy/docker/`.
- **Replacing an existing native install?** Use `deploy/bootstrap.sh`.
- **Just want to see it running on your laptop?** Use `deploy/local-install.sh`.
- **Need something exotic (k8s, bare metal at scale, etc.)?** The image
  built by `deploy/docker/Dockerfile` is the right base. Wire your own
  ingress + secrets manager. The compose file is a reference, not a cage.
