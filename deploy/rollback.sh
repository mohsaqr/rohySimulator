#!/usr/bin/env bash
# deploy/rollback.sh — roll a server-side rohy install back to a previous
# commit (and optionally a previous DB snapshot).
#
# Run on the SERVER, not on your laptop. The script assumes:
#   - rohy.service is the systemd unit
#   - the repo is at $ROHY_REPO_DIR (default /opt/repos/rohy)
#   - the DB is at $ROHY_DB (default /opt/data/rohy/database.sqlite)
#   - server/db.js's backup-before-migrate has produced
#     database.sqlite.bak.<timestamp>.<targetVersion> snapshots
#
# Usage:
#   sudo deploy/rollback.sh                          # interactive: shows recent commits + snapshots, asks
#   sudo deploy/rollback.sh --code <sha>             # check out <sha>, rebuild, restart
#   sudo deploy/rollback.sh --code <sha> --db <bak>  # also restore DB snapshot
#   sudo deploy/rollback.sh --list                   # just list candidates and exit
#   sudo deploy/rollback.sh --dry-run [args]         # print what would happen
#
# Exit codes:
#   0 — rollback finished, smoke probe passed
#   1 — rollback finished but smoke failed (rohy still running, manual triage needed)
#   2 — usage error / refused to proceed
#
# IMPORTANT: a DB rollback DESTROYS every write that landed after the
# snapshot. The script will refuse to proceed with --db unless you also
# pass --i-am-sure-this-loses-data.

set -euo pipefail

ROHY_REPO_DIR="${ROHY_REPO_DIR:-/opt/repos/rohy}"
ROHY_DB="${ROHY_DB:-/opt/data/rohy/database.sqlite}"
ROHY_UNIT="${ROHY_UNIT:-rohy.service}"

CODE_SHA=""
DB_BAK=""
LIST_ONLY=0
DRY_RUN=0
LOSES_DATA_ACK=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --code)        CODE_SHA="$2"; shift 2 ;;
        --db)          DB_BAK="$2"; shift 2 ;;
        --list)        LIST_ONLY=1; shift ;;
        --dry-run)     DRY_RUN=1; shift ;;
        --i-am-sure-this-loses-data) LOSES_DATA_ACK=1; shift ;;
        --help|-h)
            sed -n '2,30p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            printf 'unknown arg: %s (use --help)\n' "$1" >&2
            exit 2 ;;
    esac
done

run() {
    if (( DRY_RUN )); then
        printf '  [dry-run] %s\n' "$*"
    else
        printf '  $ %s\n' "$*"
        "$@"
    fi
}

require_repo() {
    [[ -d "$ROHY_REPO_DIR/.git" ]] || {
        printf 'rohy repo not found at %s — set ROHY_REPO_DIR\n' "$ROHY_REPO_DIR" >&2
        exit 2
    }
}
require_root() {
    [[ $EUID -eq 0 ]] || { printf 'rollback needs sudo (systemctl + writes to /opt/data)\n' >&2; exit 2; }
}

list_candidates() {
    printf '\nRecent commits in %s:\n' "$ROHY_REPO_DIR"
    (cd "$ROHY_REPO_DIR" && git log --oneline -10)
    printf '\nDB snapshots next to %s:\n' "$ROHY_DB"
    local parent; parent="$(dirname "$ROHY_DB")"
    if compgen -G "$parent/database.sqlite.bak.*" > /dev/null; then
        ls -lt "$parent"/database.sqlite.bak.* 2>/dev/null | head -10
    else
        printf '  (none — server/db.js has not yet snapshotted, or all are pruned)\n'
    fi
}

# -- main ----------------------------------------------------------------
require_repo

if (( LIST_ONLY )); then
    list_candidates
    exit 0
fi

if [[ -z "$CODE_SHA" && -z "$DB_BAK" ]]; then
    list_candidates
    printf '\nNo --code or --db given. Re-run with one or both.\n'
    exit 2
fi

require_root

# Refuse DB rollback without explicit ack.
if [[ -n "$DB_BAK" && $LOSES_DATA_ACK -eq 0 ]]; then
    printf 'DB rollback DESTROYS every write since %s.\n' "$DB_BAK" >&2
    printf 'Re-run with --i-am-sure-this-loses-data if you accept that.\n' >&2
    exit 2
fi

# Verify the SHA exists if specified.
if [[ -n "$CODE_SHA" ]]; then
    if ! (cd "$ROHY_REPO_DIR" && git rev-parse --verify "$CODE_SHA^{commit}" >/dev/null 2>&1); then
        printf 'commit %s not found in %s\n' "$CODE_SHA" "$ROHY_REPO_DIR" >&2
        exit 2
    fi
    sha_short=$(cd "$ROHY_REPO_DIR" && git rev-parse --short "$CODE_SHA")
    sha_subject=$(cd "$ROHY_REPO_DIR" && git log -1 --format=%s "$CODE_SHA")
    printf '\nWill check out:  %s  %s\n' "$sha_short" "$sha_subject"
fi

if [[ -n "$DB_BAK" ]]; then
    if [[ ! -f "$DB_BAK" ]]; then
        printf 'DB snapshot %s not found\n' "$DB_BAK" >&2
        exit 2
    fi
    printf 'Will restore DB:  %s -> %s\n' "$DB_BAK" "$ROHY_DB"
fi

# -- 1. Stop rohy --------------------------------------------------------
printf '\n[1/4] stopping %s\n' "$ROHY_UNIT"
run systemctl stop "$ROHY_UNIT"

# -- 2. Optional DB restore ---------------------------------------------
if [[ -n "$DB_BAK" ]]; then
    printf '\n[2/4] restoring DB snapshot\n'
    pre_bak="${ROHY_DB}.pre-rollback.$(date +%s)"
    run cp -a "$ROHY_DB" "$pre_bak"
    printf '  current DB saved to %s (in case you need it back)\n' "$pre_bak"
    run cp -a "$DB_BAK" "$ROHY_DB"
fi

# -- 3. Code rollback ---------------------------------------------------
if [[ -n "$CODE_SHA" ]]; then
    printf '\n[3/4] checking out %s and rebuilding\n' "$CODE_SHA"
    run sudo -u "$(stat -c %U "$ROHY_REPO_DIR" 2>/dev/null || stat -f %Su "$ROHY_REPO_DIR")" \
        bash -c "cd '$ROHY_REPO_DIR' && git fetch --all --quiet && git checkout '$CODE_SHA' && npm ci --prefer-offline --silent && npm run build"
fi

# -- 4. Restart + smoke -------------------------------------------------
printf '\n[4/4] restarting %s + smoke\n' "$ROHY_UNIT"
run systemctl start "$ROHY_UNIT"

if [[ -x "$ROHY_REPO_DIR/scripts/smoke.sh" ]]; then
    if [[ -n "${ROHY_DEPLOY_URL:-}" ]]; then
        if (( DRY_RUN )); then
            printf '  [dry-run] would smoke against %s\n' "$ROHY_DEPLOY_URL"
        else
            sleep 3
            if "$ROHY_REPO_DIR/scripts/smoke.sh" "$ROHY_DEPLOY_URL"; then
                printf '\nrollback OK — smoke passed.\n'
                exit 0
            else
                printf '\nrollback finished BUT smoke failed. systemctl status %s + journalctl.\n' "$ROHY_UNIT" >&2
                exit 1
            fi
        fi
    else
        printf '  ROHY_DEPLOY_URL not set — skipping smoke. Run scripts/smoke.sh manually.\n'
    fi
else
    printf '  scripts/smoke.sh not found — skipping smoke. systemctl status %s.\n' "$ROHY_UNIT"
fi

printf '\nrollback finished. Verify manually.\n'
exit 0
