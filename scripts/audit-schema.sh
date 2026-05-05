#!/usr/bin/env bash
# End-to-end schema integrity audit for Stage E1.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-schema.sh
#
# Bash 3.2 compatible. Uses temp files for JSON payloads/responses so heredocs
# never compete with curl pipes for stdin.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
DB_PATH="${ROHY_DB:-$(cd "$(dirname "$0")/.." && pwd)/server/database.sqlite}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-schema-audit-XXXXXX")
trap '[ -n "${ROHY_AUDIT_KEEP:-}" ] || rm -rf "$OUT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""
RUN_MARKER="audit-run-$$-$(date +%s)"

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  \033[31m✗\033[0m %s\n" "$1"; }
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

json_get() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
cur = data
for part in sys.argv[2].split('.'):
    if cur is None:
        break
    if part.isdigit():
        try:
            cur = cur[int(part)]
        except (IndexError, TypeError):
            cur = None
    else:
        cur = cur.get(part) if isinstance(cur, dict) else None
print('' if cur is None else cur)
PYEOF
}

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

db_exec() {
    node --input-type=module - "$DB_PATH" "$1" "${@:2}" <<'NODEEOF'
import sqlite3 from 'sqlite3';
const [dbPath, sql, ...params] = process.argv.slice(2);
const db = new sqlite3.Database(dbPath);
db.run(sql, params, function(err) {
  if (err) {
    console.error(err.message);
    process.exit(2);
  }
  console.log(this.lastID || this.changes || 0);
  db.close();
});
NODEEOF
}

section "Login admin"
curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" > "$OUT/admin-login.json"
ADMIN_TOK=$(json_get "$OUT/admin-login.json" "token")
[ -n "$ADMIN_TOK" ] || { fail "Admin login failed"; exit 1; }
pass "Admin logged in"
ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )

section "Pick case"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "No case returned by /api/cases"; exit 1; }
pass "case_id=$CASE_ID"

section "case_investigations delete cleans investigation_orders"
LAB_NAME="SchemaAuditLab-$RUN_MARKER"
LAB_PAYLOAD="$OUT/lab.json"
python3 - "$LAB_PAYLOAD" "$LAB_NAME" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "test_name": sys.argv[2],
        "test_group": "Schema Audit",
        "min_value": 1,
        "max_value": 10,
        "current_value": 5,
        "unit": "x",
        "turnaround_minutes": 1
    }, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/cases/$CASE_ID/labs" \
    -H 'Content-Type: application/json' --data-binary "@$LAB_PAYLOAD" > "$OUT/lab-create.json"
LAB_ID=$(json_get "$OUT/lab-create.json" "id")
[ -n "$LAB_ID" ] || fail "Lab create returned no id"

curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"SchemaAudit\"}" > "$OUT/lab-session.json"
LAB_SESSION_ID=$(json_get "$OUT/lab-session.json" "id")
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions/$LAB_SESSION_ID/order-labs" \
    -H 'Content-Type: application/json' -d "{\"lab_ids\":[$LAB_ID]}" > "$OUT/lab-order.json"
BEFORE_ORDERS=$(db_scalar "SELECT COUNT(*) FROM investigation_orders WHERE investigation_id = ?" "$LAB_ID")
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/cases/$CASE_ID/labs/$LAB_ID" > "$OUT/lab-delete.json"
AFTER_ORDERS=$(db_scalar "SELECT COUNT(*) FROM investigation_orders WHERE investigation_id = ?" "$LAB_ID")
if [ "$BEFORE_ORDERS" -gt 0 ] && [ "$AFTER_ORDERS" = "0" ]; then
    pass "DELETE /cases/:caseId/labs/:labId removed dependent investigation_orders"
else
    fail "Lab delete cleanup failed (before=$BEFORE_ORDERS after=$AFTER_ORDERS)"
fi

section "agent_templates delete cleans case_agents"
AGENT_PAYLOAD="$OUT/agent.json"
python3 - "$AGENT_PAYLOAD" "$RUN_MARKER" <<'PYEOF'
import json, sys
marker = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump({
        "agent_type": "schema_audit",
        "name": f"Schema Agent {marker}",
        "system_prompt": "Schema audit temporary agent.",
        "config": {}
    }, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/agents/templates" \
    -H 'Content-Type: application/json' --data-binary "@$AGENT_PAYLOAD" > "$OUT/agent-create.json"
AGENT_TEMPLATE_ID=$(json_get "$OUT/agent-create.json" "id")
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/cases/$CASE_ID/agents" \
    -H 'Content-Type: application/json' \
    -d "{\"agent_template_id\":$AGENT_TEMPLATE_ID,\"enabled\":true}" > "$OUT/case-agent-create.json"
BEFORE_CASE_AGENTS=$(db_scalar "SELECT COUNT(*) FROM case_agents WHERE agent_template_id = ?" "$AGENT_TEMPLATE_ID")
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/agents/templates/$AGENT_TEMPLATE_ID" > "$OUT/agent-delete.json"
AFTER_CASE_AGENTS=$(db_scalar "SELECT COUNT(*) FROM case_agents WHERE agent_template_id = ?" "$AGENT_TEMPLATE_ID")
if [ "$BEFORE_CASE_AGENTS" -gt 0 ] && [ "$AFTER_CASE_AGENTS" = "0" ]; then
    pass "DELETE /agents/templates/:id removed dependent case_agents"
else
    fail "Agent template cleanup failed (before=$BEFORE_CASE_AGENTS after=$AFTER_CASE_AGENTS)"
fi

section "patient_record delete cleans events and document"
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"SchemaRecordAudit\"}" > "$OUT/record-session.json"
RECORD_SESSION_ID=$(json_get "$OUT/record-session.json" "id")
RECORD_ID="record-$RUN_MARKER"
RECORD_PAYLOAD="$OUT/patient-record.json"
python3 - "$RECORD_PAYLOAD" "$RECORD_SESSION_ID" "$RECORD_ID" "$RUN_MARKER" <<'PYEOF'
import json, sys
session_id = int(sys.argv[2])
record_id = sys.argv[3]
marker = sys.argv[4]
with open(sys.argv[1], 'w') as f:
    json.dump({
        "session_id": session_id,
        "record_id": record_id,
        "patient_info": {"name": "Schema Audit"},
        "current_state": {"marker": marker},
        "events_count": 1,
        "document": {"audit": marker},
        "events": [{
            "id": f"event-{marker}",
            "verb": "NOTED",
            "time": 1,
            "category": "audit",
            "content": "schema audit"
        }]
    }, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/patient-record/sync" \
    -H 'Content-Type: application/json' --data-binary "@$RECORD_PAYLOAD" > "$OUT/record-sync.json"
BEFORE_RECORD_EVENTS=$(db_scalar "SELECT COUNT(*) FROM patient_record_events WHERE session_id = ?" "$RECORD_SESSION_ID")
BEFORE_RECORD_DOCS=$(db_scalar "SELECT COUNT(*) FROM patient_record_documents WHERE session_id = ?" "$RECORD_SESSION_ID")
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/patient-record/$RECORD_SESSION_ID" > "$OUT/record-delete.json"
AFTER_RECORD_EVENTS=$(db_scalar "SELECT COUNT(*) FROM patient_record_events WHERE session_id = ?" "$RECORD_SESSION_ID")
AFTER_RECORD_DOCS=$(db_scalar "SELECT COUNT(*) FROM patient_record_documents WHERE session_id = ?" "$RECORD_SESSION_ID")
if [ "$BEFORE_RECORD_EVENTS" -gt 0 ] && [ "$BEFORE_RECORD_DOCS" -gt 0 ] && [ "$AFTER_RECORD_EVENTS" = "0" ] && [ "$AFTER_RECORD_DOCS" = "0" ]; then
    pass "DELETE /patient-record/:sessionId removed document and events"
else
    fail "Patient record cleanup failed (events $BEFORE_RECORD_EVENTS->$AFTER_RECORD_EVENTS docs $BEFORE_RECORD_DOCS->$AFTER_RECORD_DOCS)"
fi

section "medications delete cleans/detaches medication children"
MED_PAYLOAD="$OUT/medication.json"
python3 - "$MED_PAYLOAD" "$RUN_MARKER" <<'PYEOF'
import json, sys
marker = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump({
        "medication_code": f"schema-{marker}",
        "generic_name": f"SchemaMed {marker}",
        "drug_class": "Audit",
        "category": "Audit",
        "route": "iv",
        "typical_dose": "1 mg",
        "dose_unit": "mg",
        "frequency": "once"
    }, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/master/medications" \
    -H 'Content-Type: application/json' --data-binary "@$MED_PAYLOAD" > "$OUT/med-create.json"
MED_ID=$(json_get "$OUT/med-create.json" "id")
db_exec "INSERT INTO medication_doses (medication_id, dose_description, dose_value, dose_unit, route) VALUES (?, ?, ?, ?, ?)" "$MED_ID" "Schema dose $RUN_MARKER" "1" "mg" "iv" > /dev/null
db_exec "INSERT INTO treatment_effects (medication_id, treatment_type, treatment_name, route, onset_minutes, peak_minutes, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)" "$MED_ID" "medication" "SchemaMedEffect-$RUN_MARKER" "iv" "1" "2" "3" > /dev/null
db_exec "INSERT INTO case_treatments (case_id, medication_id, treatment_type, treatment_name) VALUES (?, ?, ?, ?)" "$CASE_ID" "$MED_ID" "medication" "SchemaMedCase-$RUN_MARKER" > /dev/null
BEFORE_MED_DEPS=$(db_scalar "SELECT (SELECT COUNT(*) FROM medication_doses WHERE medication_id = ?) + (SELECT COUNT(*) FROM treatment_effects WHERE medication_id = ?) + (SELECT COUNT(*) FROM case_treatments WHERE medication_id = ?)" "$MED_ID" "$MED_ID" "$MED_ID")
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/master/medications/$MED_ID" > "$OUT/med-delete.json"
AFTER_MED_DEPS=$(db_scalar "SELECT (SELECT COUNT(*) FROM medication_doses WHERE medication_id = ?) + (SELECT COUNT(*) FROM treatment_effects WHERE medication_id = ?) + (SELECT COUNT(*) FROM case_treatments WHERE medication_id = ?)" "$MED_ID" "$MED_ID" "$MED_ID")
AFTER_MED=$(db_scalar "SELECT COUNT(*) FROM medications WHERE id = ?" "$MED_ID")
if [ "$BEFORE_MED_DEPS" -gt 0 ] && [ "$AFTER_MED_DEPS" = "0" ] && [ "$AFTER_MED" = "0" ]; then
    pass "DELETE /master/medications/:id removed dose rows and detached medication FKs"
else
    fail "Medication cleanup failed (deps $BEFORE_MED_DEPS->$AFTER_MED_DEPS medication_after=$AFTER_MED)"
fi

section "users delete cleans user-owned rows"
AUDIT_USER="schema-user-$RUN_MARKER"
AUDIT_EMAIL="$AUDIT_USER@example.invalid"
AUDIT_PASS="AuditPass123!"
CREATE_USER_PAYLOAD="$OUT/user-create.json"
python3 - "$CREATE_USER_PAYLOAD" "$AUDIT_USER" "$AUDIT_EMAIL" "$AUDIT_PASS" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "username": sys.argv[2],
        "name": "Schema Audit User",
        "email": sys.argv[3],
        "password": sys.argv[4],
        "role": "user"
    }, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/users/create" \
    -H 'Content-Type: application/json' --data-binary "@$CREATE_USER_PAYLOAD" > "$OUT/user-create-resp.json"
AUDIT_USER_ID=$(json_get "$OUT/user-create-resp.json" "user.id")
curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    --data-binary "@$CREATE_USER_PAYLOAD" > "$OUT/user-login.json" || true
USER_TOK=$(json_get "$OUT/user-login.json" "token")
[ -n "$USER_TOK" ] || fail "Audit user login failed"
USER_AUTH=( -H "Authorization: Bearer $USER_TOK" )

curl -s -X PUT "${USER_AUTH[@]}" "$API/api/users/preferences" \
    -H 'Content-Type: application/json' \
    -d "{\"theme\":\"dark\",\"language\":\"en\",\"default_monitor_settings\":{\"marker\":\"$RUN_MARKER\"}}" > "$OUT/user-prefs.json"
curl -s -X POST "${USER_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"SchemaUserAudit\"}" > "$OUT/user-session.json"
USER_SESSION_ID=$(json_get "$OUT/user-session.json" "id")
curl -s -X PUT "${USER_AUTH[@]}" "$API/api/sessions/$USER_SESSION_ID/discussion-notes" \
    -H 'Content-Type: application/json' \
    -d "{\"note_text\":\"$RUN_MARKER\"}" > "$OUT/user-note.json"

BEFORE_USER_DEPS=$(db_scalar "SELECT (SELECT COUNT(*) FROM user_preferences WHERE user_id = ?) + (SELECT COUNT(*) FROM active_sessions WHERE user_id = ?) + (SELECT COUNT(*) FROM session_notes WHERE user_id = ?)" "$AUDIT_USER_ID" "$AUDIT_USER_ID" "$AUDIT_USER_ID")
curl -s -X DELETE "${ADMIN_AUTH[@]}" "$API/api/users/$AUDIT_USER_ID" > "$OUT/user-delete.json"
AFTER_USER_DEPS=$(db_scalar "SELECT (SELECT COUNT(*) FROM user_preferences WHERE user_id = ?) + (SELECT COUNT(*) FROM active_sessions WHERE user_id = ?) + (SELECT COUNT(*) FROM session_notes WHERE user_id = ?)" "$AUDIT_USER_ID" "$AUDIT_USER_ID" "$AUDIT_USER_ID")
AFTER_USER=$(db_scalar "SELECT COUNT(*) FROM users WHERE id = ?" "$AUDIT_USER_ID")
if [ "$BEFORE_USER_DEPS" -gt 0 ] && [ "$AFTER_USER_DEPS" = "0" ] && [ "$AFTER_USER" = "0" ]; then
    pass "DELETE /users/:id removed user-owned preferences, active sessions, and notes"
else
    fail "User cleanup failed (deps $BEFORE_USER_DEPS->$AFTER_USER_DEPS user_after=$AFTER_USER)"
fi

section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
fi

printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
printf "\nFailures:%s\n" "$FAILURES"
exit 1
