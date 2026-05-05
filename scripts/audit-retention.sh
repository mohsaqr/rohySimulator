#!/usr/bin/env bash
# End-to-end audit for Stage E7 retention and user purge.
#
# Run while the API server is up:
#   bash scripts/audit-retention.sh
#
# Bash 3.2 compatible.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${ROHY_API:-http://localhost:3000}"
DB_PATH="${ROHY_DB:-$ROOT/server/database.sqlite}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-retention-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""
pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  PASS %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  FAIL %s\n" "$1"; }
section() { printf "\n%s\n" "$1"; }

json_get() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception:
    print('')
    sys.exit(0)
cur = data
for p in sys.argv[2].split('.'):
    if p == '':
        continue
    if isinstance(cur, list) and p.isdigit():
        cur = cur[int(p)] if int(p) < len(cur) else None
    elif isinstance(cur, dict):
        cur = cur.get(p)
    else:
        cur = None
    if cur is None:
        break
print('' if cur is None else cur)
PYEOF
}

write_login_payload() {
    python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"username": sys.argv[2], "password": sys.argv[3]}, f)
PYEOF
}

login() {
    write_login_payload "$3" "$1" "$2"
    curl -s -X POST "$API/api/auth/login" \
        -H 'Content-Type: application/json' \
        --data-binary "@$3" > "$4"
    json_get "$4" "token"
}

assert_eq() {
    label="$1"
    expected="$2"
    actual="$3"
    if [ "$actual" = "$expected" ]; then
        pass "$label"
    else
        fail "$label expected '$expected' got '$actual'"
    fi
}

assert_ge() {
    label="$1"
    actual="$2"
    min="$3"
    if [ "${actual:-0}" -ge "$min" ]; then
        pass "$label"
    else
        fail "$label expected >= $min got ${actual:-0}"
    fi
}

write_user_payload() {
    python3 - "$1" "$2" "$3" "$4" "$5" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "username": sys.argv[2],
        "name": sys.argv[2],
        "email": sys.argv[3],
        "password": sys.argv[4],
        "role": sys.argv[5]
    }, f)
PYEOF
}

write_case_payload() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
name = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": name,
        "description": "Retention audit case",
        "system_prompt": "You are a simulated patient.",
        "config": {
            "demographics": {"name": name, "age": 44, "gender": "Other"},
            "chiefComplaint": "Retention audit",
            "initialVitals": {"hr": 80, "spo2": 98, "rr": 16}
        },
        "scenario": None
    }, f)
PYEOF
}

section "Schema assertions"
SOFT_TABLES="cases sessions agent_templates scenarios medications case_investigations lab_definitions clinical_notes"
for table in $SOFT_TABLES; do
    COL=$(sqlite3 "$DB_PATH" "PRAGMA table_info($table);" | awk -F'|' '$2=="deleted_at"{print $2}')
    [ "$COL" = "deleted_at" ] && pass "$table.deleted_at exists" || fail "$table.deleted_at missing"
done

section "Setup"
RUN_TAG="retention-$$-$(date +%s)"
PASSWORD="RetentionPass123!"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin-login-payload.json" "$OUT/admin-login.json")
[ -n "$ADMIN_TOK" ] || { fail "seed admin login failed"; exit 1; }
ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
pass "seed admin logged in"

CASE_NAME="Soft Delete Case $RUN_TAG"
write_case_payload "$OUT/soft-case.json" "$CASE_NAME"
CODE=$(curl -s -o "$OUT/soft-case-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/soft-case.json")
assert_eq "admin creates case for soft-delete probe" "200" "$CODE"
SOFT_CASE_ID=$(json_get "$OUT/soft-case-response.json" "id")

CODE=$(curl -s -o "$OUT/delete-soft-case.json" -w "%{http_code}" -X DELETE "${ADMIN_AUTH[@]}" "$API/api/cases/$SOFT_CASE_ID")
assert_eq "DELETE /cases/:id soft-deletes" "200" "$CODE"

CODE=$(curl -s -o "$OUT/get-soft-case.json" -w "%{http_code}" "${ADMIN_AUTH[@]}" "$API/api/cases/$SOFT_CASE_ID")
assert_eq "GET /cases/:id hides soft-deleted case" "404" "$CODE"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/cases-after-delete.json"
if grep -q "$CASE_NAME" "$OUT/cases-after-delete.json"; then fail "GET /cases includes soft-deleted case"; else pass "GET /cases excludes soft-deleted case"; fi
ROW_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM cases WHERE id=$SOFT_CASE_ID AND deleted_at IS NOT NULL;")
assert_eq "soft-deleted case physically remains" "1" "$ROW_EXISTS"

section "Purge flow"
PURGE_USER="purge_user_$RUN_TAG"
write_user_payload "$OUT/purge-user.json" "$PURGE_USER" "$PURGE_USER@audit.local" "$PASSWORD" "educator"
CODE=$(curl -s -o "$OUT/purge-user-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/purge-user.json")
assert_eq "admin creates purge target" "201" "$CODE"
PURGE_USER_ID=$(json_get "$OUT/purge-user-response.json" "user.id")
PURGE_TOK=$(login "$PURGE_USER" "$PASSWORD" "$OUT/purge-login-payload.json" "$OUT/purge-login.json")
[ -n "$PURGE_TOK" ] && pass "purge target can login before purge" || fail "purge target login failed"
PURGE_AUTH=( -H "Authorization: Bearer $PURGE_TOK" )

PURGE_CASE_NAME="Authored Purge Case $RUN_TAG"
write_case_payload "$OUT/purge-case.json" "$PURGE_CASE_NAME"
CODE=$(curl -s -o "$OUT/purge-case-response.json" -w "%{http_code}" -X POST "${PURGE_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/purge-case.json")
assert_eq "purge target authors case" "200" "$CODE"
PURGE_CASE_ID=$(json_get "$OUT/purge-case-response.json" "id")

sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO user_preferences (user_id, tenant_id) VALUES ($PURGE_USER_ID, 1);"

CODE=$(curl -s -o "$OUT/purge-dry-run.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/$PURGE_USER_ID/purge?dry-run=true")
assert_eq "purge dry-run returns 200" "200" "$CODE"
DRY_CASES=$(json_get "$OUT/purge-dry-run.json" "counts.soft_delete.cases")
DRY_PREFS=$(json_get "$OUT/purge-dry-run.json" "counts.hard_delete.user_preferences")
assert_ge "dry-run includes soft-delete case count" "$DRY_CASES" 1
assert_ge "dry-run includes user_preferences count" "$DRY_PREFS" 1

CODE=$(curl -s -o "$OUT/purge-run.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/$PURGE_USER_ID/purge")
assert_eq "purge executes" "200" "$CODE"

ANON_USER=$(sqlite3 "$DB_PATH" "SELECT username || '|' || COALESCE(email, 'NULL') || '|' || status FROM users WHERE id=$PURGE_USER_ID;")
assert_eq "user row anonymized" "deleted_user_${PURGE_USER_ID}|NULL|inactive" "$ANON_USER"
PREFS_LEFT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_preferences WHERE user_id=$PURGE_USER_ID;")
assert_eq "user_preferences hard-deleted" "0" "$PREFS_LEFT"
AUTHORED_CASE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM cases WHERE id=$PURGE_CASE_ID AND deleted_at IS NOT NULL AND created_by IS NULL;")
assert_eq "authored case soft-deleted and detached" "1" "$AUTHORED_CASE"
AUDIT_ROW=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM system_audit_log WHERE action='purge_user' AND resource_id='$PURGE_USER_ID';")
assert_ge "purge audit row retained with target id" "$AUDIT_ROW" 1

section "Retention sweep"
sqlite3 "$DB_PATH" <<'SQLEOF'
INSERT INTO event_log (event_type, description, timestamp, tenant_id) VALUES ('audit_retention_old', 'old', datetime('now','-10 seconds'), 1);
INSERT INTO learning_events (verb, object_type, timestamp, tenant_id) VALUES ('AUDIT_RETENTION_OLD', 'audit', datetime('now','-10 seconds'), 1);
INSERT INTO interactions (role, content, timestamp, tenant_id) VALUES ('system', 'audit_retention_old', datetime('now','-10 seconds'), 1);
INSERT INTO system_audit_log (action, resource_type, timestamp, tenant_id) VALUES ('audit_retention_old', 'audit', datetime('now','-10 seconds'), 1);
INSERT INTO alarm_events (vital_sign, threshold_type, triggered_at, tenant_id) VALUES ('hr', 'high', datetime('now','-10 seconds'), 1);
INSERT INTO llm_request_log (model, status, request_timestamp, tenant_id) VALUES ('audit-retention', 'success', datetime('now','-10 seconds'), 1);
SQLEOF

ROHY_DB="$DB_PATH" ROHY_RETENTION_SECONDS=1 node "$ROOT/scripts/retention-sweep.js" > "$OUT/retention-sweep.json"
OLD_LEFT=$(sqlite3 "$DB_PATH" "SELECT
    (SELECT COUNT(*) FROM event_log WHERE event_type='audit_retention_old') +
    (SELECT COUNT(*) FROM learning_events WHERE verb='AUDIT_RETENTION_OLD') +
    (SELECT COUNT(*) FROM interactions WHERE content='audit_retention_old') +
    (SELECT COUNT(*) FROM system_audit_log WHERE action='audit_retention_old') +
    (SELECT COUNT(*) FROM alarm_events WHERE vital_sign='hr' AND threshold_type='high' AND triggered_at < datetime('now','-1 seconds')) +
    (SELECT COUNT(*) FROM llm_request_log WHERE model='audit-retention');")
assert_eq "retention sweep deletes old time-bounded rows" "0" "$OLD_LEFT"
SWEEP_AUDIT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM system_audit_log WHERE action='retention_sweep';")
assert_ge "retention sweep audit row written" "$SWEEP_AUDIT" 1

printf "\nRetention audit result: %s pass, %s fail\n" "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
    printf "Failures:%s\n" "$FAILURES"
    exit 1
fi
