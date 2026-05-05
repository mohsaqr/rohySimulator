#!/usr/bin/env bash
# End-to-end audit for Stage E6 tenant readiness.
#
# Run while the API server is up:
#   bash scripts/audit-tenant.sh
#
# Bash 3.2 compatible.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${ROHY_API:-http://localhost:3000}"
DB_PATH="${ROHY_DB:-$ROOT/server/database.sqlite}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-tenant-audit-XXXXXX")
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

assert_absent() {
    label="$1"
    needle="$2"
    file="$3"
    if grep -q "$needle" "$file"; then
        fail "$label leaked $needle"
    else
        pass "$label"
    fi
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
    python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
name = sys.argv[2]
tenant_id = int(sys.argv[3]) if sys.argv[3] else None
payload = {
    "name": name,
    "description": "Tenant audit case",
    "system_prompt": "You are a simulated patient.",
    "config": {
        "demographics": {"name": name, "age": 50, "gender": "Other"},
        "chiefComplaint": "Tenant audit",
        "initialVitals": {"hr": 80, "spo2": 98, "rr": 16}
    },
    "scenario": None
}
if tenant_id is not None:
    payload["tenant_id"] = tenant_id
with open(sys.argv[1], 'w') as f:
    json.dump(payload, f)
PYEOF
}

section "Schema assertions"
DEFAULT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tenants WHERE slug='default' AND is_default=1;" 2>/dev/null || echo 0)
if [ "$DEFAULT_COUNT" -ge 1 ]; then pass "default tenant row exists"; else fail "default tenant row missing"; fi

CASE_TENANT_INFO=$(sqlite3 "$DB_PATH" "PRAGMA table_info(cases);" | awk -F'|' '$2=="tenant_id"{print $4 ":" $5}')
if [ "$CASE_TENANT_INFO" = "1:1" ]; then pass "cases.tenant_id is NOT NULL DEFAULT 1"; else fail "cases.tenant_id not NOT NULL DEFAULT 1 ($CASE_TENANT_INFO)"; fi

SESSION_TENANT_INFO=$(sqlite3 "$DB_PATH" "PRAGMA table_info(sessions);" | awk -F'|' '$2=="tenant_id"{print $4 ":" $5}')
if [ "$SESSION_TENANT_INFO" = "1:1" ]; then pass "sessions.tenant_id is NOT NULL DEFAULT 1"; else fail "sessions.tenant_id not NOT NULL DEFAULT 1 ($SESSION_TENANT_INFO)"; fi

section "Tenant and user setup"
RUN_TAG="tenant-$$-$(date +%s)"
PASSWORD="TenantPass123!"
ADMIN_TOK=$(login "$ADMIN_USER" "$ADMIN_PASS" "$OUT/admin-login-payload.json" "$OUT/admin-login.json")
[ -n "$ADMIN_TOK" ] || { fail "seeded admin login failed"; exit 1; }
ADMIN_AUTH=( -H "Authorization: Bearer $ADMIN_TOK" )
pass "default tenant admin logged in"

python3 - "$OUT/tenant-create.json" "$RUN_TAG" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"slug": sys.argv[2], "name": "Tenant Audit " + sys.argv[2]}, f)
PYEOF
CODE=$(curl -s -o "$OUT/tenant-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/tenants" -H 'Content-Type: application/json' --data-binary "@$OUT/tenant-create.json")
assert_code "Admin creates second tenant" "201" "$CODE"
TENANT_B_ID=$(json_get "$OUT/tenant-create-response.json" "tenant.id")

USER_B="tenant_b_admin_$RUN_TAG"
write_user_payload "$OUT/user-b-create.json" "$USER_B" "$USER_B@audit.local" "$PASSWORD" "admin"
CODE=$(curl -s -o "$OUT/user-b-create-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/create" -H 'Content-Type: application/json' --data-binary "@$OUT/user-b-create.json")
assert_code "Admin creates future tenant-B admin" "201" "$CODE"
USER_B_ID=$(json_get "$OUT/user-b-create-response.json" "user.id")

python3 - "$OUT/assign-b.json" "$TENANT_B_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"tenant_id": int(sys.argv[2])}, f)
PYEOF
CODE=$(curl -s -o "$OUT/assign-b-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/users/$USER_B_ID/tenant" -H 'Content-Type: application/json' --data-binary "@$OUT/assign-b.json")
assert_code "Admin assignment hook moves user to tenant B" "200" "$CODE"

TENANT_B_TOK=$(login "$USER_B" "$PASSWORD" "$OUT/user-b-login-payload.json" "$OUT/user-b-login.json")
[ -n "$TENANT_B_TOK" ] || { fail "tenant B admin login failed"; exit 1; }
TENANT_B_AUTH=( -H "Authorization: Bearer $TENANT_B_TOK" )
LOGIN_TENANT=$(json_get "$OUT/user-b-login.json" "user.tenant_id")
if [ "$LOGIN_TENANT" = "$TENANT_B_ID" ]; then pass "login token/user payload carries tenant B"; else fail "tenant B login returned tenant_id=$LOGIN_TENANT"; fi

section "Create isolated resources"
CASE_A_NAME="Tenant A Case $RUN_TAG"
CASE_B_NAME="Tenant B Case $RUN_TAG"
write_case_payload "$OUT/case-a.json" "$CASE_A_NAME" ""
write_case_payload "$OUT/case-b.json" "$CASE_B_NAME" ""

CODE=$(curl -s -o "$OUT/case-a-response.json" -w "%{http_code}" -X POST "${ADMIN_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/case-a.json")
assert_code "Tenant A admin creates tenant A case" "200" "$CODE"
CASE_A_ID=$(json_get "$OUT/case-a-response.json" "id")

CODE=$(curl -s -o "$OUT/case-b-response.json" -w "%{http_code}" -X POST "${TENANT_B_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/case-b.json")
assert_code "Tenant B admin creates tenant B case" "200" "$CODE"
CASE_B_ID=$(json_get "$OUT/case-b-response.json" "id")

python3 - "$OUT/session-a.json" "$CASE_A_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"case_id": int(sys.argv[2]), "student_name": "Tenant A Session"}, f)
PYEOF
python3 - "$OUT/session-b.json" "$CASE_B_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"case_id": int(sys.argv[2]), "student_name": "Tenant B Session"}, f)
PYEOF
curl -s -X POST "${ADMIN_AUTH[@]}" "$API/api/sessions" -H 'Content-Type: application/json' --data-binary "@$OUT/session-a.json" > "$OUT/session-a-response.json"
curl -s -X POST "${TENANT_B_AUTH[@]}" "$API/api/sessions" -H 'Content-Type: application/json' --data-binary "@$OUT/session-b.json" > "$OUT/session-b-response.json"
SESSION_A_ID=$(json_get "$OUT/session-a-response.json" "id")
SESSION_B_ID=$(json_get "$OUT/session-b-response.json" "id")
[ -n "$SESSION_A_ID" ] && [ -n "$SESSION_B_ID" ] && pass "sessions created in both tenants" || fail "session creation failed"

section "Tenant isolation checks"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/a-cases.json"
curl -s "${TENANT_B_AUTH[@]}" "$API/api/cases" > "$OUT/b-cases.json"
assert_absent "Tenant A case list cannot see tenant B case" "$CASE_B_NAME" "$OUT/a-cases.json"
assert_absent "Tenant B case list cannot see tenant A case" "$CASE_A_NAME" "$OUT/b-cases.json"

curl -s "${ADMIN_AUTH[@]}" "$API/api/analytics/sessions" > "$OUT/a-sessions.json"
curl -s "${TENANT_B_AUTH[@]}" "$API/api/analytics/sessions" > "$OUT/b-sessions.json"
assert_absent "Tenant A sessions list cannot see tenant B session" "Tenant B Session" "$OUT/a-sessions.json"
assert_absent "Tenant B sessions list cannot see tenant A session" "Tenant A Session" "$OUT/b-sessions.json"

CODE=$(curl -s -o "$OUT/b-read-a-session.json" -w "%{http_code}" "${TENANT_B_AUTH[@]}" "$API/api/sessions/$SESSION_A_ID")
assert_code "Tenant B cannot read tenant A session by id" "404" "$CODE"
CODE=$(curl -s -o "$OUT/a-read-b-session.json" -w "%{http_code}" "${ADMIN_AUTH[@]}" "$API/api/sessions/$SESSION_B_ID")
assert_code "Tenant A admin cannot read tenant B session by id" "404" "$CODE"

curl -s "${ADMIN_AUTH[@]}" "$API/api/admin/active-sessions" > "$OUT/a-active-sessions.json"
assert_absent "Tenant A admin active-session view cannot see tenant B admin" "$USER_B" "$OUT/a-active-sessions.json"

section "Mass assignment guard"
MASS_NAME="Tenant B Mass Assignment $RUN_TAG"
write_case_payload "$OUT/mass-case.json" "$MASS_NAME" "1"
CODE=$(curl -s -o "$OUT/mass-case-response.json" -w "%{http_code}" -X POST "${TENANT_B_AUTH[@]}" \
    "$API/api/cases" -H 'Content-Type: application/json' --data-binary "@$OUT/mass-case.json")
assert_code "Tenant B case create ignores body tenant_id" "200" "$CODE"
curl -s "${ADMIN_AUTH[@]}" "$API/api/cases" > "$OUT/a-cases-after-mass.json"
assert_absent "Tenant A cannot see case created by tenant B with tenant_id=1 body" "$MASS_NAME" "$OUT/a-cases-after-mass.json"

section "Tenant audit coverage"
curl -s "${ADMIN_AUTH[@]}" "$API/api/system-audit-log?action=create_tenant&limit=20" > "$OUT/audit-tenant-create.json"
if grep -q "$RUN_TAG" "$OUT/audit-tenant-create.json"; then pass "tenant create audited"; else fail "tenant create audit row missing"; fi
curl -s "${ADMIN_AUTH[@]}" "$API/api/system-audit-log?action=assign_user_tenant&limit=20" > "$OUT/audit-tenant-assign.json"
# The audit log returns rows with new_value as a stringified JSON column;
# parse it structurally so we don't depend on whether the response
# representation escapes inner quotes.
NEW_VALUE_OK=$(python3 - "$OUT/audit-tenant-assign.json" "$TENANT_B_ID" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
target = int(sys.argv[2])
for row in data.get('logs') or []:
    nv = row.get('new_value')
    if not nv:
        continue
    try:
        parsed = json.loads(nv) if isinstance(nv, str) else nv
    except Exception:
        continue
    if isinstance(parsed, dict) and parsed.get('tenant_id') == target:
        print('1'); sys.exit(0)
print('0')
PYEOF
)
if [ "$NEW_VALUE_OK" = "1" ]; then pass "tenant assignment audited with new tenant_id=$TENANT_B_ID"; else fail "tenant assignment audit row missing tenant_id"; fi

printf "\nTenant audit result: %s passed, %s failed\n" "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
    printf "Failures:%s\n" "$FAILURES"
    exit 1
fi
