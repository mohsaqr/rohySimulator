#!/usr/bin/env bash
# End-to-end audit of TNA / learning-events IDOR fixes shipped in Stage 8.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-tna.sh
#
# Bash 3.2 compatible.
#
# Asserts:
#   1. GET /learning-events/detailed/:sessionId is 403 for non-owner.
#   2. GET /learning-events/analytics/summary?session_id=X is 403 for non-owner.
#   3. Owner of the session can still read both (200).

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
STUDENT_USER="${ROHY_STUDENT_USER:-student}"
STUDENT_PASS="${ROHY_STUDENT_PASS:-student123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-tna-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""
pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  \033[31m✗\033[0m %s\n" "$1"; }
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }
json_get() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
path = sys.argv[2].split('.')
cur = data
for p in path:
    if cur is None: break
    if p.isdigit():
        try: cur = cur[int(p)]
        except (IndexError, TypeError): cur = None
    else:
        cur = cur.get(p) if isinstance(cur, dict) else None
print('' if cur is None else cur)
PYEOF
}

login() {
    curl -s -X POST "$API/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" > "$3"
    json_get "$3" "token"
}

section "Login admin + student"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin.json")
STUDENT_TOK=$(login "$STUDENT_USER" "$STUDENT_PASS" "$OUT/student.json")
[ -n "$ADMIN_TOK" ] && [ -n "$STUDENT_TOK" ] || { fail "login failed"; exit 1; }
pass "Both roles logged in"

ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
STUDENT_AUTH=( -H "Authorization: Bearer $STUDENT_TOK" )

curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "no cases"; exit 1; }

# Admin creates a session — student cannot read its analytics.
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"TnaAuditAdmin\"}" \
    > "$OUT/admin_session.json"
ADMIN_SID=$(json_get "$OUT/admin_session.json" "id")
[ -n "$ADMIN_SID" ] || { fail "admin session create"; exit 1; }
pass "Admin created session $ADMIN_SID"

section "GET /learning-events/detailed/:sessionId IDOR"
DENY_CODE=$(curl -s -o "$OUT/d_deny.json" -w "%{http_code}" \
    "${STUDENT_AUTH[@]}" "$API/api/learning-events/detailed/$ADMIN_SID")
if [ "$DENY_CODE" = "403" ]; then
    pass "Student read of admin's detailed events -> 403"
else
    fail "Student read -> $DENY_CODE (want 403), body: $(cat "$OUT/d_deny.json")"
fi

OWN_CODE=$(curl -s -o "$OUT/d_own.json" -w "%{http_code}" \
    "${ADMIN_AUTH[@]}" "$API/api/learning-events/detailed/$ADMIN_SID")
if [ "$OWN_CODE" = "200" ]; then
    pass "Admin self-read of detailed events -> 200"
else
    fail "Admin self-read -> $OWN_CODE (want 200)"
fi

section "GET /learning-events/analytics/summary?session_id=X IDOR"
DENY2_CODE=$(curl -s -o "$OUT/s_deny.json" -w "%{http_code}" \
    "${STUDENT_AUTH[@]}" "$API/api/learning-events/analytics/summary?session_id=$ADMIN_SID")
if [ "$DENY2_CODE" = "403" ]; then
    pass "Student summary of admin's session -> 403"
else
    fail "Student summary -> $DENY2_CODE (want 403), body: $(cat "$OUT/s_deny.json")"
fi

OWN2_CODE=$(curl -s -o "$OUT/s_own.json" -w "%{http_code}" \
    "${ADMIN_AUTH[@]}" "$API/api/learning-events/analytics/summary?session_id=$ADMIN_SID")
if [ "$OWN2_CODE" = "200" ]; then
    pass "Admin self-summary -> 200"
else
    fail "Admin self-summary -> $OWN2_CODE (want 200)"
fi

curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/sessions/$ADMIN_SID/end" > /dev/null || true

section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
