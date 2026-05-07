#!/usr/bin/env bash
# deploy/bootstrap.sh — fresh-server one-shot install for rohy.
#
# Idempotent. Safe to re-run after a failure or to upgrade an existing
# install — every step is "create if missing" rather than "create then
# crash if exists". Designed for Ubuntu 22.04+/Debian 12+ but should
# work on any systemd Linux with a working apt.
#
# Usage:
#   sudo deploy/bootstrap.sh                 # everything, prompts for input
#   sudo deploy/bootstrap.sh --no-nginx      # skip nginx vhost install
#   sudo deploy/bootstrap.sh --no-piper      # skip Piper venv install
#   sudo deploy/bootstrap.sh --dry-run       # print what it would do
#
# Env overrides (any can be set in the calling environment):
#   ROHY_USER=saqr                           # local user that owns rohy
#   ROHY_REPO_DIR=/opt/repos/rohy
#   ROHY_DATA_DIR=/opt/data/rohy
#   ROHY_HF_CACHE=/var/cache/rohy-hf
#   ROHY_ENV_FILE=/etc/rohy/env
#   ROHY_PORT=4000
#
# What it does, in order:
#   1. apt prereqs (nodejs, npm, sqlite3, python3-venv, nginx)
#   2. Create persistent dirs + chown them to ROHY_USER
#   3. Install Piper venv (unless --no-piper) by calling server/scripts/install-piper.sh
#   4. Generate /etc/rohy/env from deploy/env.example (with a fresh JWT_SECRET)
#   5. Install systemd unit from deploy/systemd/rohy.service.example
#   6. Install nginx vhost from deploy/nginx/rohy.conf.example (unless --no-nginx)
#   7. systemctl daemon-reload, enable, start
#   8. Print next steps (FRONTEND_URL, ALLOW_DEFAULT_USERS bootstrap)

set -euo pipefail

# -- args / config --------------------------------------------------------
DO_NGINX=1
DO_PIPER=1
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --no-nginx) DO_NGINX=0 ;;
        --no-piper) DO_PIPER=0 ;;
        --dry-run)  DRY_RUN=1 ;;
        --help|-h)
            sed -n '2,30p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            printf 'unknown arg: %s (use --help)\n' "$arg" >&2
            exit 2 ;;
    esac
done

ROHY_USER="${ROHY_USER:-${SUDO_USER:-rohy}}"
ROHY_REPO_DIR="${ROHY_REPO_DIR:-/opt/repos/rohy}"
ROHY_DATA_DIR="${ROHY_DATA_DIR:-/opt/data/rohy}"
ROHY_HF_CACHE="${ROHY_HF_CACHE:-/var/cache/rohy-hf}"
ROHY_ENV_FILE="${ROHY_ENV_FILE:-/etc/rohy/env}"
ROHY_PORT="${ROHY_PORT:-4000}"

REPO_SRC="$(cd "$(dirname "$0")/.." && pwd)"

run() {
    if (( DRY_RUN )); then
        printf '  [dry-run] %s\n' "$*"
    else
        printf '  $ %s\n' "$*"
        "$@"
    fi
}

require_root() {
    if [[ $EUID -ne 0 ]]; then
        printf 'bootstrap must run as root (use sudo).\n' >&2
        exit 2
    fi
}

# -- 0. sanity ------------------------------------------------------------
require_root

if ! id -u "$ROHY_USER" >/dev/null 2>&1; then
    printf 'user "%s" does not exist on this host. Create it first:\n' "$ROHY_USER" >&2
    printf '  sudo adduser --system --group --home /home/%s %s\n' "$ROHY_USER" "$ROHY_USER" >&2
    exit 2
fi

printf '\n=== rohy bootstrap ===\n'
printf 'user        : %s\n' "$ROHY_USER"
printf 'repo dir    : %s\n' "$ROHY_REPO_DIR"
printf 'data dir    : %s\n' "$ROHY_DATA_DIR"
printf 'hf cache    : %s\n' "$ROHY_HF_CACHE"
printf 'env file    : %s\n' "$ROHY_ENV_FILE"
printf 'port        : %s\n' "$ROHY_PORT"
printf 'nginx step  : %s\n' "$([[ $DO_NGINX -eq 1 ]] && echo yes || echo skipped)"
printf 'piper step  : %s\n' "$([[ $DO_PIPER -eq 1 ]] && echo yes || echo skipped)"
printf 'dry-run     : %s\n' "$([[ $DRY_RUN -eq 1 ]] && echo yes || echo no)"

# -- 1. apt prereqs -------------------------------------------------------
printf '\n[1/7] apt prereqs\n'
APT_PKGS=(nodejs npm sqlite3 python3-venv ufw)
[[ $DO_NGINX -eq 1 ]] && APT_PKGS+=(nginx)
run apt-get update -qq
run apt-get install -y "${APT_PKGS[@]}"
# python3.12-venv on noble is a separate package; install if present.
if apt-cache show python3.12-venv >/dev/null 2>&1; then
    run apt-get install -y python3.12-venv || true
fi

# -- 2. dirs --------------------------------------------------------------
printf '\n[2/7] persistent dirs\n'
for d in "$ROHY_DATA_DIR" "$ROHY_HF_CACHE" "$(dirname "$ROHY_ENV_FILE")"; do
    run mkdir -p "$d"
done
run chown -R "$ROHY_USER:$ROHY_USER" "$ROHY_DATA_DIR" "$ROHY_HF_CACHE"

# -- 3. Piper venv --------------------------------------------------------
if (( DO_PIPER )); then
    printf '\n[3/7] Piper venv\n'
    if [[ -x "$ROHY_REPO_DIR/server/scripts/install-piper.sh" ]]; then
        run sudo -u "$ROHY_USER" bash "$ROHY_REPO_DIR/server/scripts/install-piper.sh"
    else
        printf '  ! install-piper.sh not found at %s — skipping (install manually later)\n' "$ROHY_REPO_DIR/server/scripts/install-piper.sh"
    fi
else
    printf '\n[3/7] Piper venv — SKIPPED (--no-piper)\n'
fi

# -- 4. env file ----------------------------------------------------------
printf '\n[4/7] env file\n'
if [[ -f "$ROHY_ENV_FILE" ]]; then
    printf '  existing env file at %s — leaving alone\n' "$ROHY_ENV_FILE"
else
    if [[ ! -f "$REPO_SRC/deploy/env.example" ]]; then
        printf '  ! deploy/env.example not found at %s\n' "$REPO_SRC/deploy/env.example" >&2
        exit 1
    fi
    JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    if (( DRY_RUN )); then
        printf '  [dry-run] would write %s with a fresh JWT_SECRET\n' "$ROHY_ENV_FILE"
    else
        # Stamp the example: replace the JWT placeholder, set NODE_ENV/ROHY_DB/TRANSFORMERS_CACHE/PORT.
        sed \
            -e "s|REPLACE_ME_WITH_A_LONG_RANDOM_STRING|${JWT}|" \
            -e "s|^FRONTEND_URL=.*|# FRONTEND_URL not set yet — edit me before first start|" \
            -e "s|^ROHY_DB=.*|ROHY_DB=${ROHY_DATA_DIR}/database.sqlite|" \
            -e "s|^TRANSFORMERS_CACHE=.*|TRANSFORMERS_CACHE=${ROHY_HF_CACHE}|" \
            -e "s|^PORT=.*|PORT=${ROHY_PORT}|" \
            "$REPO_SRC/deploy/env.example" > "$ROHY_ENV_FILE"
        chmod 600 "$ROHY_ENV_FILE"
        chown root:root "$ROHY_ENV_FILE"
        printf '  wrote %s (0600 root:root) with a fresh JWT_SECRET\n' "$ROHY_ENV_FILE"
        printf '  EDIT NOW: set FRONTEND_URL to your public URL, then re-run\n'
    fi
fi

# -- 5. systemd unit ------------------------------------------------------
printf '\n[5/7] systemd unit\n'
UNIT_DST=/etc/systemd/system/rohy.service
UNIT_SRC="$REPO_SRC/deploy/systemd/rohy.service.example"
if [[ ! -f "$UNIT_SRC" ]]; then
    printf '  ! %s not found\n' "$UNIT_SRC" >&2
    exit 1
fi
if [[ -f "$UNIT_DST" ]]; then
    printf '  existing unit at %s — diffing\n' "$UNIT_DST"
    run diff -u "$UNIT_DST" "$UNIT_SRC" || true
    printf '  not overwriting; merge manually if you want the upstream changes\n'
else
    if (( DRY_RUN )); then
        printf '  [dry-run] would install %s, substituting User=%s, WorkingDirectory=%s, EnvironmentFile=%s, TRANSFORMERS_CACHE=%s, ROHY_DATA_DIR=%s\n' \
            "$UNIT_DST" "$ROHY_USER" "$ROHY_REPO_DIR" "$ROHY_ENV_FILE" "$ROHY_HF_CACHE" "$ROHY_DATA_DIR"
    else
        sed \
            -e "s|^User=.*|User=${ROHY_USER}|" \
            -e "s|^Group=.*|Group=${ROHY_USER}|" \
            -e "s|^WorkingDirectory=.*|WorkingDirectory=${ROHY_REPO_DIR}|" \
            -e "s|^EnvironmentFile=.*|EnvironmentFile=${ROHY_ENV_FILE}|" \
            -e "s|TRANSFORMERS_CACHE=.*|TRANSFORMERS_CACHE=${ROHY_HF_CACHE}|" \
            -e "s|/opt/data/rohy|${ROHY_DATA_DIR}|g" \
            -e "s|/var/cache/rohy-hf|${ROHY_HF_CACHE}|g" \
            -e "s|/opt/repos/rohy|${ROHY_REPO_DIR}|g" \
            "$UNIT_SRC" > "$UNIT_DST"
        chmod 644 "$UNIT_DST"
        printf '  wrote %s\n' "$UNIT_DST"
    fi
fi

# -- 6. nginx vhost -------------------------------------------------------
if (( DO_NGINX )); then
    printf '\n[6/7] nginx vhost\n'
    NG_SRC="$REPO_SRC/deploy/nginx/rohy.conf.example"
    NG_DST=/etc/nginx/conf.d/rohy.conf
    if [[ -f "$NG_DST" ]]; then
        printf '  existing %s — leaving alone (review deploy/nginx/rohy.conf.example for upstream changes)\n' "$NG_DST"
    elif [[ -f "$NG_SRC" ]]; then
        if (( DRY_RUN )); then
            printf '  [dry-run] would install %s with port=%s\n' "$NG_DST" "$ROHY_PORT"
        else
            sed -e "s|127.0.0.1:4000|127.0.0.1:${ROHY_PORT}|g" "$NG_SRC" > "$NG_DST"
            printf '  wrote %s — EDIT server_name + cert paths before reload\n' "$NG_DST"
        fi
    else
        printf '  ! %s not found, skipping\n' "$NG_SRC" >&2
    fi
else
    printf '\n[6/7] nginx vhost — SKIPPED (--no-nginx)\n'
fi

# -- 7. enable + start ----------------------------------------------------
printf '\n[7/7] enable + start systemd unit\n'
if (( DRY_RUN )); then
    printf '  [dry-run] systemctl daemon-reload && systemctl enable --now rohy\n'
else
    run systemctl daemon-reload
    run systemctl enable rohy
    if [[ -f "$ROHY_ENV_FILE" ]] && grep -q '^FRONTEND_URL=https\?://' "$ROHY_ENV_FILE" 2>/dev/null; then
        run systemctl restart rohy
    else
        printf '  not starting yet — FRONTEND_URL is not configured. Edit %s and run:\n' "$ROHY_ENV_FILE"
        printf '    sudo systemctl start rohy\n'
    fi
fi

# -- summary --------------------------------------------------------------
cat <<EOF

=== bootstrap done ===

Next steps:

  1. Edit ${ROHY_ENV_FILE} — set FRONTEND_URL to your deploy URL.
  2. (First run only) Add  ALLOW_DEFAULT_USERS=1  to that file, then start rohy
     and immediately log in as admin/admin123 to change the password. REMOVE
     the line afterward and  systemctl restart rohy .
  3. If you installed nginx — edit /etc/nginx/conf.d/rohy.conf to set
     server_name + cert paths, then  sudo nginx -t && sudo systemctl reload nginx .
  4. Run  ${REPO_SRC}/deploy/preflight.sh  to verify config.
  5. Run  ${REPO_SRC}/scripts/smoke.sh \$ROHY_DEPLOY_URL  to verify the deploy.
  6. Watch the first minute of logs:  sudo journalctl -u rohy.service -f .

EOF
