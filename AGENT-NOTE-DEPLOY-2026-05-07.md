# Agent Note — Deploy Hardening (2026-05-07)

Lessons from a full LAN-only production deploy of rohy on `saqr@192.168.50.39`.
Captures every gotcha that bit during setup so the next agent — or a fresh
human — can avoid them.

> **Audience.** Agents/operators deploying rohy on a self-hosted server (Ubuntu
> 24.04+ in this case). Some advice is rohy-specific; some is generally
> useful for any Vite + Express + SQLite app behind nginx.

> **Reality check.** `docs/DEPLOY_CHECKLIST.md` documents a `saqr.me/rohy`
> public path with a mac-push `rsync` flow. The actual production deploy on
> 2026-05-07 is LAN-only at `https://192.168.50.39:4001/rohy/`, **server-pull**
> via cron (`git pull && npm ci && npm run build && systemctl restart rohy`).
> If you re-publicize, restore the docs path; until then this is the truth.

---

## 1. Required env vars (production)

These all live in `/etc/rohy/env` (root:root, 0600), loaded by
`rohy.service`'s `EnvironmentFile=`. Never commit them.

| Var | Required? | What it does | Failure mode if missing |
|---|---|---|---|
| `JWT_SECRET` | **yes** | Signs auth tokens | App refuses to boot — `FATAL: JWT_SECRET environment variable is not set!` |
| `FRONTEND_URL` | **yes when behind a proxy / non-localhost origin** | Adds the public-facing origin to the CORS allowlist | Browser asset loads silently 500 with `[CORS] Blocked request from origin: <url>` in journal — looks like a generic 500, isn't |
| `NODE_ENV=production` | **yes** | Disables seeders, dev helpers, request-body verbosity | Default users seed in prod by accident (security risk) |
| `PORT` | recommended | Listening port (default 3000) | Conflict with whatever else is on 3000 |
| `ROHY_DB` | recommended | Absolute path to SQLite DB (default: relative to `__dirname`) | DB lives inside the repo → wiped on clean clones / wrong location after `npm ci` |
| `ALLOW_DEFAULT_USERS=1` | **transient** | Forces the user seeder to run in production. Use **once** to bootstrap, then remove. | Seeder is gated by `NODE_ENV==='production' && ALLOW_DEFAULT_USERS!=='1'` — without this you get an empty users table and can't log in |
| `TRANSFORMERS_CACHE` | **strongly recommended** | Where `@huggingface/transformers` caches the Kokoro model | Without it, cache lives **inside `node_modules/`** → wiped on every `npm ci` → re-downloaded → re-truncated → ORT crash → process exit 7 → systemd restart loop. **See §4.** |

**Suggested addition to `rohy.service`:**

```ini
Environment=TRANSFORMERS_CACHE=/var/cache/rohy-hf
```

Pre-create that dir owned by `saqr:saqr`. Then the model survives every
deploy.

---

## 2. Persistent state — what survives `npm ci` vs what doesn't

| Path | Survives `npm ci` / `git pull`? | Survives `rm -rf node_modules`? | Survives full repo wipe? |
|---|---|---|---|
| `/opt/data/rohy/database.sqlite` | ✓ (lives outside repo via `ROHY_DB`) | ✓ | ✓ |
| `/etc/rohy/env` (JWT_SECRET, etc.) | ✓ | ✓ | ✓ |
| Migrations (auto-applied on boot, idempotent) | ✓ | ✓ | ✓ |
| `server/data/piper/` (venv + voices) | ✓ (gitignored) | ✓ | **✗ — must re-run `bash server/scripts/install-piper.sh`** |
| `~/.cache/huggingface/` (Kokoro model) | **✗** (default lives inside `node_modules`) | ✗ | ✗ |
| Built `frontend/` and `dist/` | ✗ (rebuilt on every deploy) | ✗ | ✗ |

**Action:** anything in the "✗" column needs an explicit re-init step in
the deploy script, OR an env-var override that puts it outside the repo.
`TRANSFORMERS_CACHE` is the easiest win.

---

## 3. CORS — the silent-500 trap

The Express CORS middleware throws `Error("Not allowed by CORS")` when an
origin isn't in the allowlist. The global error handler in
`server/middleware/errorHandler.js` converts unhandled errors to **500**,
not 403. The browser then reports `Failed to load resource: 500` with no
indication that CORS was the cause. Symptom: blank page, assets all 500.

**Counter-intuitive fact:** same-origin requests *do* send the `Origin`
header for non-simple requests (modulepreload, `<script type="module">`,
fetch with custom headers). So same-origin is not exempt from the
allowlist check.

**Lesson:** every time you change the deployment URL (HTTP → HTTPS, IP
change, port change, new vhost), update `FRONTEND_URL` in `/etc/rohy/env`
and `systemctl restart rohy`. If you skip this and assets break, the
journal is the only place that says `[CORS] Blocked request from origin:`.

**Suggested code-side improvement (low risk, single line):** make the
CORS rejection return 403 explicitly instead of bubbling to the global
500 handler. Saves hours of debugging.

---

## 4. The Kokoro / ONNX-Runtime crash loop

The single most damaging gotcha encountered. Sequence:

1. Cron runs `npm ci`. Wipes `node_modules/`.
2. HF cache (Kokoro model) lived inside `node_modules/@huggingface/transformers/.cache/` → wiped.
3. First TTS call hits the rohy backend.
4. `@huggingface/transformers` re-downloads the model. Network blip → 22 MB on disk instead of 80 MB.
5. ONNX Runtime tries to parse the truncated `.onnx` → "Protobuf parsing failed."
6. ORT-WASM crash takes the **entire Node process** with it. Exit code 7.
7. systemd restarts. Goto 3.

User-visible symptom: 502s every 5–15 seconds, "Server returned empty response" toasts.

**Three fixes, in priority order:**

| Priority | Fix | Effort |
|---|---|---|
| **1** | Set `TRANSFORMERS_CACHE=/var/cache/rohy-hf` in `rohy.service` so the cache persists across `npm ci`. | 2 lines of systemd |
| **2** | Wrap `loadKokoro()` in `server/services/kokoroTts.js` with a `try/catch` that logs and falls back to `tts_provider=piper` instead of bubbling. | ~10 lines of code |
| **3** | At startup, hash-check the cached `.onnx` against a known-good size/checksum; if mismatch, delete and re-download cleanly. | ~30 lines of code |

**Quick-fix to recover from a current crash loop:**

```bash
sudo systemctl stop rohy
rm -rf /opt/repos/rohy/node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX
sudo sqlite3 /opt/data/rohy/database.sqlite \
  "INSERT INTO platform_settings(setting_key, setting_value) VALUES ('tts_provider','piper') \
   ON CONFLICT(setting_key) DO UPDATE SET setting_value='piper';"
sudo systemctl start rohy
```

That swaps to Piper (which is local, no download) and stops the crash loop.

---

## 5. Piper TTS — the manual install everyone forgets

Piper is **not** installed by `npm ci`. It's a Python venv set up by
`server/scripts/install-piper.sh`, which:

- Creates `server/data/piper/venv/` (gitignored)
- `pip install piper-tts==1.4.2`
- Downloads three starter voices (~100 MB) into `server/data/piper/`

Cron deploys do **not** re-run this script. After a fresh clone or
`rm -rf` of the rohy repo, you must run it manually:

```bash
cd /opt/repos/rohy && bash server/scripts/install-piper.sh
```

**Prerequisites on Ubuntu:** the script needs `python3.12-venv`. Install
it once with `sudo apt install python3.12-venv` — `python3-venv` alone
is a metapackage in noble that doesn't pull the Python-version-specific
package the script needs.

**Suggested improvement:** add `apt-get install -y python3-venv
python3.12-venv` to a `deploy/post-install.sh` script in the repo, and
have the cron deploy invoke it.

---

## 6. nginx in front — required directives for streaming TTS

If you put nginx between the browser and Express (we do at `:4001`),
the default `proxy_pass` config breaks streaming endpoints. Specifically
`/api/tts?stream=1` (chunked PCM) and any future SSE routes:

```nginx
location /rohy/ {
    proxy_pass http://127.0.0.1:4000/;            # trailing slash is load-bearing
    proxy_http_version 1.1;

    # Streaming knobs — required for chunked TTS
    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    chunked_transfer_encoding on;
    proxy_set_header Accept-Encoding "";          # prevent gzip renegotiation that buffers audio

    # Standard
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_max_body_size 50m;
}
```

Without `proxy_buffering off`, audio chunks pile up in nginx and the
browser only hears speech *after* the synth finishes — which times out
the AudioContext for long passages and yields silence.

---

## 7. Microphone — HTTPS is not optional

`getUserMedia()` (mic access for press-to-talk in case mode) requires a
**secure context**. Plain HTTP on a non-localhost origin (`http://192.168.50.39:4001`)
silently denies microphone access — no error, just no permission prompt,
and the case never receives audio.

**Allowed origins for getUserMedia:**
- `https://*` (always)
- `http://localhost`, `http://127.0.0.1`, `http://*.localhost` (legacy carve-out)
- Nothing else

**Solution at the deploy layer:** terminate HTTPS at nginx with a
self-signed cert (Subject Alt Name must include the IP). Browser shows
a one-time NET::ERR_CERT_AUTHORITY_INVALID warning per device — accept
once, persisted thereafter.

For polish (no warning), use `mkcert` and install the local CA on each
device that'll use the app.

---

## 8. The `dynajs` sibling-repo dependency

`package.json` declares `"dynajs": "file:../dynajs"`. This means npm
resolves dynajs from a **sibling directory** to the rohy repo. On the
server: `/opt/repos/rohy` and `/opt/repos/dynajs`.

**Required setup on a fresh server:**

```bash
git clone https://github.com/mohsaqr/dynajs.git /opt/repos/dynajs
cd /opt/repos/dynajs && npm install   # triggers `prepare` script which runs tsup → builds dist/
```

**`npm ci` vs `npm install` matters here:**

- `npm install` runs `prepare` scripts → dynajs's `dist/` gets built.
- `npm ci` does **not** run `prepare` by default → if dynajs's `dist/` is
  empty, rohy's import will fail at runtime.

**Solution in this deploy:** `sites.conf` for dynajs uses
`PULL_BUILD_dynajs="npm install --prefer-offline --silent"` (not
`npm ci`), and the server-side cron processes dynajs *before* rohy in
`SITES=()` order so dynajs's `dist/` is fresh when rohy rebuilds.

**Suggested improvement:** publish dynajs to npm (or as a public GitHub
package) so rohy's package.json can use a registry resolution instead of
`file:../`. Eliminates the sibling-repo coupling.

---

## 9. The `tnaj` ghost — package.json drift watch

`origin/main` had `"tnaj": "github:mohsaqr/tna-js"` (private repo, SSH-only
auth) for some time after the source code had already migrated to
`import from 'dynajs'`. Result: `npm ci` on a server without GitHub SSH
keys would fail with "Permission denied (publickey)". Even with the SSH
key, the resulting install puts the package at `node_modules/tnaj/`, not
`node_modules/dynajs/`, so the imports still fail.

**Lesson:** when removing a dependency, audit `package.json` AND
`package-lock.json` AND every `import` statement in the source — all in
the same commit. Mid-migration is uniquely dangerous because the build
*looks* fine locally (where `file:../dynajs` resolves) and only breaks
on the deploy host.

**Mitigation in this deploy:** `package.json` was fixed to remove `tnaj`
and add `dynajs: github:mohsaqr/dynajs` (public repo). Check
`git log --oneline package.json` periodically to confirm no zombie deps.

---

## 10. Fresh-server bootstrap — the canonical sequence

Concrete order of operations to bring rohy up on a brand new Ubuntu host:

```bash
# 1. SSH in. Install OS-level prereqs.
sudo apt update
sudo apt install -y nodejs npm python3.12-venv sqlite3 nginx ufw

# 2. Persistent state dirs.
sudo mkdir -p /opt/data/rohy /var/cache/rohy-hf /etc/rohy
sudo chown saqr:saqr /opt/data/rohy /var/cache/rohy-hf

# 3. Clone the deps + the app, sibling layout.
sudo mkdir -p /opt/repos
sudo chown saqr:saqr /opt/repos
git clone https://github.com/mohsaqr/dynajs.git /opt/repos/dynajs
git clone https://github.com/mohsaqr/rohySimulator.git /opt/repos/rohy

# 4. Build dynajs first (its `prepare` script runs tsup on `npm install`).
cd /opt/repos/dynajs && npm install --prefer-offline

# 5. Build rohy.
cd /opt/repos/rohy && npm ci --prefer-offline && npm run build

# 6. Install Piper (manual, NOT in cron).
bash server/scripts/install-piper.sh

# 7. Generate JWT_SECRET, write env file.
JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
sudo tee /etc/rohy/env > /dev/null <<EOF
JWT_SECRET=$JWT
FRONTEND_URL=https://192.168.50.39:4001    # ← actual URL of the deploy
ALLOW_DEFAULT_USERS=1                       # ← REMOVE this line after first start
EOF
sudo chmod 600 /etc/rohy/env

# 8. Write systemd unit (set TRANSFORMERS_CACHE!), enable, start.
sudo tee /etc/systemd/system/rohy.service > /dev/null <<EOF
[Unit]
Description=rohy — Virtual Patient Simulation Platform
After=network.target

[Service]
Type=simple
User=saqr
WorkingDirectory=/opt/repos/rohy
EnvironmentFile=/etc/rohy/env
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=ROHY_DB=/opt/data/rohy/database.sqlite
Environment=TRANSFORMERS_CACHE=/var/cache/rohy-hf
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rohy

# 9. After confirming default users seeded, REMOVE the flag.
sudo sed -i '/^ALLOW_DEFAULT_USERS=/d' /etc/rohy/env
sudo systemctl restart rohy

# 10. Configure nginx with the streaming directives from §6.
# 11. ufw allow on the listening interface.
# 12. Smoke test: curl -sk https://192.168.50.39:4001/rohy/ → expect 200.
```

---

## 11. Recurring journal noise that is not a bug (yet)

Two warnings/errors that appear in `journalctl -u rohy` but don't break
anything *now*. Worth fixing eventually:

| Log line | Severity | What's happening | One-line fix |
|---|---|---|---|
| `ValidationError: 'X-Forwarded-For' header is set but Express 'trust proxy' setting is false` | warn | `req.ip` is always `127.0.0.1` because nginx is the immediate peer → rate-limiters can't distinguish users | `app.set('trust proxy', '127.0.0.1')` near the top of `server/server.js` |
| `Skipping default user seeding in production. Set ALLOW_DEFAULT_USERS=1 to override.` | info | Expected on every restart after initial bootstrap. Tells you the safety gate is working. | (none — this one is *good*) |

---

## 12. Quick triage checklist when "the case isn't speaking"

The TTS pipeline has many failure modes. Walk through them in order:

| Step | Check | If false → action |
|---|---|---|
| 1 | `tailscale status` shows server + Mac online | Reconnect Tailscale on Mac |
| 2 | `curl -sk https://<host>/rohy/` returns 200 | `systemctl status rohy`; check journal |
| 3 | rohy's `tts_provider` setting | `sqlite3 /opt/data/rohy/database.sqlite "SELECT setting_value FROM platform_settings WHERE setting_key='tts_provider'"` — must be `kokoro`, `piper`, `google`, or `openai` |
| 4 | If Kokoro: model file size > 70 MB | Delete cache, restart, re-download |
| 5 | If Piper: `/opt/repos/rohy/server/data/piper/venv/bin/piper` exists | Re-run `install-piper.sh` |
| 6 | In-case **Voice** button toggled ON (look at diagnostic bar bottom — should say `voice ON`) | Click the Voice button |
| 7 | LLM provider configured + reachable | Check `/api/proxy/llm` → 500 means LLM unreachable; fix LM Studio / OpenAI key |
| 8 | Browser served over **HTTPS**, mic permission granted | Switch to HTTPS deploy; click padlock → Site Settings → Microphone → Allow |
| 9 | nginx vhost has `proxy_buffering off` | Add the streaming directives from §6 |
| 10 | Browser console shows no `CORS Blocked` errors | Update `FRONTEND_URL` in `/etc/rohy/env`, restart |

Diagnostic bar at bottom of screen is the fastest first signal — it
shows `LLM:`, `TTS:`, `voice ON/OFF`, `speaker:` in one line.

---

## 13. Things to NOT do

- **Do not** edit files in `/opt/repos/rohy` directly on the server. The
  next cron deploy will `git reset --hard` and lose them.
- **Do not** `git add dist/` or `git add frontend/` — both are build
  output, gitignored. The deploy builds them.
- **Do not** put secrets in `package.json` scripts or in committed
  `.env` files. Use `/etc/rohy/env`.
- **Do not** enable `ALLOW_DEFAULT_USERS=1` permanently. Bootstrap
  once, remove the line.
- **Do not** run `apt purge nodejs` on a host that also runs other Node
  services (the dependency removal is wider than expected).
- **Do not** use `npm install` on the server outside of the dynajs case
  (`npm install` mutates `package-lock.json` non-deterministically;
  `npm ci` is the deterministic command for app deploys).

---

## 14. Future improvements worth doing

In rough order of value-per-effort:

1. **Move `TRANSFORMERS_CACHE` outside `node_modules`.** One-line systemd
   change. Eliminates the Kokoro crash loop. (§4)
2. **`app.set('trust proxy', ...)` in `server.js`.** One line. Fixes
   rate-limiter accuracy. (§11)
3. **Wrap `loadKokoro` failures so they fall back instead of crashing.**
   ~10 lines. Removes the worst class of 502s. (§4)
4. **Return 403 (not 500) for CORS rejections.** ~5 lines in
   `errorHandler.js`. Saves debugging hours next time. (§3)
5. **Move HF Kokoro download to deploy time, not first-request.**
   Pre-warm the cache during `install-piper.sh`-equivalent step.
6. **Publish dynajs to npm.** Eliminates the sibling-repo + `file:../`
   coupling. Trivial deploys on any host.
7. **Add `deploy/post-install.sh` to the repo.** Wraps Piper install +
   apt prereqs + cache warming. Cron deploy invokes it on first run only.
8. **Type=notify in systemd unit.** Have the server signal readiness so
   `systemctl restart` waits for "actually listening" before declaring
   success — cuts the 502 gap.

---

## 15. Snapshot of current production state (2026-05-07)

| Aspect | Value |
|---|---|
| Host | `saqr@192.168.50.39` (Ubuntu 24.04) |
| Public URL (LAN-only) | `https://192.168.50.39:4001/rohy/` |
| Backend | `127.0.0.1:4000`, plain HTTP, only nginx talks to it |
| nginx vhost | `/etc/nginx/conf.d/rohy-lan.conf`, listens on `192.168.50.39:4001` (TLS, self-signed) |
| ufw rule | `ALLOW from 192.168.50.0/24 to port 4001` + `ALLOW in on tailscale0` |
| Remote access | Tailscale subnet router (`192.168.50.0/24` advertised + approved) |
| systemd unit | `rohy.service`, `User=saqr`, `EnvironmentFile=/etc/rohy/env` |
| SQLite DB | `/opt/data/rohy/database.sqlite` (saqr-owned, 1.5–N MB) |
| Repos on server | `/opt/repos/rohy` + `/opt/repos/dynajs` (siblings) |
| Piper venv | `/opt/repos/rohy/server/data/piper/venv/` (3 voices) |
| Active TTS provider | `piper` (Kokoro disabled after crash loop) |
| Active LLM provider | `openai` (`gpt-4o-mini`) |
| Auto-deploy | every 10 min via `/opt/update-sites.sh` cron on the server |
| Manual deploy | `./deploy.sh rohy` from `~/Documents/Github/JStats/website/` |
| Default admin | `admin` / `admin123` — **change immediately on first login** |
