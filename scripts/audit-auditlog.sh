#!/usr/bin/env bash
# End-to-end audit for Stage E4 system_audit_log coverage.
#
# Run while the API server is up:
#   bash scripts/audit-auditlog.sh
#
# Bash 3.2 compatible. Failed authorization attempts are not audit-logged in
# E4; only successful sensitive reads/writes create system_audit_log rows.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
STUDENT_USER="${ROHY_STUDENT_USER:-student}"
STUDENT_PASS="${ROHY_STUDENT_PASS:-student123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-auditlog-audit-XXXXXX")
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

login() {
    python3 - "$3" "$1" "$2" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"username": sys.argv[2], "password": sys.argv[3]}, f)
PYEOF
    curl -s -X POST "$API/api/auth/login" \
        -H 'Content-Type: application/json' \
        --data-binary "@$3" > "$4"
    json_get "$4" "token"
}

write_json() {
    python3 - "$@" <<'PYEOF'
import json, sys
kind, path, tag = sys.argv[1], sys.argv[2], sys.argv[3]
if kind == 'case':
    data = {
        "name": "AuditLog Case " + tag,
        "description": "Stage E4 audit case",
        "system_prompt": "You are a simulated patient.",
        "config": {
            "demographics": {"name": "Audit Patient " + tag, "age": 51, "gender": "Other"},
            "chiefComplaint": "Audit logging",
            "initialVitals": {"hr": 82, "spo2": 98, "rr": 16}
        },
        "scenario": None
    }
elif kind == 'monitor':
    data = {"showTimer": True, "showECG": True, "showSpO2": True, "showBP": True, "showRR": True, "showTemp": True, "showCO2": True, "showPleth": True, "showNumerics": True}
elif kind == 'scenario':
    data = {
        "name": "AuditLog Scenario " + tag,
        "description": "Stage E4 audit scenario",
        "duration_minutes": 5,
        "category": "Audit",
        "is_public": False,
        "timeline": [{"time": 0, "params": {"hr": 80}, "rhythm": "NSR"}]
    }
elif kind == 'med':
    data = {
        "medication_code": "auditlog-" + tag,
        "generic_name": "AuditLogMed " + tag,
        "brand_names": [],
        "drug_class": "Audit",
        "category": "Audit",
        "route": "iv",
        "typical_dose": "1",
        "dose_unit": "mg",
        "frequency": "once",
        "indications": ["audit"],
        "contraindications": [],
        "side_effects": [],
        "is_controlled": False,
        "is_high_alert": False
    }
elif kind == 'prefs':
    data = {"prefs": {"minSeverity": "warning", "audioMuted": True, "toastMaxVisible": 3}}
else:
    raise SystemExit("unknown payload kind " + kind)
with open(path, 'w') as f:
    json.dump(data, f)
PYEOF
}

fetch_action() {
    curl -s "${ADMIN_AUTH[@]}" "$API/api/system-audit-log?action=$1&limit=20" > "$2"
}

assert_log() {
    label="$1"
    action="$2"
    resource_id="$3"
    want_old="$4"
    want_new="$5"
    out="$OUT/log-${action}.json"
    code=1
    tries=0
    while [ "$tries" -lt 10 ]; do
        fetch_action "$action" "$out"
        if python3 - "$out" "$resource_id" "$want_old" "$want_new" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
rid, want_old, want_new = sys.argv[2], sys.argv[3] == 'yes', sys.argv[4] == 'yes'
logs = data.get('logs') or []
match = None
for row in logs:
    if rid == '*' or str(row.get('resource_id')) == rid:
        match = row
        break
if not match:
    sys.exit(1)
if want_old and not match.get('old_value'):
    sys.exit(2)
if want_new and not match.get('new_value'):
    sys.exit(3)
PYEOF
        then
            code=0
            break
        else
            code=$?
            tries=$((tries+1))
            sleep 0.2
        fi
    done
    if [ "$code" = "0" ]; then
        pass "$label logged $action"
    elif [ "$code" = "2" ]; then
        fail "$label missing old_value for $action"
    elif [ "$code" = "3" ]; then
        fail "$label missing new_value for $action"
    else
        fail "$label missing audit row for $action resource=$resource_id"
    fi
}

assert_no_student_log_after_failed_write() {
    before_file="$1"
    after_file="$2"
    student_id="$3"
    if python3 - "$before_file" "$after_file" "$student_id" <<'PYEOF'
import json, sys
def ids(path, user_id):
    with open(path) as f:
        rows = (json.load(f).get('logs') or [])
    return {r.get('id') for r in rows if str(r.get('user_id')) == str(user_id)}
before = ids(sys.argv[1], sys.argv[3])
after = ids(sys.argv[2], sys.argv[3])
if after - before:
    sys.exit(1)
PYEOF
    then
        pass "Non-admin failed platform write did not create an audit row"
    else
        fail "Non-admin failed platform write unexpectedly created an audit row"
    fi
}

RUN_TAG="e4-$$-$(date +%s)"

section "Login seeded users"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin-login-payload.json" "$OUT/admin-login.json")
STUDENT_TOK=$(login "$STUDENT_USER" "$STUDENT_PASS" "$OUT/student-login-payload.json" "$OUT/student-login.json")
[ -n "$ADMIN_TOK" ] || { fail "Admin login failed"; exit 1; }
[ -n "$STUDENT_TOK" ] || { fail "Student login failed"; exit 1; }
STUDENT_ID=$(json_get "$OUT/student-login.json" "user.id")
ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
STUDENT_AUTH=( -H "Authorization: Bearer $STUDENT_TOK" )
pass "Seeded users logged in"

section "Representative successful mutations"
write_json case "$OUT/case.json" "$RUN_TAG"
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/cases" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/case.json" > "$OUT/case-create.json"
CASE_ID=$(json_get "$OUT/case-create.json" "id")
[ -n "$CASE_ID" ] && pass "Created case id=$CASE_ID" || fail "Case create returned no id"
assert_log "Case create" "CREATE_CASE" "$CASE_ID" "no" "yes"

write_json monitor "$OUT/monitor.json" "$RUN_TAG"
curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/platform-settings/monitor" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/monitor.json" > "$OUT/monitor-put.json"
assert_log "Platform monitor settings" "update_platform_monitor_settings" "monitor_showTimer" "yes" "yes"

write_json scenario "$OUT/scenario.json" "$RUN_TAG"
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/scenarios" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/scenario.json" > "$OUT/scenario-create.json"
SCENARIO_ID=$(json_get "$OUT/scenario-create.json" "id")
[ -n "$SCENARIO_ID" ] && pass "Created scenario id=$SCENARIO_ID" || fail "Scenario create returned no id"
assert_log "Scenario create" "create_scenario" "$SCENARIO_ID" "no" "yes"
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/scenarios/$SCENARIO_ID" > "$OUT/scenario-delete.json"
assert_log "Scenario delete" "delete_scenario" "$SCENARIO_ID" "yes" "no"

curl -s "${ADMIN_AUTH[@]}" "$API/api/agents/templates" > "$OUT/templates.json"
TEMPLATE_ID=$(python3 - "$OUT/templates.json" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for t in data.get('templates') or []:
    if t.get('is_default'):
        print(t.get('id'))
        break
PYEOF
)
[ -n "$TEMPLATE_ID" ] && pass "Using default agent template id=$TEMPLATE_ID" || fail "No default agent template found"
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/agents/templates/$TEMPLATE_ID/reset-to-default" > "$OUT/template-reset.json"
assert_log "Agent template reset" "reset_agent_template_to_default" "$TEMPLATE_ID" "yes" "yes"

write_json med "$OUT/med.json" "$RUN_TAG"
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/master/medications" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/med.json" > "$OUT/med-create.json"
MED_ID=$(json_get "$OUT/med-create.json" "id")
[ -n "$MED_ID" ] && pass "Created medication id=$MED_ID" || fail "Medication create returned no id"
assert_log "Medication create" "create_master_medication" "$MED_ID" "no" "yes"
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/master/medications/$MED_ID" > "$OUT/med-delete.json"
assert_log "Medication delete" "delete_master_medication" "$MED_ID" "yes" "no"

write_json prefs "$OUT/prefs.json" "$RUN_TAG"
curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/notification-prefs" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/prefs.json" > "$OUT/prefs-put.json"
assert_log "Notification preferences" "update_notification_preferences" "$(json_get "$OUT/admin-login.json" "user.id")" "yes" "yes"

section "Failed write policy"
fetch_action "update_platform_monitor_settings" "$OUT/monitor-before-fail.json"
HTTP=$(curl -s -o "$OUT/student-monitor-put.json" -w "%{http_code}" \
    -X PUT "${STUDENT_AUTH[@]}" "$API/api/platform-settings/monitor" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/monitor.json")
if [ "$HTTP" = "403" ]; then
    pass "Student platform write denied with 403"
else
    fail "Student platform write returned $HTTP (expected 403)"
fi
fetch_action "update_platform_monitor_settings" "$OUT/monitor-after-fail.json"
assert_no_student_log_after_failed_write "$OUT/monitor-before-fail.json" "$OUT/monitor-after-fail.json" "$STUDENT_ID"

section "Summary"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "audit-auditlog.sh: %s/%s passing\n" "$PASS_COUNT" "$TOTAL"
    exit 0
fi
printf "audit-auditlog.sh: %s/%s passing\nFailures:%s\n" "$PASS_COUNT" "$TOTAL" "$FAILURES"
exit 1
