#!/usr/bin/env bash
# End-to-end audit of the lab + radiology investigations wiring shipped in
# the Stage-2 audit.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-investigations.sh
#
# Exits 0 on full pass, non-zero on any assertion failure. Bash 3.2 compatible
# (macOS default; no associative arrays). Uses temp files to avoid the
# heredoc-vs-pipe-stdin collision documented in LEARNINGS.md.
#
# Asserts:
#   1. POST /cases/:id/labs is now an UPSERT — re-POSTing the same test_name
#      updates the existing row instead of duplicating it.
#   2. PUT /cases/:id/labs bulk-replaces the lab array atomically — labs
#      removed from the payload disappear from the DB.
#   3. DELETE /cases/:id/labs/:labId cascades to investigation_orders so the
#      orders table never holds dead FK references.
#   4. POST /sessions/:id/order-labs is idempotent — re-ordering the same
#      lab returns skipped_duplicates and does NOT create a second order row.
#   5. POST /sessions/:id/order-radiology is idempotent on (session, name) —
#      because each radiology order writes a fresh case_investigations row,
#      dedup is keyed on the test_name not the investigation_id.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
USER_NAME="${ROHY_AUDIT_USER:-admin}"
PASS_WORD="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-investigations-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""

pass() {
    PASS_COUNT=$((PASS_COUNT+1))
    printf "  \033[32m✓\033[0m %s\n" "$1"
}
fail() {
    FAIL_COUNT=$((FAIL_COUNT+1))
    FAILURES="${FAILURES}
  - $1"
    printf "  \033[31m✗\033[0m %s\n" "$1"
}
section() {
    printf "\n\033[1m%s\033[0m\n" "$1"
}

json_get() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
path = sys.argv[2].split('.')
cur = data
for p in path:
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

# Run-unique markers so repeated invocations don't collide.
RUN_TAG="audit-investigations-$$-$(date +%s)"
LAB_NAME="AuditLab-${RUN_TAG}"
RAD_TAG="ChestXR"  # uses a stock master radiology study

# ── Login ──────────────────────────────────────────────────────────────────
section "Login"
LOGIN_OUT="$OUT/login.json"
curl -s -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASS_WORD\"}" \
    > "$LOGIN_OUT"
TOK=$(json_get "$LOGIN_OUT" "token")
if [ -z "$TOK" ]; then
    fail "Login failed — is API up on $API and admin seeded?"
    exit 1
fi
pass "Login as $USER_NAME"
AUTH=( -H "Authorization: Bearer $TOK" )

# ── Pick a case ────────────────────────────────────────────────────────────
section "Pick a case for the audit"
CASES_OUT="$OUT/cases.json"
curl -s "${AUTH[@]}" "$API/api/cases" > "$CASES_OUT"
CASE_ID=$(json_get "$CASES_OUT" "cases.0.id")
if [ -z "$CASE_ID" ]; then
    fail "No cases returned from /api/cases"
    exit 1
fi
pass "Using case_id=$CASE_ID"

# ── 1. POST /cases/:id/labs is UPSERT ──────────────────────────────────────
section "POST /cases/:id/labs upserts on (case_id, test_name, lab)"

LAB_PAYLOAD_1="$OUT/lab1.json"
python3 - "$LAB_PAYLOAD_1" "$LAB_NAME" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "test_name": sys.argv[2],
        "test_group": "Audit",
        "min_value": 1.0,
        "max_value": 10.0,
        "current_value": 5.0,
        "unit": "x",
        "is_abnormal": False,
        "turnaround_minutes": 30
    }, f)
PYEOF

POST1_OUT="$OUT/post1.json"
curl -s -X POST "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' \
    --data-binary "@$LAB_PAYLOAD_1" > "$POST1_OUT"
LAB_ID_1=$(json_get "$POST1_OUT" "id")
if [ -z "$LAB_ID_1" ]; then
    fail "First POST /labs returned no id"
    cat "$POST1_OUT"
fi

# Re-POST same test_name with a new value. Should UPDATE, returning the
# same id and reporting upserted:true.
LAB_PAYLOAD_2="$OUT/lab2.json"
python3 - "$LAB_PAYLOAD_2" "$LAB_NAME" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "test_name": sys.argv[2],
        "test_group": "Audit",
        "min_value": 2.0,
        "max_value": 20.0,
        "current_value": 99.0,
        "unit": "x",
        "is_abnormal": True,
        "turnaround_minutes": 5
    }, f)
PYEOF

POST2_OUT="$OUT/post2.json"
curl -s -X POST "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' \
    --data-binary "@$LAB_PAYLOAD_2" > "$POST2_OUT"
LAB_ID_2=$(json_get "$POST2_OUT" "id")
UPSERTED=$(json_get "$POST2_OUT" "upserted")

if [ "$LAB_ID_1" = "$LAB_ID_2" ] && [ "$UPSERTED" = "True" ]; then
    pass "Re-POST same test_name updated the existing row (id=$LAB_ID_1, upserted=true)"
else
    fail "Re-POST duplicated lab row (first id=$LAB_ID_1, second id=$LAB_ID_2, upserted=$UPSERTED)"
fi

# ── 2. PUT /cases/:id/labs bulk-replace ────────────────────────────────────
section "PUT /cases/:id/labs bulk-replaces the lab array"

# First, register a session so we can later check orphan cleanup on bulk PUT.
SESSION_OUT="$OUT/session.json"
curl -s -X POST "${AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"AuditBot\"}" \
    > "$SESSION_OUT"
SESSION_ID=$(json_get "$SESSION_OUT" "id")
pass "Session created: id=$SESSION_ID"

# Order our audit lab so investigation_orders has a row pointing at LAB_ID_1.
ORDER1_OUT="$OUT/order1.json"
curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-labs" \
    -H 'Content-Type: application/json' \
    -d "{\"lab_ids\":[$LAB_ID_1]}" > "$ORDER1_OUT"
ORDERED_1=$(json_get "$ORDER1_OUT" "orders.0.test_name")
if [ -n "$ORDERED_1" ]; then
    pass "Ordered audit lab (test_name='$ORDERED_1')"
else
    fail "First order returned no test_name; payload follows:"
    cat "$ORDER1_OUT"
fi

# Now PUT a labs array that DOES NOT contain our audit lab. The bulk replace
# should drop LAB_ID_1 from case_investigations AND the matching order rows
# from investigation_orders.
PUT_PAYLOAD="$OUT/put_labs.json"
python3 - "$PUT_PAYLOAD" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"labs": [{
        "test_name": "PostAuditOnlyLab",
        "min_value": 0,
        "max_value": 100,
        "current_value": 42
    }]}, f)
PYEOF

PUT_OUT="$OUT/put_labs_resp.json"
curl -s -X PUT "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' \
    --data-binary "@$PUT_PAYLOAD" > "$PUT_OUT"
INSERTED=$(json_get "$PUT_OUT" "inserted")
if [ "$INSERTED" = "1" ]; then
    pass "PUT /labs replaced the array (inserted=1)"
else
    fail "PUT /labs did not return inserted=1, got: $(cat "$PUT_OUT")"
fi

# Re-fetch available-labs and verify our audit lab is gone (only DB-side lab
# with this name should remain — but PUT just removed all DB labs for case,
# replaced with one called 'PostAuditOnlyLab').
LABS_OUT="$OUT/avail_labs.json"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/available-labs" > "$LABS_OUT"
HAS_AUDIT_LAB=$(python3 - "$LABS_OUT" "$LAB_NAME" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = sys.argv[2]
labs = data.get('labs') or data.get('configured') or []
# available-labs response shape: {labs: [...], ...}
for lab in labs:
    if lab.get('test_name') == target and lab.get('source') == 'database':
        print('1'); sys.exit()
print('0')
PYEOF
)
if [ "$HAS_AUDIT_LAB" = "0" ]; then
    pass "Bulk PUT removed audit lab from DB-side listings"
else
    fail "Bulk PUT did not remove the audit lab from available-labs"
fi

# Verify orphan investigation_orders for the dropped lab were cleaned up.
ORDERS_OUT="$OUT/orders.json"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/orders" > "$ORDERS_OUT"
ORPHAN_COUNT=$(python3 - "$ORDERS_OUT" "$LAB_NAME" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = sys.argv[2]
orders = data.get('orders') or []
count = sum(1 for o in orders if o.get('test_name') == target)
print(count)
PYEOF
)
if [ "$ORPHAN_COUNT" = "0" ]; then
    pass "Bulk PUT cascade-cleaned investigation_orders for removed labs"
else
    fail "Bulk PUT left $ORPHAN_COUNT orphan investigation_orders rows"
fi

# ── 3. DELETE cascades to investigation_orders ─────────────────────────────
section "DELETE /cases/:id/labs/:labId cascades orphans"

# Reseed the audit lab via POST (UPSERT will create since PUT removed it).
curl -s -X POST "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' \
    --data-binary "@$LAB_PAYLOAD_1" > "$POST1_OUT"
LAB_ID_RESEED=$(json_get "$POST1_OUT" "id")

curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-labs" \
    -H 'Content-Type: application/json' \
    -d "{\"lab_ids\":[$LAB_ID_RESEED]}" > "$ORDER1_OUT"

DEL_OUT="$OUT/del.json"
curl -s -X DELETE "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs/$LAB_ID_RESEED" > "$DEL_OUT"
ORPHANS_REMOVED=$(json_get "$DEL_OUT" "orphan_orders_removed")
if [ -n "$ORPHANS_REMOVED" ] && [ "$ORPHANS_REMOVED" != "0" ]; then
    pass "DELETE /labs/:id reported orphan_orders_removed=$ORPHANS_REMOVED"
else
    fail "DELETE /labs/:id did not report orphan cleanup, got: $(cat "$DEL_OUT")"
fi

# Confirm no orders for this lab remain.
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/orders" > "$ORDERS_OUT"
DEL_ORPHAN_COUNT=$(python3 - "$ORDERS_OUT" "$LAB_ID_RESEED" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = int(sys.argv[2])
orders = data.get('orders') or []
count = sum(1 for o in orders if o.get('investigation_id') == target)
print(count)
PYEOF
)
if [ "$DEL_ORPHAN_COUNT" = "0" ]; then
    pass "investigation_orders contains 0 rows for the deleted lab"
else
    fail "investigation_orders still has $DEL_ORPHAN_COUNT rows for the deleted lab"
fi

# ── 4. /order-labs idempotency ─────────────────────────────────────────────
section "POST /sessions/:id/order-labs is idempotent"

# Reseed lab + order it once, then re-order — second call should report
# skipped_duplicates and the orders count for that lab should stay at 1.
curl -s -X POST "${AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' \
    --data-binary "@$LAB_PAYLOAD_1" > "$POST1_OUT"
LAB_ID_DUP=$(json_get "$POST1_OUT" "id")

curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-labs" \
    -H 'Content-Type: application/json' \
    -d "{\"lab_ids\":[$LAB_ID_DUP]}" > "$ORDER1_OUT" || true

ORDER2_OUT="$OUT/order2.json"
curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-labs" \
    -H 'Content-Type: application/json' \
    -d "{\"lab_ids\":[$LAB_ID_DUP]}" > "$ORDER2_OUT"

SKIPPED=$(json_get "$ORDER2_OUT" "skipped_duplicates")
if [ "$SKIPPED" = "1" ]; then
    pass "Re-order returned skipped_duplicates=1"
else
    fail "Re-order did not report skipped_duplicates=1, got: $(cat "$ORDER2_OUT")"
fi

# Cross-check: only ONE row in investigation_orders for this lab+session.
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/orders" > "$ORDERS_OUT"
DUP_COUNT=$(python3 - "$ORDERS_OUT" "$LAB_ID_DUP" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = int(sys.argv[2])
count = sum(1 for o in (data.get('orders') or []) if o.get('investigation_id') == target)
print(count)
PYEOF
)
if [ "$DUP_COUNT" = "1" ]; then
    pass "investigation_orders has exactly 1 row for re-ordered lab"
else
    fail "investigation_orders has $DUP_COUNT rows (expected 1)"
fi

# ── 5. /order-radiology idempotency ────────────────────────────────────────
section "POST /sessions/:id/order-radiology is idempotent on (session, test_name)"

# Get available radiology, pick the first study id.
RADAVAIL_OUT="$OUT/rad_avail.json"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/available-radiology" > "$RADAVAIL_OUT"
RAD_ID=$(json_get "$RADAVAIL_OUT" "studies.0.id")
RAD_NAME=$(json_get "$RADAVAIL_OUT" "studies.0.name")
if [ -z "$RAD_ID" ]; then
    fail "No radiology studies returned"
else
    pass "Audit radiology study: id=$RAD_ID, name='$RAD_NAME'"

    # Order once.
    RADORDER1_OUT="$OUT/radorder1.json"
    curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-radiology" \
        -H 'Content-Type: application/json' \
        -d "{\"radiology_ids\":[\"$RAD_ID\"]}" > "$RADORDER1_OUT" || true

    # Re-order — should be skipped.
    RADORDER2_OUT="$OUT/radorder2.json"
    curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/order-radiology" \
        -H 'Content-Type: application/json' \
        -d "{\"radiology_ids\":[\"$RAD_ID\"]}" > "$RADORDER2_OUT"

    RAD_SKIPPED=$(json_get "$RADORDER2_OUT" "skipped_duplicates")
    if [ "$RAD_SKIPPED" = "1" ]; then
        pass "Re-order radiology returned skipped_duplicates=1"
    else
        fail "Re-order radiology did not report skipped_duplicates=1, got: $(cat "$RADORDER2_OUT")"
    fi
fi

# ── End the audit session ──────────────────────────────────────────────────
curl -s -X PUT "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/end" > /dev/null || true

# ── Result ─────────────────────────────────────────────────────────────────
section "Result"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
