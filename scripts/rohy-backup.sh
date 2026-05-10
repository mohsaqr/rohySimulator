#!/usr/bin/env bash
#
# scripts/rohy-backup.sh — take a consistent snapshot of the rohy DB +
# environment + version metadata. Operator-runnable any time. Used internally
# by `bin/rohy-update apply` before mutating anything; can also be invoked
# manually before risky actions ("I'm about to import 10k labs, snapshot first").
#
# Usage:
#   sudo scripts/rohy-backup.sh                        # use defaults
#   sudo scripts/rohy-backup.sh --label pre-import     # human-readable tag
#   sudo scripts/rohy-backup.sh --dry-run              # show what it would do
#   sudo scripts/rohy-backup.sh --check                # integrity-check the
#                                                       # latest snapshot, no new one
#   ROHY_BACKUP_DIR=/mnt/external/rohy-backups \
#     sudo scripts/rohy-backup.sh                      # custom destination
#
# Exit codes:
#   0   snapshot taken (or dry-run/check completed) successfully
#   1   snapshot or integrity check failed
#   2   usage error / missing prereq
#
# What gets snapshotted (one timestamped subdirectory per backup):
#   - database.sqlite          consistent copy via SQLite VACUUM INTO
#   - env                       copy of /etc/rohy/env (or whichever file is in use)
#   - manifest.json             metadata: timestamp, git sha, label, sizes,
#                               integrity status, schema_migrations row count
#   - migrations.lst            output of `SELECT name FROM schema_migrations`
#                               (sanity reference for restore-time decisions)
#
# Retention (applied at the end of each successful run):
#   - Keep the last $ROHY_BACKUP_KEEP_LAST snapshots (default 10).
#   - Keep one snapshot per month for $ROHY_BACKUP_KEEP_MONTHS months (default 12).
#   - Anything older or beyond the limits is removed. NEVER deletes a snapshot
#     created within the last 24 hours (paranoia gate against runaway pruning).

set -euo pipefail

# ── defaults ────────────────────────────────────────────────────────────────
ROHY_DB="${ROHY_DB:-/opt/data/rohy/database.sqlite}"
ROHY_ENV_FILE="${ROHY_ENV_FILE:-/etc/rohy/env}"
ROHY_BACKUP_DIR="${ROHY_BACKUP_DIR:-/var/backups/rohy}"
ROHY_BACKUP_KEEP_LAST="${ROHY_BACKUP_KEEP_LAST:-10}"
ROHY_BACKUP_KEEP_MONTHS="${ROHY_BACKUP_KEEP_MONTHS:-12}"
REPO_DIR="${REPO_DIR:-/opt/repos/rohy}"

LABEL=""
DRY_RUN=0
CHECK_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# ── helpers ─────────────────────────────────────────────────────────────────
die() { printf 'rohy-backup: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }
step() { printf '\n→ %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

# ── pre-flight ──────────────────────────────────────────────────────────────
require_cmd sqlite3
[[ -f "$ROHY_DB" ]] || die "DB not found: $ROHY_DB (set ROHY_DB if non-default)"

# ── --check mode: integrity-check the latest snapshot, no new write ─────────
if (( CHECK_ONLY )); then
  step "checking latest snapshot in $ROHY_BACKUP_DIR"
  latest=$(ls -1dt "$ROHY_BACKUP_DIR"/*/ 2>/dev/null | head -1 | sed 's:/$::')
  [[ -n "$latest" ]] || die "no snapshots found"
  note "latest: $latest"
  if [[ ! -f "$latest/database.sqlite" ]]; then
    die "snapshot has no database.sqlite — corrupt or aborted backup"
  fi
  result=$(sqlite3 "$latest/database.sqlite" 'PRAGMA integrity_check;' 2>&1)
  if [[ "$result" == "ok" ]]; then
    note "✓ integrity_check: ok"
    exit 0
  else
    note "✗ integrity_check failed:"
    printf '%s\n' "$result" | sed 's/^/    /'
    exit 1
  fi
fi

# ── normal mode: take a fresh snapshot ──────────────────────────────────────
TS=$(date -u '+%Y%m%dT%H%M%SZ')
GIT_SHA="unknown"
if [[ -d "$REPO_DIR/.git" ]]; then
  GIT_SHA=$(git -C "$REPO_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
fi

SUBDIR="$ROHY_BACKUP_DIR/$TS-$GIT_SHA"
[[ -n "$LABEL" ]] && SUBDIR="$SUBDIR-$LABEL"

step "snapshot target: $SUBDIR"

if (( DRY_RUN )); then
  note "[dry-run] would mkdir -p $SUBDIR"
  note "[dry-run] would .backup $ROHY_DB → $SUBDIR/database.sqlite"
  note "[dry-run] would copy $ROHY_ENV_FILE → $SUBDIR/env (if present)"
  note "[dry-run] would write manifest.json + migrations.lst"
  note "[dry-run] would integrity-check"
  note "[dry-run] would prune older snapshots per retention policy"
  exit 0
fi

mkdir -p "$SUBDIR"

# SQLite online backup. VACUUM INTO produces a defragmented consistent copy
# without holding a write lock — safe to run while rohy is serving requests.
step "running VACUUM INTO (consistent online snapshot)"
sqlite3 "$ROHY_DB" "VACUUM INTO '$SUBDIR/database.sqlite'"
DB_BYTES=$(stat -c%s "$SUBDIR/database.sqlite" 2>/dev/null \
        || stat -f%z "$SUBDIR/database.sqlite")
note "wrote database.sqlite ($DB_BYTES bytes)"

# Snapshot the env file (contains JWT_SECRET, FRONTEND_URL, OYON_ENABLED,
# etc.). If a future release changes env semantics, the snapshot lets us
# re-pair the DB with its contemporary env on restore.
if [[ -f "$ROHY_ENV_FILE" ]]; then
  cp -p "$ROHY_ENV_FILE" "$SUBDIR/env"
  chmod 600 "$SUBDIR/env"
  note "copied env file (mode 0600)"
else
  note "! env file $ROHY_ENV_FILE not found — skipping (manual snapshots from a non-systemd install are normal)"
fi

# Migration list — useful for the operator restoring later: 'this snapshot
# was taken when migrations 1-18 were applied; my current install is at 23.'
MIG_COUNT=0
if MIG_LIST=$(sqlite3 "$SUBDIR/database.sqlite" "SELECT name FROM schema_migrations ORDER BY name" 2>/dev/null); then
  printf '%s\n' "$MIG_LIST" > "$SUBDIR/migrations.lst"
  MIG_COUNT=$(printf '%s\n' "$MIG_LIST" | grep -c . || true)
  note "migrations recorded: $MIG_COUNT"
else
  note "! schema_migrations table not present — older DB format?"
fi

# Integrity check on the snapshot itself (not the source DB). Catches a bad
# snapshot before the operator believes they have a safety net.
step "integrity_check on snapshot"
RESULT=$(sqlite3 "$SUBDIR/database.sqlite" 'PRAGMA integrity_check;' 2>&1)
if [[ "$RESULT" != "ok" ]]; then
  printf '%s\n' "$RESULT" | sed 's/^/    /' >&2
  rm -rf "$SUBDIR"
  die "snapshot failed integrity_check — refusing to keep it"
fi
note "✓ ok"

# Manifest. Single source of truth for what this snapshot represents. Read by
# `bin/rohy-update list-backups` and `restore-backup`.
HOSTNAME=$(hostname 2>/dev/null || echo unknown)
cat > "$SUBDIR/manifest.json" <<EOF
{
  "schema_version": 1,
  "created_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "label": "${LABEL}",
  "git_sha": "${GIT_SHA}",
  "hostname": "${HOSTNAME}",
  "source_db": "${ROHY_DB}",
  "source_env": "${ROHY_ENV_FILE}",
  "db_bytes": ${DB_BYTES},
  "migrations_applied": ${MIG_COUNT},
  "integrity": "ok"
}
EOF
note "wrote manifest.json"

# ── retention ───────────────────────────────────────────────────────────────
step "retention sweep"
# Strategy:
#   1. Always keep snapshots created in the last 24h (paranoia gate).
#   2. Among older snapshots: keep the latest N (default 10).
#   3. Plus: keep one per calendar month going back M months (default 12).
#   4. Anything else: remove.
mapfile -t ALL_SNAPS < <(ls -1dt "$ROHY_BACKUP_DIR"/*/ 2>/dev/null | sed 's:/$::')
KEEP=()
NOW=$(date +%s)
DAY=86400

# Pass 1: protect last 24h + keep top N by mtime
i=0
for s in "${ALL_SNAPS[@]}"; do
  age=$(( NOW - $(stat -c%Y "$s" 2>/dev/null || stat -f%m "$s") ))
  if (( age < DAY )); then KEEP+=("$s"); continue; fi
  if (( i < ROHY_BACKUP_KEEP_LAST )); then KEEP+=("$s"); fi
  i=$((i+1))
done

# Pass 2: ensure one per month going back ROHY_BACKUP_KEEP_MONTHS
declare -A SEEN_MONTH
for s in "${ALL_SNAPS[@]}"; do
  month=$(date -u -r "$(stat -c%Y "$s" 2>/dev/null || stat -f%m "$s")" '+%Y-%m' 2>/dev/null \
        || date -u -d "@$(stat -c%Y "$s")" '+%Y-%m')
  if [[ -z "${SEEN_MONTH[$month]:-}" ]]; then
    SEEN_MONTH[$month]="$s"
    KEEP+=("$s")
  fi
done

# Build keep set, prune the rest
declare -A KEEP_SET
for k in "${KEEP[@]}"; do KEEP_SET["$k"]=1; done

PRUNED=0
for s in "${ALL_SNAPS[@]}"; do
  if [[ -z "${KEEP_SET[$s]:-}" ]]; then
    note "pruning $s"
    rm -rf "$s"
    PRUNED=$((PRUNED+1))
  fi
done
note "kept ${#KEEP_SET[@]} snapshots, pruned $PRUNED"

step "done"
printf '\nSnapshot:    %s\n'   "$SUBDIR"
printf 'Manifest:    %s/manifest.json\n' "$SUBDIR"
printf 'Restore via: bin/rohy-update restore-backup %s\n\n' "$(basename "$SUBDIR")"
