#!/usr/bin/env bash
# deploy/bootstrap.sh — fresh-server one-shot install for rohy.
#
# Idempotent. Safe to re-run after a failure or to upgrade an existing
# install — every step is "create if missing" rather than "create then
# crash if exists". Detects apt (Debian/Ubuntu) vs dnf (RHEL/Fedora) vs
# brew (macOS) and adapts. Designed for systemd Linux but the npm-build
# steps work on macOS too.
#
# Usage:
#   sudo deploy/bootstrap.sh                            # interactive, asks for input
#   sudo deploy/bootstrap.sh \
#        --frontend-url https://your-host/rohy \
#        --admin-bootstrap \
#        --with-dynajs --prewarm-kokoro                 # one-shot, no second pass
#
#   sudo deploy/bootstrap.sh --no-nginx                 # skip nginx (BYO ingress)
#   sudo deploy/bootstrap.sh --reverse-proxy=caddy      # use Caddy instead of nginx
#   sudo deploy/bootstrap.sh --reverse-proxy=none       # rohy listens directly
#   sudo deploy/bootstrap.sh --no-piper                 # skip Piper venv
#   sudo deploy/bootstrap.sh --skip-build               # just systemd/env/proxy
#   sudo deploy/bootstrap.sh --dry-run                  # print what it would do
#
# Flags:
#   --frontend-url URL   Write FRONTEND_URL=URL into the env file
#                        (eliminates the "edit env then re-run" loop)
#   --admin-bootstrap    Set ALLOW_DEFAULT_USERS=1 in env (REMOVE after first login)
#   --with-dynajs        Auto-clone dynajs sibling if missing, then build it
#   --prewarm-kokoro     Download the Kokoro model now (~330 MB) so first
#                        TTS request doesn't sit on a slow download
#   --reverse-proxy=X    nginx (default) | caddy | none
#   --skip-build         Don't run `npm install + npm run build` for rohy
#                        (use when CI already produced the build artifact)
#
# Env overrides (any can be set in the calling environment):
#   ROHY_USER=saqr
#   ROHY_REPO_DIR=/opt/repos/rohy
#   ROHY_DATA_DIR=/opt/data/rohy
#   ROHY_HF_CACHE=/var/cache/rohy-hf
#   ROHY_ENV_FILE=/etc/rohy/env
#   ROHY_PORT=4000
#   ROHY_DYNAJS_URL=https://github.com/mohsaqr/dynajs.git
#   ROHY_DYNAJS_REF=main
#
# What it does, in order:
#   1. Detect distro + install package prereqs (apt | dnf | brew).
#   2. Create persistent dirs + chown them to ROHY_USER.
#   3. (--with-dynajs) Clone + build dynajs sibling if missing.
#   4. (unless --skip-build) `npm install && npm run build` for rohy.
#   5. (unless --no-piper) Install Piper venv. Failure is loud, not silent.
#   6. (--prewarm-kokoro) Download Kokoro model into ROHY_HF_CACHE now.
#   7. Generate /etc/rohy/env from deploy/env.example (fresh JWT_SECRET,
#      FRONTEND_URL, ADMIN_BOOTSTRAP toggle if requested).
#   8. Install systemd unit from deploy/systemd/rohy.service.example.
#   9. Install reverse-proxy vhost (nginx | caddy | none).
#  10. systemctl daemon-reload, enable, start.
#  11. Print next steps + smoke probe command.

set -euo pipefail

# -- args / config --------------------------------------------------------
DO_PROXY="nginx"        # nginx | caddy | none
DO_PIPER=1
DO_BUILD=1
DO_DYNAJS=0
DO_PREWARM=0
DO_ADMIN_BOOTSTRAP=0
DRY_RUN=0
ARG_FRONTEND_URL=""

for arg in "$@"; do
    case "$arg" in
        --no-nginx)            DO_PROXY="none" ;;
        --reverse-proxy=nginx) DO_PROXY="nginx" ;;
        --reverse-proxy=caddy) DO_PROXY="caddy" ;;
        --reverse-proxy=none)  DO_PROXY="none" ;;
        --no-piper)            DO_PIPER=0 ;;
        --skip-build)          DO_BUILD=0 ;;
        --with-dynajs)         DO_DYNAJS=1 ;;
        --prewarm-kokoro)      DO_PREWARM=1 ;;
        --admin-bootstrap)     DO_ADMIN_BOOTSTRAP=1 ;;
        --frontend-url=*)      ARG_FRONTEND_URL="${arg#--frontend-url=}" ;;
        --frontend-url)        printf 'use --frontend-url=URL (with =), not space\n' >&2; exit 2 ;;
        --dry-run)             DRY_RUN=1 ;;
        --help|-h)
            sed -n '2,55p' "$0" | sed 's/^# \?//'
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
ROHY_DYNAJS_URL="${ROHY_DYNAJS_URL:-https://github.com/mohsaqr/dynajs.git}"
ROHY_DYNAJS_REF="${ROHY_DYNAJS_REF:-main}"

REPO_SRC="$(cd "$(dirname "$0")/.." && pwd)"

# -- distro detection -----------------------------------------------------
detect_pkg_mgr() {
    if command -v apt-get >/dev/null 2>&1; then
        printf 'apt'
    elif command -v dnf >/dev/null 2>&1; then
        printf 'dnf'
    elif command -v yum >/dev/null 2>&1; then
        printf 'yum'
    elif command -v brew >/dev/null 2>&1; then
        printf 'brew'
    else
        printf 'unknown'
    fi
}
PKG_MGR="$(detect_pkg_mgr)"

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
# brew on macOS runs as the invoking user, not root. Skip the root gate
# in that case; sudo is not used for brew package installs.
if [[ "$PKG_MGR" != "brew" ]]; then
    require_root
fi

if [[ "$PKG_MGR" != "brew" ]] && ! id -u "$ROHY_USER" >/dev/null 2>&1; then
    printf 'user "%s" does not exist on this host. Create it first:\n' "$ROHY_USER" >&2
    printf '  sudo adduser --system --group --home /home/%s %s\n' "$ROHY_USER" "$ROHY_USER" >&2
    exit 2
fi

printf '\n=== rohy bootstrap ===\n'
printf 'user           : %s\n' "$ROHY_USER"
printf 'repo dir       : %s\n' "$ROHY_REPO_DIR"
printf 'data dir       : %s\n' "$ROHY_DATA_DIR"
printf 'hf cache       : %s\n' "$ROHY_HF_CACHE"
printf 'env file       : %s\n' "$ROHY_ENV_FILE"
printf 'port           : %s\n' "$ROHY_PORT"
printf 'pkg mgr        : %s\n' "$PKG_MGR"
printf 'reverse proxy  : %s\n' "$DO_PROXY"
printf 'piper step     : %s\n' "$([[ $DO_PIPER -eq 1 ]] && echo yes || echo skipped)"
printf 'build step     : %s\n' "$([[ $DO_BUILD -eq 1 ]] && echo yes || echo skipped)"
printf 'dynajs step    : %s\n' "$([[ $DO_DYNAJS -eq 1 ]] && echo yes || echo skipped)"
printf 'kokoro prewarm : %s\n' "$([[ $DO_PREWARM -eq 1 ]] && echo yes || echo skipped)"
printf 'frontend url   : %s\n' "${ARG_FRONTEND_URL:-<edit env file later>}"
printf 'admin seed     : %s\n' "$([[ $DO_ADMIN_BOOTSTRAP -eq 1 ]] && echo "yes (REMOVE after first login)" || echo no)"
printf 'dry-run        : %s\n' "$([[ $DRY_RUN -eq 1 ]] && echo yes || echo no)"

# -- 1. package prereqs (distro-aware) ------------------------------------
printf '\n[1/10] package prereqs (%s)\n' "$PKG_MGR"
case "$PKG_MGR" in
    apt)
        APT_PKGS=(nodejs npm sqlite3 python3-venv git curl ca-certificates)
        [[ "$DO_PROXY" == "nginx" ]] && APT_PKGS+=(nginx)
        # Caddy needs an extra apt repo — see DigitalOcean / Caddy docs.
        # We don't add it automatically; print the command instead.
        run apt-get update -qq
        run apt-get install -y "${APT_PKGS[@]}"
        # python3.12-venv on noble is a separate package; install if present.
        if apt-cache show python3.12-venv >/dev/null 2>&1; then
            run apt-get install -y python3.12-venv || true
        fi
        if [[ "$DO_PROXY" == "caddy" ]] && ! command -v caddy >/dev/null 2>&1; then
            printf '  ! Caddy is not in default apt repos. Install it manually:\n'
            printf '    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl\n'
            printf '    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg\n'
            printf '    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list\n'
            printf '    sudo apt update && sudo apt install -y caddy\n'
            printf '  Then re-run this bootstrap.\n'
            exit 1
        fi
        ;;
    dnf|yum)
        DNF_PKGS=(nodejs npm sqlite python3 python3-pip git curl ca-certificates)
        [[ "$DO_PROXY" == "nginx" ]] && DNF_PKGS+=(nginx)
        [[ "$DO_PROXY" == "caddy" ]] && DNF_PKGS+=(caddy)
        run "$PKG_MGR" install -y "${DNF_PKGS[@]}"
        ;;
    brew)
        # macOS path — useful for mac-mini-as-server installs. Brew runs as
        # the invoking user, not root.
        if [[ $EUID -eq 0 ]]; then
            printf '  ! brew should run as your user, not root. Re-run without sudo, or set ROHY_PKG_MGR=skip.\n' >&2
            exit 2
        fi
        BREW_PKGS=(node@22 sqlite python@3.11)
        [[ "$DO_PROXY" == "nginx" ]] && BREW_PKGS+=(nginx)
        [[ "$DO_PROXY" == "caddy" ]] && BREW_PKGS+=(caddy)
        run brew install "${BREW_PKGS[@]}"
        ;;
    *)
        printf '  ! unknown package manager. Make sure these are installed manually:\n' >&2
        printf '    node (≥20), npm, git, sqlite3, python3 (+ venv), curl\n' >&2
        printf '    plus your reverse proxy of choice (nginx or caddy)\n' >&2
        printf '  Continuing — assuming the operator handled it.\n'
        ;;
esac

# -- 2. dirs --------------------------------------------------------------
printf '\n[2/10] persistent dirs\n'
for d in "$ROHY_DATA_DIR" "$ROHY_HF_CACHE" "$(dirname "$ROHY_ENV_FILE")"; do
    run mkdir -p "$d"
done
run chown -R "$ROHY_USER:$ROHY_USER" "$ROHY_DATA_DIR" "$ROHY_HF_CACHE"

# -- 3. dynajs sibling ----------------------------------------------------
DYNAJS_DIR="$(cd "$REPO_SRC/.." && pwd)/dynajs"
if (( DO_DYNAJS )); then
    printf '\n[3/10] dynajs sibling\n'
    if [[ ! -d "$DYNAJS_DIR/.git" ]]; then
        printf '  cloning %s -> %s (ref=%s)\n' "$ROHY_DYNAJS_URL" "$DYNAJS_DIR" "$ROHY_DYNAJS_REF"
        run sudo -u "$ROHY_USER" git clone "$ROHY_DYNAJS_URL" "$DYNAJS_DIR"
        run sudo -u "$ROHY_USER" git -C "$DYNAJS_DIR" checkout "$ROHY_DYNAJS_REF"
    else
        # Existing clone — fetch and verify it matches ROHY_DYNAJS_REF.
        # Without this, an upgrade run that sets ROHY_DYNAJS_REF=v0.2.0
        # would silently keep building against whatever ref was checked out
        # last time. We fetch first (so the ref is resolvable even if it
        # was added upstream after the original clone), then compare the
        # current HEAD to the resolved target. If they differ, we either
        # check out the new ref (default) or warn-only (DYNAJS_REF_LOCK=1
        # for operators who manage dynajs by hand).
        printf '  dynajs already present at %s — verifying ref=%s\n' "$DYNAJS_DIR" "$ROHY_DYNAJS_REF"
        if (( DRY_RUN )); then
            printf '  [dry-run] would: git fetch --tags && rev-parse HEAD vs %s; checkout if mismatch\n' "$ROHY_DYNAJS_REF"
        else
            sudo -u "$ROHY_USER" git -C "$DYNAJS_DIR" fetch --tags --quiet origin || \
                printf '  ! git fetch failed (offline?) — comparing against existing local refs only\n' >&2
            current_sha=$(sudo -u "$ROHY_USER" git -C "$DYNAJS_DIR" rev-parse HEAD 2>/dev/null || echo "")
            # `rev-parse --verify --quiet` is the only form that returns
            # empty + non-zero exit when the ref doesn't resolve. The plain
            # form echoes the literal ref name to stdout on failure, which
            # would have made target_sha look "non-empty but bogus" and the
            # subsequent checkout would noisy-fail in production.
            target_sha=$(sudo -u "$ROHY_USER" git -C "$DYNAJS_DIR" rev-parse --verify --quiet "${ROHY_DYNAJS_REF}^{commit}" 2>/dev/null || echo "")
            if [[ -z "$target_sha" ]]; then
                printf '  ! target ref "%s" not resolvable in %s — skipping checkout (left as-is)\n' "$ROHY_DYNAJS_REF" "$DYNAJS_DIR" >&2
            elif [[ "$current_sha" == "$target_sha" ]]; then
                printf '  ✓ dynajs already at %s (%s)\n' "$ROHY_DYNAJS_REF" "${current_sha:0:10}"
            elif [[ "${DYNAJS_REF_LOCK:-0}" == "1" ]]; then
                printf '  ! WARNING: dynajs HEAD=%s but ROHY_DYNAJS_REF=%s (=%s).\n' \
                    "${current_sha:0:10}" "$ROHY_DYNAJS_REF" "${target_sha:0:10}" >&2
                printf '  ! DYNAJS_REF_LOCK=1 set — leaving checkout alone. Re-run without lock to update.\n' >&2
            else
                printf '  drift detected: HEAD=%s -> checking out %s (=%s)\n' \
                    "${current_sha:0:10}" "$ROHY_DYNAJS_REF" "${target_sha:0:10}"
                run sudo -u "$ROHY_USER" git -C "$DYNAJS_DIR" checkout "$ROHY_DYNAJS_REF"
                # Force a rebuild on ref change — old dist/ would otherwise
                # outlive the source it was built from.
                run sudo -u "$ROHY_USER" rm -rf "$DYNAJS_DIR/dist"
            fi
        fi
    fi
    if [[ ! -f "$DYNAJS_DIR/dist/index.mjs" && ! -f "$DYNAJS_DIR/dist/index.js" ]]; then
        printf '  building dynajs (npm install runs the prepare script that produces dist/)\n'
        run sudo -u "$ROHY_USER" bash -c "cd '$DYNAJS_DIR' && npm install --prefer-offline --no-audit --no-fund"
        if [[ ! -f "$DYNAJS_DIR/dist/index.mjs" && ! -f "$DYNAJS_DIR/dist/index.js" ]]; then
            printf '  ! dynajs build did not produce dist/. Run manually: cd %s && npm install\n' "$DYNAJS_DIR" >&2
            exit 1
        fi
    fi
else
    printf '\n[3/10] dynajs sibling — SKIPPED (--with-dynajs to enable)\n'
    if [[ -f "$REPO_SRC/package.json" ]] && grep -q '"dynajs": "file:' "$REPO_SRC/package.json" 2>/dev/null; then
        if [[ ! -d "$DYNAJS_DIR/.git" ]]; then
            printf '  ! WARNING: package.json references dynajs at file:../dynajs but %s does not exist.\n' "$DYNAJS_DIR" >&2
            printf '  ! Re-run with --with-dynajs, or clone it manually before npm install.\n' >&2
        fi
    fi
fi

# -- 4. rohy npm install + build -----------------------------------------
if (( DO_BUILD )); then
    printf '\n[4/10] rohy npm install + build\n'
    if [[ ! -f "$REPO_SRC/package.json" ]]; then
        printf '  ! no package.json at %s — bootstrap must run from inside the rohy repo\n' "$REPO_SRC" >&2
        exit 1
    fi
    # `npm install` triggers our postinstall hook which calls
    # OyonR/scripts/download-models.sh — fetches the ~93 MB MediaPipe +
    # ONNX vendor bundles + emotion models that are gitignored. Hook is
    # tolerant; the explicit re-run below makes failure loud so a
    # broken Oyon doesn't ship silently to a production install.
    run sudo -u "$ROHY_USER" bash -c "cd '$REPO_SRC' && npm install --prefer-offline --no-audit --no-fund"
    if [[ -x "$REPO_SRC/OyonR/scripts/download-models.sh" ]]; then
        if ! run sudo -u "$ROHY_USER" bash -c "cd '$REPO_SRC' && bash OyonR/scripts/download-models.sh"; then
            printf '  ! Oyon model download FAILED — face / emotion capture will not work.\n' >&2
            printf '  ! Re-run later as %s:  bash %s/OyonR/scripts/download-models.sh\n' "$ROHY_USER" "$REPO_SRC" >&2
            printf '  ! Common causes: no curl on PATH, no internet, upstream URL gone.\n' >&2
        fi
    fi
    run sudo -u "$ROHY_USER" bash -c "cd '$REPO_SRC' && npm run build"
else
    printf '\n[4/10] rohy npm install + build — SKIPPED (--skip-build)\n'
fi

# -- 5. Piper venv --------------------------------------------------------
if (( DO_PIPER )); then
    printf '\n[5/10] Piper venv\n'
    PIPER_INSTALLER="$REPO_SRC/server/scripts/install-piper.sh"
    if [[ -x "$PIPER_INSTALLER" ]]; then
        # Piper failure used to be silent (`|| true`). Now it's loud:
        # warn but continue, so the bootstrap finishes and TTS can fall
        # back to Kokoro/Google/OpenAI — the operator just needs to know.
        if ! run sudo -u "$ROHY_USER" bash "$PIPER_INSTALLER"; then
            printf '  ! Piper install FAILED. TTS via Piper will not work.\n' >&2
            printf '  ! Other providers (Kokoro/Google/OpenAI) still work — admin can switch in Settings.\n' >&2
            printf '  ! To retry: bash %s\n' "$PIPER_INSTALLER" >&2
        fi
    else
        printf '  ! install-piper.sh not found at %s — skipping (install manually later)\n' "$PIPER_INSTALLER"
    fi
else
    printf '\n[5/10] Piper venv — SKIPPED (--no-piper)\n'
fi

# -- 6. Kokoro pre-warm ---------------------------------------------------
if (( DO_PREWARM )); then
    printf '\n[6/10] Kokoro model pre-warm (~330 MB into %s)\n' "$ROHY_HF_CACHE"
    if [[ ! -f "$REPO_SRC/server/services/kokoroTts.js" ]]; then
        printf '  ! kokoroTts.js not found — skipping pre-warm\n'
    else
        if (( DRY_RUN )); then
            printf '  [dry-run] would run loadKokoro() with TRANSFORMERS_CACHE=%s\n' "$ROHY_HF_CACHE"
        else
            # Run as the rohy user so cache files end up owned correctly.
            sudo -u "$ROHY_USER" \
                env TRANSFORMERS_CACHE="$ROHY_HF_CACHE" NODE_ENV=production \
                bash -c "cd '$REPO_SRC' && node --input-type=module -e \"
                    import('./server/services/kokoroTts.js').then(async (m) => {
                        try { await m.loadKokoro(); console.log('  ✓ Kokoro cached'); process.exit(0); }
                        catch (e) { console.error('  ! pre-warm failed:', e.message); process.exit(0); }
                    });
                \"" || printf '  ! pre-warm exited non-zero (non-fatal — first request retries)\n'
        fi
    fi
else
    printf '\n[6/10] Kokoro pre-warm — SKIPPED (--prewarm-kokoro to enable)\n'
fi

# -- 7. env file ----------------------------------------------------------
printf '\n[7/10] env file\n'
if [[ -f "$ROHY_ENV_FILE" ]]; then
    printf '  existing env file at %s — leaving alone\n' "$ROHY_ENV_FILE"
    if [[ -n "$ARG_FRONTEND_URL" ]]; then
        printf '  ! NOT overwriting FRONTEND_URL in existing env (delete the file if you want a fresh write)\n'
    fi
else
    if [[ ! -f "$REPO_SRC/deploy/env.example" ]]; then
        printf '  ! deploy/env.example not found at %s\n' "$REPO_SRC/deploy/env.example" >&2
        exit 1
    fi
    JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    if [[ -n "$ARG_FRONTEND_URL" ]]; then
        FRONTEND_LINE="FRONTEND_URL=${ARG_FRONTEND_URL}"
    else
        FRONTEND_LINE="# FRONTEND_URL not set yet — edit me before first start (or re-run with --frontend-url=)"
    fi
    if (( DRY_RUN )); then
        printf '  [dry-run] would write %s with a fresh JWT_SECRET, FRONTEND_URL=%s\n' \
            "$ROHY_ENV_FILE" "${ARG_FRONTEND_URL:-<unset>}"
    else
        sed \
            -e "s|REPLACE_ME_WITH_A_LONG_RANDOM_STRING|${JWT}|" \
            -e "s|^FRONTEND_URL=.*|${FRONTEND_LINE}|" \
            -e "s|^ROHY_DB=.*|ROHY_DB=${ROHY_DATA_DIR}/database.sqlite|" \
            -e "s|^TRANSFORMERS_CACHE=.*|TRANSFORMERS_CACHE=${ROHY_HF_CACHE}|" \
            -e "s|^PORT=.*|PORT=${ROHY_PORT}|" \
            "$REPO_SRC/deploy/env.example" > "$ROHY_ENV_FILE"
        if (( DO_ADMIN_BOOTSTRAP )); then
            {
                echo
                echo "# --- Bootstrap-only — REMOVE after first login + password change ---"
                echo "ALLOW_DEFAULT_USERS=1"
            } >> "$ROHY_ENV_FILE"
        fi
        chmod 600 "$ROHY_ENV_FILE"
        chown root:root "$ROHY_ENV_FILE"
        printf '  wrote %s (0600 root:root) with a fresh JWT_SECRET\n' "$ROHY_ENV_FILE"
        if [[ -n "$ARG_FRONTEND_URL" ]]; then
            printf '  FRONTEND_URL set to %s\n' "$ARG_FRONTEND_URL"
        else
            printf '  EDIT NOW: set FRONTEND_URL=https://your-host/rohy and restart rohy\n'
        fi
        if (( DO_ADMIN_BOOTSTRAP )); then
            printf '  ALLOW_DEFAULT_USERS=1 added — log in as admin/admin123, change password, REMOVE the line\n'
        fi
    fi
fi

# -- 8. systemd unit ------------------------------------------------------
printf '\n[8/10] systemd unit\n'
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

# -- 9. reverse proxy vhost -----------------------------------------------
case "$DO_PROXY" in
    nginx)
        printf '\n[9/10] nginx vhost\n'
        NG_SRC="$REPO_SRC/deploy/nginx/rohy.conf.example"
        NG_DST=/etc/nginx/conf.d/rohy.conf
        if [[ -f "$NG_DST" ]]; then
            printf '  existing %s — leaving alone (review %s for upstream changes)\n' "$NG_DST" "$NG_SRC"
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
        ;;
    caddy)
        printf '\n[9/10] Caddy vhost\n'
        CADDY_SRC="$REPO_SRC/deploy/docker/Caddyfile"
        CADDY_DST=/etc/caddy/Caddyfile
        if [[ ! -f "$CADDY_SRC" ]]; then
            printf '  ! %s not found — skipping Caddy install\n' "$CADDY_SRC"
        elif [[ -f "$CADDY_DST" ]] && grep -q 'rohy:4000' "$CADDY_DST" 2>/dev/null; then
            printf '  existing %s already configured for rohy — leaving alone\n' "$CADDY_DST"
        else
            if (( DRY_RUN )); then
                printf '  [dry-run] would install Caddyfile to %s\n' "$CADDY_DST"
            else
                # The shipped Caddyfile is for the Docker compose path
                # (upstream "rohy:4000" via service name). For native
                # Caddy on a single host, point at 127.0.0.1:PORT.
                sed -e "s|rohy:4000|127.0.0.1:${ROHY_PORT}|g" "$CADDY_SRC" > "$CADDY_DST"
                printf '  wrote %s — EDIT hostname/TLS mode at top, then `systemctl reload caddy`\n' "$CADDY_DST"
            fi
        fi
        ;;
    none)
        printf '\n[9/10] reverse proxy — SKIPPED (--reverse-proxy=none)\n'
        printf '  rohy will listen directly on :%s — set TLS_CERT_PATH/TLS_KEY_PATH if you want HTTPS.\n' "$ROHY_PORT"
        ;;
esac

# -- 10. enable + start ---------------------------------------------------
printf '\n[10/10] enable + start systemd unit\n'
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

EOF

step=1
if [[ -z "$ARG_FRONTEND_URL" ]] && ! grep -q '^FRONTEND_URL=https\?://' "$ROHY_ENV_FILE" 2>/dev/null; then
    printf '  %d. Edit %s — set FRONTEND_URL to your deploy URL, then:\n' "$step" "$ROHY_ENV_FILE"
    printf '       sudo systemctl restart rohy\n\n'
    step=$((step+1))
fi

if (( DO_ADMIN_BOOTSTRAP )); then
    printf '  %d. Open the deploy URL, log in as admin / admin123, change the password.\n' "$step"
    printf '       Then REMOVE the ALLOW_DEFAULT_USERS=1 line in %s\n' "$ROHY_ENV_FILE"
    printf '       and  sudo systemctl restart rohy .\n\n'
    step=$((step+1))
fi

case "$DO_PROXY" in
    nginx)
        printf '  %d. Edit /etc/nginx/conf.d/rohy.conf — set server_name + cert paths, then:\n' "$step"
        printf '       sudo nginx -t && sudo systemctl reload nginx\n\n'
        step=$((step+1))
        ;;
    caddy)
        printf '  %d. Edit %s — set hostname + TLS mode, then:\n' "$step" "/etc/caddy/Caddyfile"
        printf '       sudo systemctl enable --now caddy\n\n'
        step=$((step+1))
        ;;
esac

cat <<EOF
  $step. Verify config:    ${REPO_SRC}/deploy/preflight.sh
  $((step+1)). Verify deploy:    ${REPO_SRC}/scripts/smoke.sh "\$ROHY_DEPLOY_URL"
  $((step+2)). Watch logs:       sudo journalctl -u rohy.service -f

EOF
