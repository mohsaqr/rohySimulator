#!/usr/bin/env bash
# Stage E5 contract audit for response data classification and redaction.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-redaction.sh
#
# Bash 3.2 compatible.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-redaction-audit-XXXXXX")
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

assert_no_secret() {
    label="$1"
    file="$2"
    secret="$3"
    if grep -q "$secret" "$file"; then
        fail "$label leaked secret marker '$secret'"
    else
        pass "$label does not leak raw secret"
    fi
}

assert_has_redacted() {
    label="$1"
    file="$2"
    if grep -q "\\[redacted\\]" "$file"; then
        pass "$label contains [redacted]"
    else
        fail "$label missing [redacted]"
    fi
}

RUN_TAG="redaction-$$-$(date +%s)"
PASSWORD="AuditPass123!"
SECRET_PREF="pref-secret-$RUN_TAG"
SECRET_SESSION="session-secret-$RUN_TAG"
SECRET_AGENT="agent-secret-$RUN_TAG"
SECRET_PLATFORM="platform-secret-$RUN_TAG"

section "Login admin"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin-login-payload.json" "$OUT/admin-login.json")
[ -n "$ADMIN_TOK" ] || { fail "admin login failed"; exit 1; }
ADMIN_ID=$(json_get "$OUT/admin-login.json" "user.id")
pass "Admin logged in"
ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )

section "Create and login student"
STUDENT_USER="student_$RUN_TAG"
STUDENT_EMAIL="$STUDENT_USER@audit.local"
python3 - "$OUT/student-create.json" "$STUDENT_USER" "$STUDENT_EMAIL" "$PASSWORD" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "username": sys.argv[2],
        "name": "Redaction Student",
        "email": sys.argv[3],
        "password": sys.argv[4],
        "role": "student"
    }, f)
PYEOF
CODE=$(curl -s -o "$OUT/student-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/student-create.json")
assert_code "Admin creates student" "201" "$CODE"
STUDENT_ID=$(json_get "$OUT/student-create-response.json" "user.id")

STUDENT_TOK=$(login "$STUDENT_USER" "$PASSWORD" "$OUT/student-login-payload.json" "$OUT/student-login.json")
[ -n "$STUDENT_TOK" ] || { fail "student login failed"; exit 1; }
pass "Student logged in"
STUDENT_AUTH=( -H "Authorization: Bearer $STUDENT_TOK" )

section "PII policy on user reads"
python3 - "$OUT/student-profile.json" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "name": "Redaction Student",
        "institution": "Audit University",
        "address": "123 Audit Street",
        "phone": "+15551234567",
        "alternative_email": "alt-redaction@audit.local",
        "education": "MD",
        "grade": "G2"
    }, f)
PYEOF
curl -s -X PUT "${STUDENT_AUTH[@]}" "$API/api/user/profile" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/student-profile.json" > "$OUT/student-profile-response.json"

curl -s "${ADMIN_AUTH[@]}" "$API/api/users/$STUDENT_ID" > "$OUT/admin-user-read.json"
ADMIN_EMAIL=$(json_get "$OUT/admin-user-read.json" "user.email")
if [ "$ADMIN_EMAIL" = "$STUDENT_EMAIL" ]; then
    pass "Admin user read keeps permitted PII"
else
    fail "Admin user read did not include expected email"
fi

CODE=$(curl -s -o "$OUT/student-cross-user.json" -w "%{http_code}" "${STUDENT_AUTH[@]}" "$API/api/users/$ADMIN_ID")
assert_code "Student cross-user /users/:id is forbidden" "403" "$CODE"

section "GET /users/preferences redacts default_llm_settings"
python3 - "$OUT/prefs-put.json" "$SECRET_PREF" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "theme": "dark",
        "language": "en",
        "default_llm_settings": {
            "provider": "openai",
            "model": "gpt-test",
            "apiKey": sys.argv[2],
            "api_key": sys.argv[2] + "-snake"
        },
        "notification_settings": {"email": True}
    }, f)
PYEOF
curl -s -X PUT "${STUDENT_AUTH[@]}" "$API/api/users/preferences" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/prefs-put.json" > "$OUT/prefs-put-response.json"
curl -s "${STUDENT_AUTH[@]}" "$API/api/users/preferences" > "$OUT/prefs-get.json"
assert_no_secret "GET /users/preferences" "$OUT/prefs-get.json" "$SECRET_PREF"
assert_has_redacted "GET /users/preferences" "$OUT/prefs-get.json"

section "Session JSON settings redaction"
curl -s "${STUDENT_AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "no case available"; exit 1; }
python3 - "$OUT/session-create.json" "$CASE_ID" "$SECRET_SESSION" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "case_id": int(sys.argv[2]),
        "student_name": "Redaction Student",
        "llm_settings": {
            "provider": "openai",
            "model": "gpt-test",
            "apiKey": sys.argv[3]
        },
        "monitor_settings": {"hr": 80}
    }, f)
PYEOF
curl -s -X POST "${STUDENT_AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/session-create.json" > "$OUT/session-create-response.json"
SESSION_ID=$(json_get "$OUT/session-create-response.json" "id")
[ -n "$SESSION_ID" ] || { fail "session create failed"; exit 1; }

curl -s "${STUDENT_AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$OUT/session-get.json"
assert_no_secret "GET /sessions/:id" "$OUT/session-get.json" "$SECRET_SESSION"
assert_has_redacted "GET /sessions/:id" "$OUT/session-get.json"

curl -s "${STUDENT_AUTH[@]}" "$API/api/analytics/sessions/$SESSION_ID" > "$OUT/analytics-session-get.json"
assert_no_secret "GET /analytics/sessions/:id" "$OUT/analytics-session-get.json" "$SECRET_SESSION"
assert_has_redacted "GET /analytics/sessions/:id" "$OUT/analytics-session-get.json"

section "Agent template secret redaction"
python3 - "$OUT/agent-create.json" "$RUN_TAG" "$SECRET_AGENT" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "agent_type": "audit_redaction",
        "name": "Redaction Template " + sys.argv[2],
        "system_prompt": "Audit-only template.",
        "llm_provider": "openai",
        "llm_model": "gpt-test",
        "llm_api_key": sys.argv[3],
        "config": {}
    }, f)
PYEOF
CODE=$(curl -s -o "$OUT/agent-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/agents/templates" -H 'Content-Type: application/json' --data-binary "@$OUT/agent-create.json")
assert_code "Admin creates agent template with key" "201" "$CODE"
AGENT_ID=$(json_get "$OUT/agent-create-response.json" "id")

curl -s "${ADMIN_AUTH[@]}" "$API/api/agents/templates/$AGENT_ID" > "$OUT/agent-get.json"
assert_no_secret "GET /agents/templates/:id" "$OUT/agent-get.json" "$SECRET_AGENT"
assert_has_redacted "GET /agents/templates/:id" "$OUT/agent-get.json"

section "Platform settings key-aware redaction"
python3 - "$OUT/platform-llm-put.json" "$SECRET_PLATFORM" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "provider": "openai",
        "model": "gpt-test",
        "apiKey": sys.argv[2]
    }, f)
PYEOF
curl -s -X PUT "${ADMIN_AUTH[@]}" "$API/api/platform-settings/llm" \
    -H 'Content-Type: application/json' --data-binary "@$OUT/platform-llm-put.json" > "$OUT/platform-llm-put-response.json"
curl -s "${ADMIN_AUTH[@]}" "$API/api/platform-settings" > "$OUT/platform-settings.json"
assert_no_secret "GET /platform-settings" "$OUT/platform-settings.json" "$SECRET_PLATFORM"
assert_has_redacted "GET /platform-settings" "$OUT/platform-settings.json"

section "Active session token redaction"
curl -s "${ADMIN_AUTH[@]}" "$API/api/admin/active-sessions" > "$OUT/active-sessions.json"
TOKEN_HASH_PRESENT=$(python3 - "$OUT/active-sessions.json" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
print('1' if any('token_hash' in row for row in data.get('sessions', [])) else '0')
PYEOF
)
if [ "$TOKEN_HASH_PRESENT" = "0" ]; then
    pass "GET /admin/active-sessions omits token_hash"
else
    fail "GET /admin/active-sessions exposed token_hash"
fi

section "Streaming proxy remains outside response interception"
if grep -q "res\\.json" "$OUT/session-get.json" 2>/dev/null; then
    :
fi
if grep -q "req.path.startsWith('/proxy/llm')" server/routes.js && ! grep -q "res.json = " server/routes.js; then
    pass "No res.json interceptor installed; /proxy/llm streaming path remains untouched"
else
    fail "Streaming proxy sanity check failed"
fi

section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
