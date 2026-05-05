#!/usr/bin/env bash
# End-to-end audit of physical-exam idempotency shipped in Stage 6.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-physexam.sh
#
# Bash 3.2 compatible. The runtime snapshot binding for ManikinPanel is
# verified via the browser smoke step rather than HTTP.
#
# Asserts:
#   1. POST /sessions/:id/exam-findings inserts the first time.
#   2. POSTing the same (body_region, exam_type) returns already_recorded:true
#      and does NOT increment exam_findings_count a second time.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-physexam-audit-XXXXXX")
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

section "Login admin"
curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" > "$OUT/admin.json"
TOK=$(json_get "$OUT/admin.json" "token")
[ -n "$TOK" ] || { fail "login failed"; exit 1; }
pass "Admin logged in"
AUTH=( -H "Authorization: Bearer $TOK" )

section "Pick case + create session"
curl -s "${AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "no cases"; exit 1; }
pass "case_id=$CASE_ID"

curl -s -X POST "${AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"PhysExamAudit\"}" > "$OUT/session.json"
SESSION_ID=$(json_get "$OUT/session.json" "id")
[ -n "$SESSION_ID" ] || { fail "session create"; exit 1; }
pass "session_id=$SESSION_ID"

section "POST /exam-findings is idempotent on (body_region, exam_type)"
RUN_TAG="audit-$$-$(date +%s)"
PAYLOAD="$OUT/finding.json"
python3 - "$PAYLOAD" "$RUN_TAG" "$CASE_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "body_region": f"audit_chest_{sys.argv[2]}",
        "exam_type": "auscultation",
        "finding": "clear bilaterally",
        "is_abnormal": False,
        "case_id": int(sys.argv[3])
    }, f)
PYEOF

curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/exam-findings" \
    -H 'Content-Type: application/json' --data-binary "@$PAYLOAD" > "$OUT/r1.json"
ID1=$(json_get "$OUT/r1.json" "id")
ALREADY1=$(json_get "$OUT/r1.json" "already_recorded")
if [ -n "$ID1" ] && [ "$ALREADY1" = "False" ]; then
    pass "First record returned id=$ID1, already_recorded=false"
else
    fail "First record: id='$ID1' already='$ALREADY1', body: $(cat "$OUT/r1.json")"
fi

# Replay same payload — should return same id with already_recorded=true
curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/exam-findings" \
    -H 'Content-Type: application/json' --data-binary "@$PAYLOAD" > "$OUT/r2.json"
ID2=$(json_get "$OUT/r2.json" "id")
ALREADY2=$(json_get "$OUT/r2.json" "already_recorded")
if [ "$ID1" = "$ID2" ] && [ "$ALREADY2" = "True" ]; then
    pass "Replay returned same id=$ID1 + already_recorded=true (idempotent)"
else
    fail "Replay: id='$ID2' (want $ID1), already='$ALREADY2' (want True)"
fi

# Cross-check: GET /exam-findings should show ONE row for this region+type
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/exam-findings" > "$OUT/list.json"
COUNT=$(python3 - "$OUT/list.json" "$RUN_TAG" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = f"audit_chest_{sys.argv[2]}"
findings = data.get('findings') or []
print(sum(1 for r in findings if r.get('body_region') == target and r.get('exam_type') == 'auscultation'))
PYEOF
)
if [ "$COUNT" = "1" ]; then
    pass "physical_exam_findings has exactly 1 row for the replayed region+type"
else
    fail "physical_exam_findings has $COUNT rows (expected 1)"
fi

curl -s -X PUT "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/end" > /dev/null || true

section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
