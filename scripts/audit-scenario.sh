#!/usr/bin/env bash
# End-to-end audit of the scenario engine fixes shipped in Stage 5.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-scenario.sh
#
# Bash 3.2 compatible. Heredoc + curl-pipe collide on stdin (LEARNINGS.md);
# callers pre-write JSON to temp files.
#
# Asserts (server-side; the runtime engine fixes — snapshot binding, override
# guard, auto-stop on complete — are verified via the browser smoke step):
#   1. POST /scenarios rejects malformed timeline frames (non-numeric `time`,
#      non-numeric params values, non-object frame). Pre-fix the server
#      stored anything; the runtime interpolator hit NaN.
#   2. PUT /scenarios/:id applies the same validation.
#   3. case_snapshot still includes `system_prompt` (Stage 4) and `scenario`
#      (Stage 1) — i.e., the snapshot stays the source of truth.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-scenario-audit-XXXXXX")
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

# ── Login ──────────────────────────────────────────────────────────────────
section "Login admin"
curl -s -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
    > "$OUT/admin.json"
TOK=$(json_get "$OUT/admin.json" "token")
[ -n "$TOK" ] || { fail "Admin login failed"; exit 1; }
pass "Admin logged in"
AUTH=( -H "Authorization: Bearer $TOK" )

# ── 1. POST /scenarios rejects malformed timelines ─────────────────────────
section "POST /scenarios rejects malformed timeline frames"

# 1a. Negative time
BAD_NEG_TIME="$OUT/bad_neg.json"
python3 - "$BAD_NEG_TIME" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": "Audit-NegTime",
        "duration_minutes": 5,
        "timeline": [{"time": -10, "params": {"hr": 80}}]
    }, f)
PYEOF
HTTP=$(curl -s -o "$OUT/bad_neg_resp.json" -w "%{http_code}" \
    -X POST "${AUTH[@]}" "$API/api/scenarios" \
    -H 'Content-Type: application/json' --data-binary "@$BAD_NEG_TIME")
if [ "$HTTP" = "400" ]; then
    pass "Negative time rejected with 400"
else
    fail "Negative time -> $HTTP (expected 400), body: $(cat "$OUT/bad_neg_resp.json")"
fi

# 1b. Non-numeric param value
BAD_PARAM="$OUT/bad_param.json"
python3 - "$BAD_PARAM" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": "Audit-BadParam",
        "duration_minutes": 5,
        "timeline": [{"time": 0, "params": {"hr": "not-a-number"}}]
    }, f)
PYEOF
HTTP=$(curl -s -o "$OUT/bad_param_resp.json" -w "%{http_code}" \
    -X POST "${AUTH[@]}" "$API/api/scenarios" \
    -H 'Content-Type: application/json' --data-binary "@$BAD_PARAM")
if [ "$HTTP" = "400" ]; then
    pass "Non-numeric param value rejected with 400"
else
    fail "Non-numeric param -> $HTTP (expected 400), body: $(cat "$OUT/bad_param_resp.json")"
fi

# 1c. Frame is not an object
BAD_SHAPE="$OUT/bad_shape.json"
python3 - "$BAD_SHAPE" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": "Audit-BadShape",
        "duration_minutes": 5,
        "timeline": ["not-a-frame"]
    }, f)
PYEOF
HTTP=$(curl -s -o "$OUT/bad_shape_resp.json" -w "%{http_code}" \
    -X POST "${AUTH[@]}" "$API/api/scenarios" \
    -H 'Content-Type: application/json' --data-binary "@$BAD_SHAPE")
if [ "$HTTP" = "400" ]; then
    pass "Non-object frame rejected with 400"
else
    fail "Non-object frame -> $HTTP (expected 400), body: $(cat "$OUT/bad_shape_resp.json")"
fi

# 1d. Sanity: a valid scenario still creates (200)
GOOD="$OUT/good.json"
python3 - "$GOOD" <<'PYEOF'
import json, sys, time
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": f"Audit-Good-{int(time.time())}",
        "duration_minutes": 5,
        "category": "Audit",
        "timeline": [
            {"time": 0, "params": {"hr": 80, "spo2": 98}, "rhythm": "NSR"},
            {"time": 60, "params": {"hr": 100}, "rhythm": "NSR"}
        ]
    }, f)
PYEOF
curl -s -X POST "${AUTH[@]}" "$API/api/scenarios" \
    -H 'Content-Type: application/json' \
    --data-binary "@$GOOD" > "$OUT/good_resp.json"
NEW_ID=$(json_get "$OUT/good_resp.json" "id")
if [ -n "$NEW_ID" ]; then
    pass "Valid scenario accepted (id=$NEW_ID)"
else
    fail "Valid scenario rejected, body: $(cat "$OUT/good_resp.json")"
fi

# ── 2. PUT /scenarios/:id rejects malformed timelines ──────────────────────
section "PUT /scenarios/:id rejects malformed timeline frames"

if [ -n "$NEW_ID" ]; then
    BAD_PUT="$OUT/bad_put.json"
    python3 - "$BAD_PUT" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": "Audit-BadPut",
        "duration_minutes": 5,
        "timeline": [{"time": 0, "params": {"hr": "still-bad"}}]
    }, f)
PYEOF
    HTTP=$(curl -s -o "$OUT/bad_put_resp.json" -w "%{http_code}" \
        -X PUT "${AUTH[@]}" "$API/api/scenarios/$NEW_ID" \
        -H 'Content-Type: application/json' --data-binary "@$BAD_PUT")
    if [ "$HTTP" = "400" ]; then
        pass "PUT non-numeric param rejected with 400 (mirrors POST)"
    else
        fail "PUT non-numeric param -> $HTTP (expected 400), body: $(cat "$OUT/bad_put_resp.json")"
    fi

    # Cleanup the test scenario (best-effort)
    curl -s -X DELETE "${AUTH[@]}" "$API/api/scenarios/$NEW_ID" > /dev/null || true
fi

# ── 3. case_snapshot still carries scenario + system_prompt ────────────────
section "POST /sessions captures scenario + system_prompt into case_snapshot"

curl -s "${AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "No cases"; exit 1; }

curl -s -X POST "${AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"ScenAudit\"}" \
    > "$OUT/session.json"
SESSION_ID=$(json_get "$OUT/session.json" "id")
[ -n "$SESSION_ID" ] || { fail "Session create failed"; exit 1; }

curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$OUT/session_get.json"
HAS_KEYS=$(python3 - "$OUT/session_get.json" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
snap = data.get('session', {}).get('case_snapshot') or ''
try:
    parsed = json.loads(snap) if isinstance(snap, str) else snap
except Exception:
    parsed = {}
ok = isinstance(parsed, dict) and 'scenario' in parsed and 'system_prompt' in parsed
print('1' if ok else '0')
PYEOF
)
if [ "$HAS_KEYS" = "1" ]; then
    pass "case_snapshot has both scenario + system_prompt keys"
else
    fail "case_snapshot missing scenario or system_prompt key"
fi

curl -s -X PUT "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/end" > /dev/null || true

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
