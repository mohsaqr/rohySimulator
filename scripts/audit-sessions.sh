#!/usr/bin/env bash
# End-to-end audit of session lifecycle wiring shipped in the Stage-1 audit.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-sessions.sh
#
# Exits 0 on full pass, non-zero on any assertion failure. bash 3.2 compatible
# so it works on the macOS default interpreter without a Homebrew install.
#
# Asserts:
#   1. POST /sessions captures a case_snapshot that contains the live case.config
#      (the divided snapshot/live contradiction is fixed: snapshot at start).
#   2. Editing the case after the session has started does NOT change what the
#      session-scoped reader sees (snapshot wins over live).
#   3. PUT /sessions/:id/end is idempotent: a re-call returns the same
#      end_time + duration and reports already_ended:true (was previously
#      overwriting end_time on every call).
#   4. PUT /sessions/:id/end transitions sessions.status to 'completed'
#      (the column existed but was never written).
#   5. POST /sessions/:id/vitals persists a row, GET returns it (round-trip).

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
USER_NAME="${ROHY_AUDIT_USER:-admin}"
PASS_WORD="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-sessions-audit-XXXXXX")
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
    # json_get FILE PYTHON_PATH — reads JSON from file, prints attribute path
    # using python3. Heredoc + curl-pipe collide on stdin (LEARNINGS.md), so
    # callers pre-write the response to a temp file.
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

# ── Login ──────────────────────────────────────────────────────────────────
section "Login"
LOGIN_OUT="$OUT/login.json"
curl -s -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASS_WORD\"}" \
    > "$LOGIN_OUT" || true
TOK=$(json_get "$LOGIN_OUT" "token")
if [ -z "$TOK" ]; then
    fail "Login as $USER_NAME failed — is the API up on $API and the seed admin available?"
    printf "\nFAILURES:%s\n" "$FAILURES"
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
    fail "No cases returned from /api/cases — DB needs seeding"
    printf "\nFAILURES:%s\n" "$FAILURES"
    exit 1
fi
pass "Using case_id=$CASE_ID for the audit"

# ── 1. POST /sessions captures a snapshot ─────────────────────────────────
section "POST /sessions captures case_snapshot"
SESSION_OUT="$OUT/session.json"
curl -s -X POST "${AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"AuditBot\"}" \
    > "$SESSION_OUT"
SESSION_ID=$(json_get "$SESSION_OUT" "id")
if [ -z "$SESSION_ID" ]; then
    fail "Session create returned no id; payload:"; cat "$SESSION_OUT"
else
    pass "Session created: id=$SESSION_ID"
fi

# Read the session via /sessions/:id and confirm case_snapshot is populated.
SESSION_DETAIL_OUT="$OUT/session_detail.json"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$SESSION_DETAIL_OUT"
SNAP_PRESENT=$(json_get "$SESSION_DETAIL_OUT" "session.case_snapshot")
if [ -z "$SNAP_PRESENT" ] || [ "$SNAP_PRESENT" = "None" ]; then
    fail "sessions.case_snapshot is empty — POST /sessions did not capture the snapshot"
else
    pass "case_snapshot is populated on the session row"
fi

# ── 2. Snapshot wins over live mid-session ────────────────────────────────
section "Snapshot wins over live config when admin edits mid-session"
# Build a benign edit payload for the case using the row from the list
# response (no GET /api/cases/:id endpoint exists). We add a marker key the
# runtime path doesn't consume; what we're testing is that THIS run's marker
# does NOT show up in the snapshot of the running session. The marker is
# unique per invocation so prior runs' edits (which persist in the DB) don't
# false-positive this assertion.
RUN_MARKER="audit-run-$$-$(date +%s)"
EDITED_CONFIG_PAYLOAD="$OUT/edited_payload.json"
python3 - "$CASES_OUT" "$CASE_ID" "$EDITED_CONFIG_PAYLOAD" "$RUN_MARKER" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    listing = json.load(f)
cid = int(sys.argv[2])
marker = sys.argv[4]
case = next((c for c in listing.get('cases', []) if c.get('id') == cid), None)
if case is None:
    print('case not found', file=sys.stderr)
    sys.exit(2)
config = case.get('config') or {}
if isinstance(config, str):
    config = json.loads(config or '{}')
config['_audit_marker'] = marker
out = {
    'name': case.get('name'),
    'description': case.get('description'),
    'config': config,
    'scenario': case.get('scenario'),
    'is_available': case.get('is_available'),
    'is_default': case.get('is_default')
}
with open(sys.argv[3], 'w') as f:
    json.dump(out, f)
PYEOF
PUT_OUT="$OUT/put.json"
curl -s -X PUT "${AUTH[@]}" "$API/api/cases/$CASE_ID" \
    -H 'Content-Type: application/json' \
    --data-binary "@$EDITED_CONFIG_PAYLOAD" > "$PUT_OUT" || true

# Re-fetch session and confirm case_snapshot does NOT contain THIS run's marker.
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$SESSION_DETAIL_OUT"
HAS_MARKER=$(python3 - "$SESSION_DETAIL_OUT" "$RUN_MARKER" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
marker = sys.argv[2]
snap_str = data.get('session', {}).get('case_snapshot') or ''
try:
    snap = json.loads(snap_str)
except Exception:
    snap = {}
cfg = (snap or {}).get('config') or {}
print('1' if cfg.get('_audit_marker') == marker else '0')
PYEOF
)
if [ "$HAS_MARKER" = "0" ]; then
    pass "Snapshot is immutable — admin edit did not bleed into the running session"
else
    fail "Snapshot was mutated by mid-session admin edit (live binding leaked through)"
fi

# ── 3. PUT /sessions/:id/end is idempotent ────────────────────────────────
section "PUT /sessions/:id/end is idempotent"
END1_OUT="$OUT/end1.json"
END2_OUT="$OUT/end2.json"
curl -s -X PUT "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/end" > "$END1_OUT"
DUR1=$(json_get "$END1_OUT" "duration")
END_TIME1=$(json_get "$END1_OUT" "end_time")

# Re-call /end. Should report already_ended and preserve the original
# duration / end_time values.
sleep 1
curl -s -X PUT "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/end" > "$END2_OUT"
DUR2=$(json_get "$END2_OUT" "duration")
END_TIME2=$(json_get "$END2_OUT" "end_time")
ALREADY=$(json_get "$END2_OUT" "already_ended")

if [ "$DUR1" = "$DUR2" ] && [ "$END_TIME1" = "$END_TIME2" ] && [ "$ALREADY" = "True" ]; then
    pass "Re-end preserved end_time + duration and reported already_ended:true"
else
    fail "Re-end did NOT preserve end_time/duration (was DUR1=$DUR1 DUR2=$DUR2 ALREADY=$ALREADY)"
fi

# ── 4. /end transitions status to 'completed' ─────────────────────────────
section "Session status transitions to 'completed'"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$SESSION_DETAIL_OUT"
STATUS_AFTER=$(json_get "$SESSION_DETAIL_OUT" "session.status")
if [ "$STATUS_AFTER" = "completed" ]; then
    pass "sessions.status = 'completed' after /end"
else
    fail "sessions.status is '$STATUS_AFTER' after /end (expected 'completed')"
fi

# ── 5. Vitals POST/GET round-trip ─────────────────────────────────────────
section "Vitals persistence round-trip"
# Note: session is already ended, but the vitals endpoint accepts writes
# regardless (vitals are a learner-driven log; the server doesn't gate them
# on session-active). For the trip we just need POST + GET to agree.
VPOST_OUT="$OUT/vitals_post.json"
curl -s -X POST "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/vitals" \
    -H 'Content-Type: application/json' \
    -d '{"hr":98,"spo2":94,"bp_sys":118,"bp_dia":76,"rr":18,"temp":37.2,"source":"audit"}' \
    > "$VPOST_OUT"
VID=$(json_get "$VPOST_OUT" "id")
if [ -z "$VID" ]; then
    fail "POST /vitals returned no id"
else
    pass "POST /vitals stored row id=$VID"
fi

VGET_OUT="$OUT/vitals_get.json"
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID/vitals" > "$VGET_OUT"
GOT_HR=$(python3 - "$VGET_OUT" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
rows = data.get('vitals') or []
audit = [r for r in rows if r.get('source') == 'audit']
print(audit[-1].get('hr') if audit else '')
PYEOF
)
if [ "$GOT_HR" = "98" ] || [ "$GOT_HR" = "98.0" ]; then
    pass "GET /vitals returns the row we just wrote (hr=98)"
else
    fail "GET /vitals did not echo the row (got hr='$GOT_HR')"
fi

# ── Summary ───────────────────────────────────────────────────────────────
printf "\n\033[1mResult:\033[0m %d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
exit 0
