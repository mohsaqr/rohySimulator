#!/usr/bin/env bash
# End-to-end audit of alarm + notification wiring shipped in the Stage-3 audit.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-alarms.sh
#
# Bash 3.2 compatible (macOS default). Heredoc + curl-pipe collide on stdin
# (LEARNINGS.md), so callers pre-write JSON to temp files.
#
# Asserts:
#   1. PUT /alarms/:id/acknowledge requires session ownership — a non-owner
#      gets 403, the owner gets 200 + acknowledged_at stamped.
#   2. PUT /alarms/:id/acknowledge is idempotent — re-calling it returns the
#      original timestamp + already_acknowledged:true (was re-stamping every
#      call, corrupting the audit trail).
#   3. GET /alarms/config/:userId rejects cross-user reads — non-admin asking
#      for another user's config gets 403.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
STUDENT_USER="${ROHY_STUDENT_USER:-student}"
STUDENT_PASS="${ROHY_STUDENT_PASS:-student123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-alarms-audit-XXXXXX")
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
    # login USERNAME PASSWORD OUTFILE — writes the auth token to a file.
    local outfile="$3"
    curl -s -X POST "$API/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" > "$outfile"
    json_get "$outfile" "token"
}

# ── Login both roles ───────────────────────────────────────────────────────
section "Login admin + student"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin.json")
if [ -z "$ADMIN_TOK" ]; then
    fail "Admin login failed — is admin/admin123 seeded?"
    exit 1
fi
pass "Admin logged in"
ADMIN_ID=$(json_get "$OUT/admin.json" "user.id")

STUDENT_TOK=$(login "$STUDENT_USER" "$STUDENT_PASS" "$OUT/student.json")
if [ -z "$STUDENT_TOK" ]; then
    fail "Student login failed — is student/student123 seeded?"
    exit 1
fi
pass "Student logged in"
STUDENT_ID=$(json_get "$OUT/student.json" "user.id")

ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
STUDENT_AUTH=( -H "Authorization: Bearer $STUDENT_TOK" )

# ── Pick a case ────────────────────────────────────────────────────────────
section "Pick a case"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
if [ -z "$CASE_ID" ]; then
    fail "No cases available"
    exit 1
fi
pass "Using case_id=$CASE_ID"

# ── Create one session per role ────────────────────────────────────────────
section "Create one session per role"
curl -s -X POST "${STUDENT_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"AlarmAudit\"}" \
    > "$OUT/student_session.json"
STUDENT_SESSION=$(json_get "$OUT/student_session.json" "id")
if [ -z "$STUDENT_SESSION" ]; then
    fail "Student session create failed; payload:"
    cat "$OUT/student_session.json"
    exit 1
fi
pass "Student session id=$STUDENT_SESSION"

# Student fires an alarm on their own session (POST /alarms/log)
ALARM_PAYLOAD="$OUT/alarm_payload.json"
python3 - "$ALARM_PAYLOAD" "$STUDENT_SESSION" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "session_id": int(sys.argv[2]),
        "vital_sign": "hr",
        "threshold_type": "high",
        "threshold_value": 120,
        "actual_value": 145
    }, f)
PYEOF

curl -s -X POST "${STUDENT_AUTH[@]}" "$API/api/alarms/log" \
    -H 'Content-Type: application/json' \
    --data-binary "@$ALARM_PAYLOAD" > "$OUT/alarm_log.json"
ALARM_ID=$(json_get "$OUT/alarm_log.json" "id")
if [ -z "$ALARM_ID" ]; then
    fail "Alarm log returned no id; payload:"
    cat "$OUT/alarm_log.json"
    exit 1
fi
pass "Student logged alarm id=$ALARM_ID for their session"

# ── 1. Admin acks student's alarm — allowed ────────────────────────────────
# (Admin escalation: explicit admin role bypass is correct — admins audit.)
section "Admin can ack any alarm (allowed)"
ACK_OUT="$OUT/ack_admin.json"
HTTP_CODE=$(curl -s -o "$ACK_OUT" -w "%{http_code}" \
    -X PUT "${ADMIN_AUTH[@]}" "$API/api/alarms/$ALARM_ID/acknowledge")
if [ "$HTTP_CODE" = "200" ]; then
    pass "Admin ack -> 200"
else
    fail "Admin ack -> $HTTP_CODE (expected 200), body: $(cat "$ACK_OUT")"
fi

# ── 2. Re-ack idempotency ──────────────────────────────────────────────────
section "Re-ack is idempotent — preserves original timestamp"
FIRST_TS=$(json_get "$ACK_OUT" "acknowledged_at")
sleep 1
ACK2_OUT="$OUT/ack_admin2.json"
curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/alarms/$ALARM_ID/acknowledge" > "$ACK2_OUT"
SECOND_TS=$(json_get "$ACK2_OUT" "acknowledged_at")
ALREADY=$(json_get "$ACK2_OUT" "already_acknowledged")

if [ "$FIRST_TS" = "$SECOND_TS" ] && [ "$ALREADY" = "True" ]; then
    pass "Re-ack returned original timestamp + already_acknowledged:true"
else
    fail "Re-ack mutated timestamp (was '$FIRST_TS', now '$SECOND_TS', already=$ALREADY)"
fi

# ── 3. Non-owner cross-user ack — denied ───────────────────────────────────
section "Non-owner cross-user ack is denied (HIGH IDOR fix)"

# Need an alarm owned by the *admin* so the student trying to ack it gets 403.
# Create an admin-owned session, log an alarm against it.
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"AdminSession\"}" \
    > "$OUT/admin_session.json"
ADMIN_SESSION=$(json_get "$OUT/admin_session.json" "id")
pass "Admin session id=$ADMIN_SESSION"

python3 - "$OUT/admin_alarm_payload.json" "$ADMIN_SESSION" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "session_id": int(sys.argv[2]),
        "vital_sign": "spo2",
        "threshold_type": "low",
        "threshold_value": 92,
        "actual_value": 84
    }, f)
PYEOF

curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/alarms/log" \
    -H 'Content-Type: application/json' \
    --data-binary "@$OUT/admin_alarm_payload.json" > "$OUT/admin_alarm.json"
ADMIN_ALARM_ID=$(json_get "$OUT/admin_alarm.json" "id")
pass "Admin logged alarm id=$ADMIN_ALARM_ID"

# Student attempts to ack the admin's alarm — should be 403.
DENY_OUT="$OUT/student_ack_admin.json"
DENY_CODE=$(curl -s -o "$DENY_OUT" -w "%{http_code}" \
    -X PUT "${STUDENT_AUTH[@]}" "$API/api/alarms/$ADMIN_ALARM_ID/acknowledge")
if [ "$DENY_CODE" = "403" ]; then
    pass "Student ack of another user's alarm -> 403"
else
    fail "Student ack of another user's alarm -> $DENY_CODE (expected 403), body: $(cat "$DENY_OUT")"
fi

# ── 4. Cross-user config read denied ───────────────────────────────────────
section "Cross-user GET /alarms/config/:userId is denied"
CFG_OUT="$OUT/cfg_cross.json"
CFG_CODE=$(curl -s -o "$CFG_OUT" -w "%{http_code}" \
    "${STUDENT_AUTH[@]}" "$API/api/alarms/config/$ADMIN_ID")
if [ "$CFG_CODE" = "403" ]; then
    pass "Student reading admin's alarm config -> 403"
else
    fail "Student reading admin's alarm config -> $CFG_CODE (expected 403), body: $(cat "$CFG_OUT")"
fi

# Self-read still works
CFG_SELF_OUT="$OUT/cfg_self.json"
CFG_SELF_CODE=$(curl -s -o "$CFG_SELF_OUT" -w "%{http_code}" \
    "${STUDENT_AUTH[@]}" "$API/api/alarms/config/$STUDENT_ID")
if [ "$CFG_SELF_CODE" = "200" ]; then
    pass "Student reading own config -> 200"
else
    fail "Student reading own config -> $CFG_SELF_CODE (expected 200)"
fi

# Admin can read any user (allowed)
CFG_ADMIN_OUT="$OUT/cfg_admin_other.json"
CFG_ADMIN_CODE=$(curl -s -o "$CFG_ADMIN_OUT" -w "%{http_code}" \
    "${ADMIN_AUTH[@]}" "$API/api/alarms/config/$STUDENT_ID")
if [ "$CFG_ADMIN_CODE" = "200" ]; then
    pass "Admin reading student's config -> 200 (admin override correct)"
else
    fail "Admin reading student's config -> $CFG_ADMIN_CODE (expected 200)"
fi

# ── End sessions ───────────────────────────────────────────────────────────
curl -s -X PUT "${STUDENT_AUTH[@]}" "$API/api/sessions/$STUDENT_SESSION/end" > /dev/null || true
curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/sessions/$ADMIN_SESSION/end" > /dev/null || true

# ── Result ─────────────────────────────────────────────────────────────────
section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
