#!/usr/bin/env bash
# End-to-end migration framework audit for Stage E2.
#
# Run from the repo root, with or without the API server running:
#   bash scripts/audit-migrations.sh
#
# Bash 3.2 compatible.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${ROHY_DB:-$ROOT/server/database.sqlite}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-migrations-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""
RUN_TAG="audit-$$-$(date +%s)"

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  \033[31m✗\033[0m %s\n" "$1"; }
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

db_scalar() {
    node --input-type=module - "$DB_PATH" "$1" "${@:2}" <<'NODEEOF'
import sqlite3 from 'sqlite3';
const [dbPath, sql, ...params] = process.argv.slice(2);
const db = new sqlite3.Database(dbPath);
db.get(sql, params, (err, row) => {
  if (err) {
    console.error(err.message);
    process.exit(2);
  }
  const value = row ? Object.values(row)[0] : '';
  console.log(value === null || value === undefined ? '' : value);
  db.close();
});
NODEEOF
}

db_insert() {
    node --input-type=module - "$DB_PATH" "$1" "${@:2}" <<'NODEEOF'
import sqlite3 from 'sqlite3';
const [dbPath, sql, ...params] = process.argv.slice(2);
const db = new sqlite3.Database(dbPath);
db.exec('PRAGMA foreign_keys = ON', (pragmaErr) => {
  if (pragmaErr) {
    console.error(pragmaErr.message);
    process.exit(2);
  }
  db.run(sql, params, function(err) {
    if (err) {
      console.error(err.message);
      process.exit(2);
    }
    console.log(this.lastID || this.changes || 0);
    db.close();
  });
});
NODEEOF
}

db_exec() {
    node --input-type=module - "$DB_PATH" "$1" "${@:2}" <<'NODEEOF'
import sqlite3 from 'sqlite3';
const [dbPath, sql, ...params] = process.argv.slice(2);
const db = new sqlite3.Database(dbPath);
db.exec('PRAGMA foreign_keys = ON', (pragmaErr) => {
  if (pragmaErr) {
    console.error(pragmaErr.message);
    process.exit(2);
  }
  db.run(sql, params, function(err) {
    if (err) {
      console.error(err.message);
      process.exit(2);
    }
    console.log(this.changes || 0);
    db.close();
  });
});
NODEEOF
}

section "schema_migrations exists"
TABLE_EXISTS=$(db_scalar "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
MIGRATION_COUNT=$(db_scalar "SELECT COUNT(*) FROM schema_migrations")
if [ "$TABLE_EXISTS" = "1" ] && [ "$MIGRATION_COUNT" -ge 1 ]; then
    pass "schema_migrations exists with $MIGRATION_COUNT applied row(s)"
else
    fail "schema_migrations missing or empty (exists=$TABLE_EXISTS count=$MIGRATION_COUNT)"
fi

section "--dry-run does not mutate schema_migrations"
COUNT_BEFORE=$(db_scalar "SELECT COUNT(*) FROM schema_migrations")
if ROHY_DB="$DB_PATH" node "$ROOT/scripts/migrate.js" --dry-run > "$OUT/dry-run.txt" 2>&1; then
    COUNT_AFTER=$(db_scalar "SELECT COUNT(*) FROM schema_migrations")
    if [ "$COUNT_BEFORE" = "$COUNT_AFTER" ]; then
        pass "--dry-run left schema_migrations count unchanged ($COUNT_AFTER)"
    else
        fail "--dry-run mutated schema_migrations ($COUNT_BEFORE -> $COUNT_AFTER)"
    fi
else
    fail "--dry-run failed: $(cat "$OUT/dry-run.txt")"
fi

section "Re-running migrations is a no-op"
COUNT_BEFORE=$(db_scalar "SELECT COUNT(*) FROM schema_migrations")
if ROHY_DB="$DB_PATH" node "$ROOT/scripts/migrate.js" > "$OUT/migrate-rerun.txt" 2>&1; then
    COUNT_AFTER=$(db_scalar "SELECT COUNT(*) FROM schema_migrations")
    if [ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && grep -q "applied 0 migrations" "$OUT/migrate-rerun.txt"; then
        pass "Migration re-run applied 0 new migrations"
    else
        fail "Migration re-run was not a no-op ($COUNT_BEFORE -> $COUNT_AFTER): $(cat "$OUT/migrate-rerun.txt")"
    fi
else
    fail "Migration re-run failed: $(cat "$OUT/migrate-rerun.txt")"
fi

section "alarm_config user FK cascades"
AUDIT_USER="migration-$RUN_TAG"
AUDIT_EMAIL="migration-$RUN_TAG@example.invalid"
USER_ID=$(db_insert \
    "INSERT INTO users (username, name, password_hash, email, role, status) VALUES (?, ?, ?, ?, 'student', 'active')" \
    "$AUDIT_USER" "Migration Audit" "audit-password-hash" "$AUDIT_EMAIL") || USER_ID=""

if [ -z "$USER_ID" ]; then
    fail "Could not create temp user for cascade audit"
else
    CONFIG_ID=$(db_insert \
        "INSERT INTO alarm_config (user_id, vital_sign, high_threshold, low_threshold, enabled) VALUES (?, 'hr', 120, 40, 1)" \
        "$USER_ID") || CONFIG_ID=""
    BEFORE_CONFIG=$(db_scalar "SELECT COUNT(*) FROM alarm_config WHERE id = ?" "$CONFIG_ID")
    db_exec "DELETE FROM users WHERE id = ?" "$USER_ID" > "$OUT/delete-user.txt" || true
    AFTER_CONFIG=$(db_scalar "SELECT COUNT(*) FROM alarm_config WHERE id = ?" "$CONFIG_ID")
    if [ "$BEFORE_CONFIG" = "1" ] && [ "$AFTER_CONFIG" = "0" ]; then
        pass "Deleting temp user cascaded to alarm_config"
    else
        fail "alarm_config cascade failed or was blocked (config $BEFORE_CONFIG -> $AFTER_CONFIG)"
        db_exec "DELETE FROM alarm_config WHERE id = ?" "$CONFIG_ID" >/dev/null 2>&1 || true
        db_exec "DELETE FROM users WHERE id = ?" "$USER_ID" >/dev/null 2>&1 || true
    fi
fi

section "Summary"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
fi

printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
printf "%s\n" "$FAILURES"
exit 1
