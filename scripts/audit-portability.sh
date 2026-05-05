#!/usr/bin/env bash
# Inventory audit for Stage E8 database portability infrastructure.
#
# Run from the repo root:
#   bash scripts/audit-portability.sh
#
# Bash 3.2 compatible. This script reports SQLite-specific counts but does not
# fail on non-zero inventory findings; E8 is inventory + infrastructure only.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-portability-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  PASS %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  FAIL %s\n" "$1"; }
section() { printf "\n%s\n" "$1"; }

count_rg() {
    # Stage-E8 fix: ripgrep not always installed on the orchestrator's
    # machine; fall back to POSIX `grep -rE` so the audit can run on a
    # vanilla bash 3.2 environment.
    pattern="$1"
    shift
    set +e
    grep -rEni "$pattern" "$@" > "$OUT/rg-count.txt" 2>/dev/null
    status=$?
    set -e
    # grep returns 1 when no matches found — treat as 0 lines, not an error.
    if [ "$status" -gt 1 ]; then
        cat "$OUT/rg-count.txt"
        return "$status"
    fi
    wc -l < "$OUT/rg-count.txt" | tr -d ' '
}

assert_export() {
    name="$1"
    if grep -qE "export (async )?function ${name}\\b|${name}," "$ROOT/server/dbAdapter.js"; then
        pass "dbAdapter exports $name"
    else
        fail "dbAdapter missing export $name"
    fi
}

section "SQLite portability inventory counts"
SQL_SCOPE="$ROOT/server $ROOT/migrations $ROOT/scripts"
printf "  INSERT OR REPLACE: %s\n" "$(count_rg "INSERT[[:space:]]+OR[[:space:]]+REPLACE" $SQL_SCOPE)"
printf "  INSERT OR IGNORE: %s\n" "$(count_rg "INSERT[[:space:]]+OR[[:space:]]+IGNORE" $SQL_SCOPE)"
printf "  datetime('now'): %s\n" "$(count_rg "datetime[[:space:]]*\\([[:space:]]*'now'" $SQL_SCOPE)"
printf "  julianday(): %s\n" "$(count_rg "julianday[[:space:]]*\\(" $SQL_SCOPE)"
printf "  strftime(): %s\n" "$(count_rg "strftime[[:space:]]*\\(" $SQL_SCOPE)"
printf "  AUTOINCREMENT: %s\n" "$(count_rg "\\bAUTOINCREMENT\\b" "$ROOT/migrations" "$ROOT/server/db.js")"
printf "  suspicious LIKE: %s\n" "$(count_rg "\\bLIKE\\b" "$ROOT/server" "$ROOT/migrations")"
printf "  numeric || concat: %s\n" "$(count_rg "\\|\\|" "$ROOT/server" "$ROOT/migrations" "$ROOT/scripts")"
printf "  json_extract shorthand: %s\n" "$(count_rg "json_extract[[:space:]]*\\([^)]*,[[:space:]]*'\\$\\." "$ROOT/server" "$ROOT/migrations" "$ROOT/scripts")"
printf "  PRAGMA table_info: %s\n" "$(count_rg "PRAGMA[[:space:]]+table_info" "$ROOT/server" "$ROOT/migrations" "$ROOT/scripts")"
printf "  PRAGMA foreign_keys: %s\n" "$(count_rg "PRAGMA[[:space:]]+foreign_keys" "$ROOT/server" "$ROOT/migrations" "$ROOT/scripts")"
printf "  rebuild/copy ALTER: %s\n" "$(count_rg "RENAME[[:space:]]+TO|DROP[[:space:]]+TABLE|INSERT[[:space:]]+INTO[[:space:]].*SELECT" "$ROOT/migrations")"
printf "  BOOLEAN columns: %s\n" "$(count_rg "\\bBOOLEAN\\b" "$ROOT/migrations" "$ROOT/server/db.js")"
printf "  DATETIME columns: %s\n" "$(count_rg "\\bDATETIME\\b" "$ROOT/migrations" "$ROOT/server/db.js")"
pass "reported portability inventory counts"

section "Adapter surface"
if [ -f "$ROOT/server/dbAdapter.js" ]; then
    pass "server/dbAdapter.js exists"
else
    fail "server/dbAdapter.js missing"
fi

for symbol in get all run serialize transaction prepare now upsert; do
    assert_export "$symbol"
done

section "No new bare db.run call sites"
DB_RUN_PATTERN="[[:space:]]db[.]run[[:space:]]*\\("
BARE_RUNS=$(count_rg "$DB_RUN_PATTERN" "$ROOT/server/dbAdapter.js")
if [ "$BARE_RUNS" = "1" ]; then
    pass "dbAdapter uses bare db.run only inside the run wrapper"
else
    fail "dbAdapter has unexpected bare db.run count: $BARE_RUNS"
fi
NEW_SCRIPT_RUNS=$(count_rg "$DB_RUN_PATTERN" "$ROOT/scripts/audit-portability.sh")
if [ "$NEW_SCRIPT_RUNS" = "0" ]; then
    pass "audit-portability.sh adds no db.run call sites"
else
    fail "audit-portability.sh contains db.run call sites"
fi

section "Adapter smoke"
SMOKE_DB="$OUT/adapter-smoke.sqlite"
if ROHY_DB="$SMOKE_DB" node --input-type=module - "$ROOT" > "$OUT/adapter-smoke.txt" 2>&1 <<'NODEEOF'
const root = process.argv[2];
const adapter = await import(`${root}/server/dbAdapter.js`);
const dbModule = await import(`${root}/server/db.js`);
await dbModule.dbReady;
const row = await adapter.get('SELECT 42 AS answer');
if (!row || row.answer !== 42) {
  throw new Error(`unexpected adapter row ${JSON.stringify(row)}`);
}
const result = await adapter.run('CREATE TABLE IF NOT EXISTS adapter_smoke (id INTEGER PRIMARY KEY, name TEXT)');
if (!result || typeof result !== 'object' || !('changes' in result)) {
  throw new Error('adapter.run did not return sqlite run metadata');
}
console.log('adapter smoke ok');
NODEEOF
then
    pass "adapter get/run return Promise-shaped results"
else
    fail "adapter smoke failed: $(cat "$OUT/adapter-smoke.txt")"
fi

section "Dependency guard"
if node --input-type=module - "$ROOT/package.json" <<'NODEEOF'
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if ((pkg.dependencies && pkg.dependencies.pg) || (pkg.devDependencies && pkg.devDependencies.pg)) {
  process.exit(1);
}
NODEEOF
then
    pass "package.json has no pg dependency"
else
    fail "package.json includes pg dependency"
fi

section "Summary"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
fi

printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
printf "Failures:%s\n" "$FAILURES"
exit 1
