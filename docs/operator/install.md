# Installing Rohy

This document covers **putting Rohy on a machine** — local dev, single
classroom box, multi-user systemd install, Docker, and air-gapped
sites. Once installed, see [Deploy & harden](/operator/deploy) for production
hardening (TLS, reverse proxy, env, security checklist) and
[Updating](/operator/updating) for ongoing upgrades.

::: tip Reference
Env vars, CLI flags and exit codes are single-sourced in
[Config & env](/reference/config/) and [CLI & ops](/reference/cli/).
Terms like *snapshot* and *additive migration* are defined in the
[Glossary](/reference/glossary).
:::

---

## Choose a path

| Target | Path | What you get |
|---|---|---|
| **Pre-built release** (fastest) | [§ Published release](#published-release-recommended) | `docker pull ghcr.io/mohsaqr/rohy:latest` — image already built, models baked in |
| **Local dev** (your laptop) | [§ Local development](#local-development) | `npm run dev` — Vite + Express, hot reload, default seeded users |
| **Single machine** (lab / classroom) | [§ Local install](#single-machine-local-install) | `bash deploy/local-install.sh` — runs as your user, no root needed |
| **Linux + systemd** (multi-user prod) | [§ Linux + systemd](#linux-systemd-bootstrap) | `sudo deploy/bootstrap.sh` — systemd unit, nginx vhost, env file |
| **Docker (build from source)** | [§ Docker](#docker) | `docker compose -f deploy/docker/compose.yml up -d --build` — Caddy auto-TLS, persistent volumes |
| **Air-gapped** (no internet on target) | [§ Air-gap](#air-gapped-target) | One signed tarball, sha256-verified, platform-stamped |

After any path, install [§ Imaging content](#imaging-content) if you are on the
advanced channel, then go to [§ First boot](#first-boot) and
[§ Smoke verify](#smoke-verify).

### Which channel

| tag | what it is |
|---|---|
| `current` | the stable, **pre-plugin** build — no PACS, Pathology or ECG rooms |
| `advanced` | those rooms included; needs imaging content installed (below) |

Take `current` if you do not teach imaging. There is nothing to install and
nothing in the imaging section applies to you.

---

## Prerequisites

| Requirement | Versions known to work | Notes |
|---|---|---|
| **Node.js** | 22.x (LTS) | Express 5 + Vite 7 require >=20; we target 22 |
| **npm** | 10.x | Bundled with Node 22 |
| **SQLite** | 3.x | System binary needed for the air-gap install path; the dev install uses bundled `sqlite3` npm package |
| **curl** | any | Required for the post-install Oyon model download (~93 MB from jsDelivr); skip with no internet — see air-gap path |
| **Python 3** | 3.10+ | Optional, only for `post-verify-rohy.sh` JSON parsing |
| **OS** | macOS arm64, Linux x86_64, Linux arm64 | Native binaries are platform-locked; cross-builds need Docker (see [§ Air-gap](#air-gapped-target)) |

### The `dynajs` sibling — clone it before `npm install`

`package.json` declares `dynajs` as `file:../dynajs`, so it must be cloned
**beside** the rohy checkout, not inside it:

```bash
git clone https://github.com/mohsaqr/rohySimulator.git rohy
git clone https://github.com/mohsaqr/dynajs.git dynajs     # sibling, not nested
cd dynajs && npm install && cd ../rohy
```

Get this wrong and `npm install` does not fail. It resolves the dependency to
an empty stub, and the build breaks later somewhere unrelated — which is why
this is the first item here rather than a footnote.

---

### The `3D` sibling — the 3D patient room, also beside the checkout

`package.json` also declares `rohy-3d-patient-room` as `file:../3D`. It is a
plain ES-module package (no build step), so a clone is enough:

```bash
git clone https://github.com/mohsaqr/3D.git 3D                # sibling, not nested
```

`deploy/preflight.sh` checks for it (step 9), and `npm run build` refuses to
start without it (`scripts/verify-room3d-install.mjs`).

---

## Published release (recommended)

If a release has been tagged, the fastest install is to pull the pre-built
image instead of building locally. Every tag publishes three artifacts:

| Artifact | What | Where |
|---|---|---|
| `ghcr.io/mohsaqr/rohy:<tag>` | Multi-arch Docker image (amd64 + arm64), models baked in | GitHub Container Registry |
| `rohy-airgap-source-<sha>-linux-amd64-<date>.tar.gz` | Self-contained source tarball (~1.8 GB), zero-network install | GitHub Releases |
| `rohy-airgap-docker-<sha>-linux-amd64-<date>.tar.gz` | `docker save`'d image tarball for air-gapped sites with Docker | GitHub Releases |

The `<tag>`, `<sha>` and `<date>` placeholders above are filled in per
release. Each artifact has a `.sha256` sidecar for integrity verification.

### Docker pull (smallest, simplest)

```bash
git clone https://github.com/mohsaqr/rohySimulator.git rohy   # for compose + Caddyfile
cd rohy
cp deploy/docker/.env.example deploy/docker/.env
# edit deploy/docker/.env — at minimum CADDY_DOMAIN and JWT_SECRET

# Pull the published image instead of building
sed -i.bak 's|build:.*|image: ghcr.io/mohsaqr/rohy:latest|' deploy/docker/compose.yml
docker compose -f deploy/docker/compose.yml up -d
```

This skips the ~10-minute local build entirely. Models, vendor wasm, and
all dependencies are already inside the image.

### Air-gap tarball (zero-network target)

```bash
# On a host that CAN reach the internet (this is the only network step):
TAG=v0.1.0   # the release you want
curl -LO https://github.com/mohsaqr/rohySimulator/releases/download/$TAG/rohy-airgap-source-*-linux-amd64-*.tar.gz
curl -LO https://github.com/mohsaqr/rohySimulator/releases/download/$TAG/rohy-airgap-source-*-linux-amd64-*.tar.gz.sha256

# Transfer both files to the offline target host, then:
sha256sum -c rohy-airgap-source-*-linux-amd64-*.tar.gz.sha256
tar xzf rohy-airgap-source-*-linux-amd64-*.tar.gz
cd rohy-airgap-*
sudo ./airgap-install.sh --frontend-url=https://your-host
sudo systemctl start rohy
```

The target needs `node 22`, `sqlite3`, and a reverse proxy (`nginx` or
`caddy`) already installed. Nothing else fetches from the network.

### Air-gapped Docker (target has Docker but no internet)

```bash
# On a connected host:
curl -LO https://github.com/mohsaqr/rohySimulator/releases/download/$TAG/rohy-airgap-docker-*-linux-amd64-*.tar.gz

# Transfer to the offline target, then:
docker load < rohy-airgap-docker-*-linux-amd64-*.tar.gz
docker compose -f deploy/docker/compose.yml up -d
```

---

## Local development

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
npm install                                    # also fetches Oyon models (~93 MB)
cp server/.env.example server/.env
# edit server/.env — at minimum set JWT_SECRET (server refuses to start without it)
npm run dev
```

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:3000`
- **Default seeded users**: `admin` / `admin123`, `student` / `student123`
  — refused in production unless `ALLOW_DEFAULT_USERS=1`. Change them before any real user touches the box.

If `npm install` ran without `curl` or network, Oyon won't work until you re-fetch:

```bash
npm run setup:oyon          # idempotent — only fetches missing files
```

---

## Imaging content

**Advanced channel only.** The PACS and Pathology rooms read gigabytes of
pixels — DICOM series and Deep Zoom tile pyramids — far too large to live in
the repository or the image. They are published separately and installed with
one command:

```bash
npm run setup:content
```

That fetches 731 MB of imaging (48 studies) and 35 MB of cardiac pathology
(27 slides), verifies both by SHA-256, and installs them under
`server/plugin-content/`, which rohy serves from its own disk. Re-running it
after an upgrade is a no-op unless the content version changed.

**This is a step, not an option.** The default case orders four imaging
studies, so a learner on the advanced channel reaches the PACS room on the
first case they open. Without content that room is empty.

### Credentials

The content repository is private, so the download needs a GitHub token with
read access:

```bash
export ROHY_CONTENT_TOKEN=ghp_...      # or GITHUB_TOKEN, or be logged into `gh`
npm run setup:content
```

Tokens are issued per deployment, so one site's access can be revoked without
affecting the others. An unauthenticated request to a private release answers
**404, not 401**; the installer names that case rather than letting it read as
a missing release.

### Without network access to GitHub

The installer trusts the archive's checksum, not the host it came from, so any
transport works — a mirror, a shared drive, a stick carried to an offline site.
No token is needed on this path:

```bash
npm run setup:content -- --from /media/usb/rohy-content
npm run setup:content -- --only pathology      # slides without the 731 MB
```

A truncated transfer, the wrong archive, and the HTML error page some services
return instead of a file are all refused before anything is written, so a bad
download cannot damage a working installation.

### If you serve your own archive

A site with its own licensed imaging points rohy at it and installs nothing:

```
ROHY_PLUGIN_ORIGINS=pacs=https://slides.example.edu
ROHY_PLUGIN_ORIGIN_TOKENS=pacs=...     # if that origin is closed
```

A configured origin always wins over installed content. To run the advanced
channel with **no** imaging at all, set `ROHY_STARTER_CONTENT=off`: the rooms
then report honestly that no content is configured, which is the right state
for a deployment that must show only its own material.

### Known gaps

The Docker image and the air-gap tarballs do **not** yet carry imaging content.
On those paths, run `npm run setup:content` inside the container or on the host
after installing.

---

## Single-machine local install

For a classroom or lab box where one person owns the machine and there's
no shared `systemd` unit. Runs as your user, no root needed.

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
bash deploy/local-install.sh --port 4000
```

`local-install.sh` will:
- Install npm dependencies (`npm ci`)
- Generate a `server/.env` with a random `JWT_SECRET` if none exists
- Run a production build (`npm run build`)
- Print the start command — typically `NODE_ENV=production node server/server.js`

Disable Oyon at install time with `--no-oyon` (sets `OYON_ENABLED=0` in
the generated env). Toggle later by editing `server/.env`.

---

## Linux + systemd (bootstrap)

The packaged path for a real multi-user deploy on a Linux box. Creates a
dedicated user, installs to `/opt/repos/rohy`, writes
`/etc/rohy/env`, drops a `/etc/systemd/system/rohy.service`, configures
nginx (or Caddy) with the right reverse-proxy rules, and runs migrations.

```bash
git clone https://github.com/mohsaqr/rohySimulator.git /tmp/rohy-bootstrap
cd /tmp/rohy-bootstrap
sudo deploy/bootstrap.sh \
    --frontend-url=https://your-host/rohy \
    --admin-bootstrap
```

Common flags:

| Flag | Default | Effect |
|---|---|---|
| `--frontend-url=URL` | required | Public URL (must end with `/rohy` if behind a path-prefixed reverse proxy) |
| `--user=NAME` | `rohy` | OS user the service runs as |
| `--repo-dir=PATH` | `/opt/repos/rohy` | Where the source lives |
| `--db-path=PATH` | `/opt/data/rohy/database.sqlite` | SQLite file (survives `rohy-update` rebuilds) |
| `--proxy=nginx\|caddy\|none` | `nginx` | Which reverse proxy to configure (or none) |
| `--port=N` | `4000` | Express upstream port (proxied by nginx/Caddy) |
| `--admin-bootstrap` | off | Print a one-time admin credentials prompt at the end |
| `--no-oyon` | off | Set `OYON_ENABLED=0` in `/etc/rohy/env` |

Re-running `bootstrap.sh` is **idempotent** — it'll detect existing
state and skip what's already done. Safe to use as an upgrade tool too,
though [`bin/rohy-update`](/operator/updating) is the operator path for that.

After install:

```bash
sudo systemctl status rohy             # confirm running
sudo journalctl -u rohy -f             # live logs
```

---

## Docker

For ad-hoc deploys, ephemeral test environments, or operators who'd
rather avoid systemd. Caddy reverse-proxies with auto-TLS via Let's
Encrypt. Persistent volumes for the SQLite DB and Oyon model bundles.

```bash
cd deploy/docker
cp .env.example .env
# edit .env — at minimum CADDY_DOMAIN and JWT_SECRET
docker compose up -d --build
```

Compose file: `deploy/docker/compose.yml`. Two services:
- `rohy` — node 22 + sqlite3, builds from the repo, exposes 4000
- `caddy` — reverse proxy with `Caddyfile` template

Persistent volumes:
- `./data:/opt/data/rohy` — SQLite DB lives here
- `./oyon-cache:/opt/repos/rohy/OyonR/standalone/vendor` — wasm/mjs vendor cache

`OYON_ENABLED=1` is the compose default. Disable with `OYON_ENABLED=0`
in `.env`.

---

## Air-gapped target

For sites with **no internet on the target host** — clinical labs,
secured networks, or restricted egress. One signed tarball with
everything bundled.

### Build host (must match target's OS+arch)

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
npm install                                                    # fetches Oyon models
bash server/scripts/install-piper.sh                           # optional, +326 MB
deploy/bundle-airgap.sh --mode=source --with-hf-cache          # optional Kokoro pre-warm

# → dist/airgap/rohy-airgap-source-<sha>-<platform>-<date>.tar.gz   (~1.8 GB)
# → dist/airgap/rohy-airgap-source-<sha>-<platform>-<date>.tar.gz.sha256
```

The `<sha>`, `<platform>` and `<date>` placeholders above are filled in
by the bundler at build time.

Common bundler flags:

| Flag | Effect |
|---|---|
| `--mode=source\|docker\|both` | Source tarball (needs node + sqlite3 on target), `docker save`d image (needs only docker), or both |
| `--with-hf-cache` | Bundle `$TRANSFORMERS_CACHE` so Kokoro TTS works offline on first request |
| `--with-dynajs` | Bundle the `../dynajs` sibling clone if `package.json` uses `file:../dynajs` |
| `--with-3d` | Bundle the `../3D` sibling clone (the 3D patient room) if `package.json` uses `file:../3D` |
| `--no-piper` / `--with-piper` | Exclude/require the Piper venv (auto-detected; saves ~326 MB if excluded) |

**Cross-platform note**: bundles are platform-stamped because they
contain native binaries (`node_sqlite3.node`, `onnxruntime.so`/`.dylib`,
`Darwin/FBX2glTF`). To build a Linux-x86_64 bundle from a Mac:

```bash
docker run --rm -v "$PWD:/work" -w /work --platform=linux/amd64 \
    node:22-bookworm bash -c "
        apt-get update && apt-get install -y rsync python3-venv sqlite3 && \
        npm install && bash OyonR/scripts/download-models.sh && \
        deploy/bundle-airgap.sh --mode=source
    "
```

Or use `--mode=docker` — Docker images are Linux regardless of build
host, and the target only needs Docker.

### Publish

The bundler prints all three:

```bash
gh release create v$(git rev-parse --short HEAD) \
    dist/airgap/*.tar.gz dist/airgap/*.sha256
huggingface-cli upload <user>/rohy-airgap dist/airgap/ .
rclone copy dist/airgap/ r2:rohy-airgap/
```

Replace `<user>` with your Hugging Face account name.

### Target host (last network step is the download)

```bash
curl -L -o rohy.tar.gz <release-url>
curl -L -o rohy.tar.gz.sha256 <release-url>.sha256
sha256sum -c rohy.tar.gz.sha256                                # verify integrity
tar xzf rohy.tar.gz && cd rohy-airgap-*
sudo ./airgap-install.sh \
    --user=rohy \
    --repo-dir=/opt/rohy \
    --frontend-url=https://your-host/rohy \
    --proxy=nginx                                              # nginx | caddy | none
sudo systemctl start rohy
```

Replace `<release-url>` with the GitHub release download URL.
`airgap-install.sh` refuses to install on a mismatched platform so a
darwin-arm64 bundle won't accidentally get unpacked onto linux-x86_64.

---

## First boot

Whichever path you used:

1. **Migrations + seeders auto-run** on first start (see the
   [Migrations runbook](/operator/migrations) for the additive-only policy).
2. **First registered user becomes admin** if zero users exist. After
   that, registrations default to `student`.
3. **Default seeded users** are present in dev (`admin/admin123`,
   `student/student123`) but **refused in production** unless
   `ALLOW_DEFAULT_USERS=1`. Change them before exposing the box.

On systemd boxes:

```bash
sudo systemctl status rohy
sudo journalctl -u rohy -n 50              # last 50 log lines
```

In Docker:

```bash
docker compose logs -f rohy
```

---

## Smoke verify

End-to-end check from the operator host. Run this after every install
or upgrade:

```bash
scripts/smoke.sh https://your-host/rohy
```

Light liveness probe — confirms the service answers and the SPA shell
loads. If smoke passes but something else feels off, run the heavier
verifier:

```bash
scripts/tech-test.sh https://your-host/rohy
```

27 checks: liveness, frontend bundle integrity, Oyon API surface, nginx
parity, auth gating, security headers, response timing. Used as the
deploy verifier in the SaqrServer hub flow and by `bin/rohy-update` as
its post-deploy step.

For a self-signed LAN cert: `ROHY_INSECURE=1 scripts/tech-test.sh ...`.

To go beyond "is it up?" and verify the Oyon validator actually runs
correctly, set up the contract probe — see
[Deploy & harden § Deploy verification](/operator/deploy#deploy-verification-live-monitoring).

---

## What's installed where

After a `bootstrap.sh` install:

| Path | Owner | What's there |
|---|---|---|
| `/opt/repos/rohy/` | `rohy` user | Source tree (git clone). `bin/rohy-update` reads from here. |
| `/opt/data/rohy/database.sqlite` | `rohy` user | SQLite DB. Persists across upgrades. |
| `/etc/rohy/env` | `root` | systemd `EnvironmentFile`. Edit to change `OYON_ENABLED`, `JWT_SECRET`, etc. |
| `/etc/rohy/update.conf` | `root` | `bin/rohy-update` config (optional; defaults work). |
| `/etc/systemd/system/rohy.service` | `root` | systemd unit. |
| `/etc/nginx/sites-available/rohy` | `root` | nginx vhost (or Caddyfile equivalent). |
| `/var/backups/rohy/` | `rohy` user | Snapshot dir for `rohy-backup.sh` and `rohy-update`. |
| `/var/log/journal/` | `root` | NDJSON logs via systemd-journald. `journalctl -u rohy`. |

After Docker:
- Everything's in `deploy/docker/` plus the volumes `./data` and `./oyon-cache`.

---

## Troubleshooting install

**`JWT_SECRET` missing — server refuses to start.** Required, no default. Generate one:

```bash
openssl rand -hex 32
```

**Oyon download failed during `npm install`.** Re-run `npm run setup:oyon`. Idempotent. Needs internet access to `cdn.jsdelivr.net`.

**Native module mismatch (`Error: ELF header invalid`).** Cross-platform bundle. Rebuild on the target's OS+arch, or use `--mode=docker`.

**`bootstrap.sh` fails at `npm ci`.** Likely a Node version mismatch. Confirm `node --version` is 22.x. The script prints `WARN` if the detected version is outside the supported range.

**Port 4000 already in use.** Change with `--port=N` (bootstrap) or `PORT=N` (env). Express falls through to the next free port automatically in dev but not in production.

**nginx 502 immediately after install.** Express needs ~3-6s to finish migrations + seed checks. Wait, then `sudo systemctl status rohy`. If still 502 after 30s, check `journalctl -u rohy` — most often a missing env var.

**Oyon disabled but Settings tab still loads.** Expected. Disabled mode shows a friendly panel instead of 404s. Re-enable: `OYON_ENABLED=1` in `/etc/rohy/env`, then `sudo systemctl restart rohy`.

---

## Next

- **Got the binary running, now configure it?** — `docs/ADMIN_FIRST_RUN.md` in the repo: LLM provider, TTS provider + voice slots, default personas, diagnostic bar, smoke session.
- **Going to production?** — [Deploy & harden](/operator/deploy): TLS, reverse proxy, security checklist, env reference, monitoring.
- **Already running, want to upgrade?** — [Updating](/operator/updating): `rohy-update`, rollback, off-site backups.
- **Embedding Oyon into another app?** — `OyonR/INSTALL.md` in the repo.
