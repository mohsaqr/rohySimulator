#!/usr/bin/env bash
# deploy/local-install.sh — run-it-anywhere installer.
#
# Use this for: a personal devbox, a classroom lab machine, a demo box,
# a quick evaluation install. No systemd, no nginx, no apt-as-root. Runs
# rohy directly under your user account on whatever HTTPS port you pick.
#
# This script does NOT replace the production deploy path:
#   - Production / multi-user / public  → use deploy/docker/ or deploy/bootstrap.sh
#   - Single-machine evaluation         → use this script
#
# What it does (idempotent):
#   1. Verifies node ≥20, npm, git are on PATH (helps you install if not).
#   2. Clones the dynajs sibling repo if missing, builds it.
#   3. Runs `npm install` + `npm run build` for rohy.
#   4. Generates a local `.env` with a fresh JWT_SECRET (only if absent).
#   5. Optionally pre-warms the Kokoro HF cache so the first TTS request
#      doesn't sit on a 330 MB download.
#   6. Optionally generates a self-signed TLS cert via mkcert (if installed)
#      so the mic works on a non-localhost LAN URL.
#   7. Prints the exact `node server/server.js` command to run.
#
# It does NOT:
#   - Install Node, Python, mkcert, etc. — prints what to install if missing.
#   - Set up systemd / launchd / nssm — that's deploy/bootstrap.sh / docker.
#   - Open firewall ports — that's host-level, OS-specific.
#
# Usage:
#   bash deploy/local-install.sh                        # interactive
#   bash deploy/local-install.sh --port 4000 --host 0.0.0.0
#   bash deploy/local-install.sh --skip-piper           # default; Kokoro is fine
#   bash deploy/local-install.sh --with-piper           # if you want offline TTS
#   bash deploy/local-install.sh --prewarm-kokoro       # download model now
#   bash deploy/local-install.sh --bind localhost --port 3000  # dev mode

set -euo pipefail

# -- args ------------------------------------------------------------------
PORT=4000
BIND_HOST="127.0.0.1"
WITH_PIPER=0
PREWARM_KOKORO=0
SKIP_BUILD=0
ALLOW_DEFAULTS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)            PORT="$2"; shift 2 ;;
        --host|--bind)     BIND_HOST="$2"; shift 2 ;;
        --with-piper)      WITH_PIPER=1; shift ;;
        --skip-piper)      WITH_PIPER=0; shift ;;
        --prewarm-kokoro)  PREWARM_KOKORO=1; shift ;;
        --skip-build)      SKIP_BUILD=1; shift ;;
        --allow-defaults)  ALLOW_DEFAULTS=1; shift ;;
        --help|-h)
            sed -n '2,40p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            printf 'unknown arg: %s (use --help)\n' "$1" >&2
            exit 2 ;;
    esac
done

# -- paths -----------------------------------------------------------------
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DYNAJS_DIR="$(cd "$REPO_DIR/.." && pwd)/dynajs"
ENV_FILE="$REPO_DIR/.env"

cd "$REPO_DIR"

# -- helpers ---------------------------------------------------------------
RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRN=$'\033[0;32m'; BLU=$'\033[0;34m'; CLR=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$BLU" "$CLR" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$CLR" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$CLR" "$1"; }
die()  { printf '  %s✗%s %s\n' "$RED" "$CLR" "$1" >&2; exit 1; }

# -- step 1: prerequisites --------------------------------------------------
say "checking prerequisites"

if ! command -v node >/dev/null 2>&1; then
    die "node not found. Install Node 20+ from https://nodejs.org or:
    macOS:   brew install node@22
    Linux:   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs
    nvm:     nvm install 22 && nvm use 22"
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if (( NODE_MAJOR < 20 )); then
    die "node $((NODE_MAJOR)) is too old; rohy needs ≥20 (22 recommended)."
fi
ok "node $(node --version)"

command -v npm >/dev/null 2>&1 || die "npm not found (it ships with node — check your install)"
ok "npm $(npm --version)"

command -v git >/dev/null 2>&1 || die "git not found. Install git via your package manager."
ok "git $(git --version | awk '{print $3}')"

# -- step 2: dynajs sibling -------------------------------------------------
say "checking dynajs sibling at $DYNAJS_DIR"

if [[ ! -d "$DYNAJS_DIR/.git" ]]; then
    warn "dynajs not found — cloning"
    git clone https://github.com/mohsaqr/dynajs.git "$DYNAJS_DIR"
fi

if [[ ! -f "$DYNAJS_DIR/dist/index.mjs" && ! -f "$DYNAJS_DIR/dist/index.js" ]]; then
    say "building dynajs (npm install runs the prepare script that creates dist/)"
    (cd "$DYNAJS_DIR" && npm install --prefer-offline --no-audit --no-fund)
    [[ -f "$DYNAJS_DIR/dist/index.mjs" || -f "$DYNAJS_DIR/dist/index.js" ]] \
        || die "dynajs build did not produce dist/. Look at: cd $DYNAJS_DIR && npm install"
fi
ok "dynajs ready at $DYNAJS_DIR"

# -- step 3: rohy install + build ------------------------------------------
if (( SKIP_BUILD )); then
    say "skipping rohy install + build (--skip-build)"
else
    say "installing rohy deps + building (this is the slow step, ~2-5 min)"
    npm install --prefer-offline --no-audit --no-fund
    npm run build
    ok "build complete (frontend/ regenerated)"
fi

# -- step 4: env file -------------------------------------------------------
say "configuring env"

if [[ -f "$ENV_FILE" ]]; then
    warn "$ENV_FILE exists — leaving alone (delete it manually if you want a fresh one)"
else
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    SCHEME="https"
    [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" ]] && SCHEME="http"
    FRONTEND_URL="${SCHEME}://${BIND_HOST}:${PORT}/rohy"

    {
        echo "# rohy local install — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "# Safe to edit. JWT_SECRET is unique to this install."
        echo
        echo "NODE_ENV=production"
        echo "JWT_SECRET=${JWT_SECRET}"
        echo "PORT=${PORT}"
        echo "FRONTEND_URL=${FRONTEND_URL}"
        echo "ROHY_DB=${REPO_DIR}/data/database.sqlite"
        echo "TRANSFORMERS_CACHE=${REPO_DIR}/data/hf-cache"
        if (( ALLOW_DEFAULTS )); then
            echo
            echo "# REMOVE the next line after first login + password change."
            echo "ALLOW_DEFAULT_USERS=1"
        fi
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    mkdir -p "$REPO_DIR/data" "$REPO_DIR/data/hf-cache"
    ok "wrote $ENV_FILE (mode 0600)"
    ok "FRONTEND_URL=$FRONTEND_URL"
fi

# -- step 5: optional Piper -------------------------------------------------
if (( WITH_PIPER )); then
    say "installing Piper TTS venv (this needs python3 + python3-venv)"
    if [[ -x "$REPO_DIR/server/scripts/install-piper.sh" ]]; then
        bash "$REPO_DIR/server/scripts/install-piper.sh" || warn "Piper install failed — TTS still works via Kokoro/Google/OpenAI"
    else
        warn "server/scripts/install-piper.sh not found — skipping Piper"
    fi
else
    say "skipping Piper (--with-piper to enable). Kokoro/Google/OpenAI providers work without it."
fi

# -- step 6: optional Kokoro pre-warm --------------------------------------
if (( PREWARM_KOKORO )); then
    say "pre-warming Kokoro model into HF cache (~330 MB download, one-time)"
    set +e
    node --input-type=module -e "
        import('./server/services/kokoroTts.js').then(async (m) => {
            try {
                await m.loadKokoro();
                console.log('  ✓ Kokoro model cached at:', process.env.TRANSFORMERS_CACHE);
                process.exit(0);
            } catch (err) {
                console.error('  ! Kokoro pre-warm failed:', err.message);
                console.error('    Not fatal — first TTS request will retry the download.');
                process.exit(0);
            }
        });
    " || warn "Kokoro pre-warm crashed — first TTS request will retry"
    set -e
fi

# -- step 7: optional self-signed cert (LAN deploys need TLS for mic) ------
if [[ "$BIND_HOST" != "127.0.0.1" && "$BIND_HOST" != "localhost" ]]; then
    say "non-localhost host detected — getUserMedia needs TLS"
    if [[ -x "$REPO_DIR/scripts/gen-self-signed-tls.sh" ]]; then
        ok "run scripts/gen-self-signed-tls.sh to generate a cert (one-time)"
    fi
    warn "after generating cert, set TLS_CERT_PATH + TLS_KEY_PATH in $ENV_FILE"
fi

# -- step 8: final instructions --------------------------------------------
say "install done — start rohy with:"
cat <<EOF

  cd $REPO_DIR
  npm run production

then open: ${SCHEME:-http}://${BIND_HOST}:${PORT}/rohy/

To run as a background process (no systemd):
  nohup npm run production > rohy.log 2>&1 &
  # later: kill \$(pgrep -f 'node server/server.js')

To verify it's healthy:
  scripts/smoke.sh "${SCHEME:-http}://${BIND_HOST}:${PORT}/rohy"

If you want the boring auto-start path on Linux/macOS, see:
  - deploy/bootstrap.sh   (Linux + systemd)
  - deploy/docker/        (Docker Compose, any OS)

EOF
