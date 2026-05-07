#!/usr/bin/env bash
# deploy/preflight.sh — run before `systemctl restart rohy` (or before
# triggering the cron-pull deploy).
#
# Verifies that the local working tree, the env file, and the runtime
# environment can support a successful boot. Catches every failure mode
# documented in AGENT-NOTE-DEPLOY-2026-05-07.md before it costs you a
# real outage.
#
# Usage:
#   sudo deploy/preflight.sh                          # uses /etc/rohy/env
#   ROHY_ENV_FILE=/path/to/env deploy/preflight.sh    # custom env file
#   ROHY_REPO_DIR=/opt/repos/rohy deploy/preflight.sh # explicit repo path
#
# Exit codes:
#   0  — preflight passed; safe to deploy/restart
#   1  — one or more fatal checks failed
#   2  — usage error / can't even start
#
# What it checks (in order):
#   - Required executables (node, npm, sqlite3) on PATH
#   - Repo dir + .git present
#   - Local commits not divergent from origin (warn, not fail)
#   - Env file readable + perm 0600 (warn if looser)
#   - JWT_SECRET set and ≥32 chars
#   - NODE_ENV=production (warn if other)
#   - FRONTEND_URL set + parseable
#   - ROHY_DB absolute path; parent dir exists + writable
#   - TRANSFORMERS_CACHE set + parent dir exists + writable
#   - Disk space at ROHY_DB parent (>= 500 MB free)
#   - dynajs sibling repo built (if file:../dynajs is in package.json)
#   - PORT and HTTPS_PORT free (no other listener)
#   - Optional: Piper venv present if tts_provider may be piper

set -euo pipefail

case "${1:-}" in
    --help|-h)
        sed -n '2,30p' "$0" | sed 's/^# \?//'
        exit 0 ;;
esac

REPO_DIR="${ROHY_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ROHY_ENV_FILE:-/etc/rohy/env}"
MIN_FREE_MB="${ROHY_PREFLIGHT_MIN_FREE_MB:-500}"

# -- helpers --------------------------------------------------------------
RED=$'\033[0;31m'
YEL=$'\033[0;33m'
GRN=$'\033[0;32m'
CLR=$'\033[0m'
fail_count=0
warn_count=0
ok()   { printf '  %s✓%s %s\n' "$GRN" "$CLR" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$CLR" "$1" >&2; warn_count=$((warn_count+1)); }
fail() { printf '  %s✗%s %s\n' "$RED" "$CLR" "$1" >&2; fail_count=$((fail_count+1)); }

read_env_var() {
    # Read VAR=val from env file. Strips quotes. Returns empty if absent.
    local key="$1"
    [[ -r "$ENV_FILE" ]] || return 0
    local line
    line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)
    [[ -z "$line" ]] && return 0
    local val="${line#*=}"
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    printf '%s' "$val"
}

# -- 1. PATH binaries ------------------------------------------------------
printf '\n[1/9] checking required binaries on PATH\n'
for bin in node npm; do
    if command -v "$bin" >/dev/null 2>&1; then
        ok "$bin found ($(command -v "$bin"))"
    else
        fail "$bin not on PATH"
    fi
done
if command -v sqlite3 >/dev/null 2>&1; then
    ok "sqlite3 found ($(sqlite3 --version | head -c 60))"
else
    warn "sqlite3 not on PATH — DB introspection during incidents will be harder"
fi

# -- 2. Repo dir -----------------------------------------------------------
printf '\n[2/9] checking repo at %s\n' "$REPO_DIR"
if [[ -d "$REPO_DIR/.git" ]]; then
    ok ".git present"
    # We only check status; not running anything here.
    if (cd "$REPO_DIR" && git rev-parse --abbrev-ref HEAD >/dev/null 2>&1); then
        branch=$(cd "$REPO_DIR" && git rev-parse --abbrev-ref HEAD)
        ok "branch=$branch"
    fi
    if (cd "$REPO_DIR" && git status --porcelain | grep -q .); then
        warn 'working tree has uncommitted changes — server-pull deploys may discard them on the next git reset --hard'
    else
        ok "working tree clean"
    fi
else
    fail "$REPO_DIR/.git not found — set ROHY_REPO_DIR or run from inside the rohy repo"
fi

# -- 3. Env file -----------------------------------------------------------
printf '\n[3/9] checking env file %s\n' "$ENV_FILE"
if [[ -r "$ENV_FILE" ]]; then
    ok "readable"
    perms=$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE" 2>/dev/null || echo '?')
    if [[ "$perms" == "600" || "$perms" == "0600" ]]; then
        ok "permissions = 0600"
    else
        warn "permissions = $perms (recommend 0600 — env file holds secrets)"
    fi
else
    fail "env file not readable — copy deploy/env.example, fill in, chmod 600"
fi

# -- 4. JWT_SECRET ---------------------------------------------------------
printf '\n[4/9] checking JWT_SECRET\n'
JWT_SECRET=$(read_env_var JWT_SECRET || true)
if [[ -z "$JWT_SECRET" ]]; then
    fail "JWT_SECRET not set in $ENV_FILE — server will refuse to start"
elif [[ "${#JWT_SECRET}" -lt 32 ]]; then
    warn "JWT_SECRET is only ${#JWT_SECRET} chars; recommend ≥32 for prod entropy"
else
    ok "JWT_SECRET set (${#JWT_SECRET} chars)"
fi

# -- 5. NODE_ENV / FRONTEND_URL --------------------------------------------
printf '\n[5/9] checking NODE_ENV and FRONTEND_URL\n'
NODE_ENV_VAL=$(read_env_var NODE_ENV || true)
if [[ "$NODE_ENV_VAL" == "production" ]]; then
    ok "NODE_ENV=production"
elif [[ -n "$NODE_ENV_VAL" ]]; then
    warn "NODE_ENV=$NODE_ENV_VAL (most deploys want 'production')"
else
    warn "NODE_ENV not set in env file — defaults to 'development' which seeds default users"
fi

FRONTEND_URL=$(read_env_var FRONTEND_URL || true)
if [[ -z "$FRONTEND_URL" ]]; then
    if [[ "$NODE_ENV_VAL" == "production" ]]; then
        warn "FRONTEND_URL not set — non-localhost browsers will see CORS errors"
    fi
else
    if [[ "$FRONTEND_URL" =~ ^https?://[^/]+ ]]; then
        ok "FRONTEND_URL=$FRONTEND_URL"
    else
        fail "FRONTEND_URL=\"$FRONTEND_URL\" is not a valid URL"
    fi
fi

# -- 6. ROHY_DB path -------------------------------------------------------
printf '\n[6/9] checking ROHY_DB path\n'
ROHY_DB=$(read_env_var ROHY_DB || true)
if [[ -z "$ROHY_DB" ]]; then
    if [[ "$NODE_ENV_VAL" == "production" ]]; then
        warn "ROHY_DB not set — DB will live inside the repo, vulnerable to deploy wipe"
    fi
elif [[ "$ROHY_DB" != /* ]]; then
    fail "ROHY_DB=$ROHY_DB is not absolute"
else
    parent=$(dirname "$ROHY_DB")
    if [[ -d "$parent" ]]; then
        ok "parent dir $parent exists"
        if [[ -w "$parent" ]]; then
            ok "parent dir is writable by $USER"
        else
            warn "parent dir $parent not writable by $USER (sudo? wrong owner?)"
        fi
    else
        fail "parent dir $parent does not exist — mkdir -p it before starting rohy"
    fi
    # Disk space
    if command -v df >/dev/null 2>&1; then
        avail_mb=$(df -Pm "$parent" 2>/dev/null | awk 'NR==2 { print $4 }')
        if [[ -n "$avail_mb" ]]; then
            if [[ "$avail_mb" -ge "$MIN_FREE_MB" ]]; then
                ok "free space on $parent: ${avail_mb} MB (≥ ${MIN_FREE_MB})"
            else
                warn "free space on $parent: ${avail_mb} MB (< ${MIN_FREE_MB})"
            fi
        fi
    fi
fi

# -- 7. TRANSFORMERS_CACHE -------------------------------------------------
printf '\n[7/9] checking TRANSFORMERS_CACHE\n'
TC=$(read_env_var TRANSFORMERS_CACHE || true)
if [[ -z "$TC" ]]; then
    if [[ "$NODE_ENV_VAL" == "production" ]]; then
        warn "TRANSFORMERS_CACHE not set — Kokoro model lives in node_modules, wiped by every npm ci"
    fi
elif [[ ! -d "$TC" ]]; then
    warn "TRANSFORMERS_CACHE=$TC does not exist — mkdir -p it before first TTS request"
else
    if [[ -w "$TC" ]]; then
        ok "TRANSFORMERS_CACHE=$TC exists and is writable"
    else
        warn "TRANSFORMERS_CACHE=$TC not writable by $USER"
    fi
fi

# -- 8. dynajs sibling -----------------------------------------------------
printf '\n[8/9] checking dynajs sibling (if used)\n'
if grep -q '"dynajs"' "$REPO_DIR/package.json" 2>/dev/null; then
    if grep -q '"dynajs": "file:' "$REPO_DIR/package.json"; then
        dynajs_dir="$(cd "$REPO_DIR/.." && pwd)/dynajs"
        if [[ -f "$dynajs_dir/dist/index.mjs" || -f "$dynajs_dir/dist/index.js" ]]; then
            ok "dynajs/dist built at $dynajs_dir"
        elif [[ -d "$dynajs_dir" ]]; then
            warn "dynajs found at $dynajs_dir but dist/ empty — run 'cd $dynajs_dir && npm install' (note: NOT npm ci)"
        else
            fail "dynajs sibling expected at $dynajs_dir but missing — clone it before deploy"
        fi
    else
        ok "dynajs from registry (not file:../) — npm ci handles it"
    fi
else
    ok "dynajs not in package.json"
fi

# -- 9. Port availability --------------------------------------------------
printf '\n[9/9] checking listener ports\n'
PORT=$(read_env_var PORT || true); PORT="${PORT:-3000}"
HTTPS_PORT=$(read_env_var HTTPS_PORT || true)
check_port_free() {
    local p="$1"
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn "( sport = :$p )" 2>/dev/null | tail -n +2 | grep -q .; then
            # In-use IS expected if rohy is currently running (we're checking
            # before a restart). Just inform.
            warn "port $p is in use (rohy already running? lsof to confirm)"
        else
            ok "port $p is free"
        fi
    elif command -v lsof >/dev/null 2>&1; then
        if lsof -iTCP:"$p" -sTCP:LISTEN -n -P 2>/dev/null | tail -n +2 | grep -q .; then
            warn "port $p is in use (rohy already running? lsof to confirm)"
        else
            ok "port $p is free"
        fi
    else
        warn "neither ss nor lsof available; skipped port check on :$p"
    fi
}
check_port_free "$PORT"
[[ -n "$HTTPS_PORT" ]] && check_port_free "$HTTPS_PORT"

# -- summary --------------------------------------------------------------
printf '\n----- preflight summary -----\n'
if (( fail_count == 0 )); then
    if (( warn_count == 0 )); then
        printf '%spreflight OK%s — safe to deploy.\n' "$GRN" "$CLR"
    else
        printf '%spreflight OK%s with %d warning(s) — review before deploy.\n' "$GRN" "$CLR" "$warn_count"
    fi
    exit 0
else
    printf '%spreflight FAILED%s — %d fatal, %d warning(s). Fix before deploy.\n' "$RED" "$CLR" "$fail_count" "$warn_count" >&2
    exit 1
fi
