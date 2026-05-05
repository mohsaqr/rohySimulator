#!/usr/bin/env bash
# End-to-end audit for Stage E3 role hierarchy and centralized RBAC checks.
#
# Run while the API server is up:
#   bash scripts/audit-rbac.sh
#
# Bash 3.2 compatible.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
STUDENT_USER="${ROHY_STUDENT_USER:-student}"
STUDENT_PASS="${ROHY_STUDENT_PASS:-student123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-rbac-audit-XXXXXX")
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
    if cur is None:
        break
    if p.isdigit():
        try:
            cur = cur[int(p)]
        except (IndexError, TypeError):
            cur = None
    else:
        cur = cur.get(p) if isinstance(cur, dict) else None
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
        "description": "RBAC audit case",
        "system_prompt": "You are a simulated patient.",
        "config": {
            "demographics": {"name": name, "age": 44, "gender": "Other"},
            "chiefComplaint": "RBAC audit",
            "initialVitals": {"hr": 80, "spo2": 98, "rr": 16}
        },
        "scenario": None
    }, f)
PYEOF
}

assert_code() {
    label="$1"
    expected="$2"
    actual="$3"
    if [ "$actual" = "$expected" ]; then
        pass "$label -> $expected"
    else
        fail "$label expected $expected got $actual"
    fi
}

RUN_TAG="rbac-$$-$(date +%s)"
PASSWORD="AuditPass123!"

section "Login seeded users"
ADMIN_LOGIN="$OUT/admin-login-payload.json"
STUDENT_LOGIN="$OUT/student-login-payload.json"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$ADMIN_LOGIN" "$OUT/admin-login.json")
STUDENT_TOK=$(login "$STUDENT_USER" "$STUDENT_PASS" "$STUDENT_LOGIN" "$OUT/student-login.json")
[ -n "$ADMIN_TOK" ] && [ -n "$STUDENT_TOK" ] || { fail "seeded login failed"; exit 1; }
STUDENT_ID=$(json_get "$OUT/student-login.json" "user.id")
pass "Seeded admin and student users logged in"

ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
STUDENT_AUTH=( -H "Authorization: Bearer $STUDENT_TOK" )

section "Create reviewer and educator"
REVIEWER_USER="reviewer_$RUN_TAG"
EDUCATOR_USER="educator_$RUN_TAG"
write_user_payload "$OUT/reviewer-create.json" "$REVIEWER_USER" "$REVIEWER_USER@audit.local" "$PASSWORD" "reviewer"
write_user_payload "$OUT/educator-create.json" "$EDUCATOR_USER" "$EDUCATOR_USER@audit.local" "$PASSWORD" "educator"

CODE=$(curl -s -o "$OUT/reviewer-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/reviewer-create.json")
assert_code "Admin creates reviewer" "201" "$CODE"

CODE=$(curl -s -o "$OUT/educator-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/educator-create.json")
assert_code "Admin creates educator" "201" "$CODE"

REVIEWER_LOGIN="$OUT/reviewer-login-payload.json"
EDUCATOR_LOGIN="$OUT/educator-login-payload.json"
REVIEWER_TOK=$(login "$REVIEWER_USER" "$PASSWORD" "$REVIEWER_LOGIN" "$OUT/reviewer-login.json")
EDUCATOR_TOK=$(login "$EDUCATOR_USER" "$PASSWORD" "$EDUCATOR_LOGIN" "$OUT/educator-login.json")
[ -n "$REVIEWER_TOK" ] && [ -n "$EDUCATOR_TOK" ] || { fail "new role login failed"; exit 1; }
pass "Reviewer and educator logged in"

REVIEWER_AUTH=( -H "Authorization: Bearer $REVIEWER_TOK" )
EDUCATOR_AUTH=( -H "Authorization: Bearer $EDUCATOR_TOK" )

section "Role enum enforcement"
write_user_payload "$OUT/invalid-role.json" "invalid_$RUN_TAG" "invalid_$RUN_TAG@audit.local" "$PASSWORD" "superuser"
CODE=$(curl -s -o "$OUT/invalid-role-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/invalid-role.json")
assert_code "Invalid role rejected" "400" "$CODE"

section "Student IDOR and escalation checks"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "no case available for session IDOR test"; exit 1; }
python3 - "$OUT/session-create.json" "$CASE_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"case_id": int(sys.argv[2]), "student_name": "RBAC Admin Session"}, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/session-create.json" > "$OUT/admin-session.json"
ADMIN_SESSION_ID=$(json_get "$OUT/admin-session.json" "id")
[ -n "$ADMIN_SESSION_ID" ] || { fail "admin session create failed"; exit 1; }

CODE=$(curl -s -o "$OUT/student-session-deny.json" -w "%{http_code}" "${STUDENT_AUTH[@]}" \
    "$API/api/sessions/$ADMIN_SESSION_ID")
assert_code "Student cannot read another user's session" "403" "$CODE"

python3 - "$OUT/student-escalate.json" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"role": "admin", "username": "student", "name": "Demo Student", "email": "student@rohy.local"}, f)
PYEOF
CODE=$(curl -s -o "$OUT/student-escalate-response.json" -w "%{http_code}" -X PUT "${STUDENT_AUTH[@]}" \
    "$API/api/users/$STUDENT_ID" -H 'Content-Type: application/json' --data-binary "@$OUT/student-escalate.json")
assert_code "Student self-escalation rejected" "403" "$CODE"

section "Reviewer read-only access"
CODE=$(curl -s -o "$OUT/reviewer-cases.json" -w "%{http_code}" "${REVIEWER_AUTH[@]}" "$API/api/cases")
assert_code "Reviewer reads cases" "200" "$CODE"
CODE=$(curl -s -o "$OUT/reviewer-labs-stats.json" -w "%{http_code}" "${REVIEWER_AUTH[@]}" "$API/api/labs/stats")
assert_code "Reviewer reads lab stats" "200" "$CODE"
CODE=$(curl -s -o "$OUT/reviewer-events.json" -w "%{http_code}" "${REVIEWER_AUTH[@]}" "$API/api/learning-events/all?limit=5")
assert_code "Reviewer reads learning events" "200" "$CODE"

write_case_payload "$OUT/reviewer-case.json" "Reviewer Write Deny $RUN_TAG"
CODE=$(curl -s -o "$OUT/reviewer-case-response.json" -w "%{http_code}" -X POST "${REVIEWER_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/reviewer-case.json")
assert_code "Reviewer cannot create cases" "403" "$CODE"
CODE=$(curl -s -o "$OUT/reviewer-lab-write.json" -w "%{http_code}" -X POST "${REVIEWER_AUTH[@]}" \
    "$API/api/labs/test" -H 'Content-Type: application/json' --data-binary "@$OUT/reviewer-case.json")
assert_code "Reviewer cannot write lab catalog" "403" "$CODE"

section "Educator elevated non-admin access"
write_case_payload "$OUT/educator-case.json" "Educator Case $RUN_TAG"
CODE=$(curl -s -o "$OUT/educator-case-response.json" -w "%{http_code}" -X POST "${EDUCATOR_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/educator-case.json")
assert_code "Educator creates case" "200" "$CODE"
EDUCATOR_CASE_ID=$(json_get "$OUT/educator-case-response.json" "id")

python3 - "$OUT/availability.json" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"is_available": True}, f)
PYEOF
CODE=$(curl -s -o "$OUT/educator-availability.json" -w "%{http_code}" -X PUT "${EDUCATOR_AUTH[@]}" \
    "$API/api/cases/$EDUCATOR_CASE_ID/availability" -H 'Content-Type: application/json' --data-binary "@$OUT/availability.json")
assert_code "Educator updates case availability" "200" "$CODE"

CODE=$(curl -s -o "$OUT/educator-users-deny.json" -w "%{http_code}" "${EDUCATOR_AUTH[@]}" "$API/api/users")
assert_code "Educator cannot use admin-only user list" "403" "$CODE"
CODE=$(curl -s -o "$OUT/educator-platform-deny.json" -w "%{http_code}" "${EDUCATOR_AUTH[@]}" "$API/api/platform-settings")
assert_code "Educator cannot use admin-only platform settings" "403" "$CODE"

section "Admin retained access"
write_case_payload "$OUT/admin-case.json" "Admin Case $RUN_TAG"
CODE=$(curl -s -o "$OUT/admin-case-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/admin-case.json")
assert_code "Admin creates case" "200" "$CODE"
CODE=$(curl -s -o "$OUT/admin-users.json" -w "%{http_code}" "${ADMIN_AUTH[@]}" "$API/api/users")
assert_code "Admin reads user list" "200" "$CODE"

curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/sessions/$ADMIN_SESSION_ID/end" > /dev/null || true

if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\n%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
fi

printf "\n%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
printf "Failures:%s\n" "$FAILURES"
exit 1
