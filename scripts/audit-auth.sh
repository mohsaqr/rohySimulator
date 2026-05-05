#!/usr/bin/env bash
# End-to-end audit of auth + user-prefs fixes shipped in Stage 7.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-auth.sh
#
# Bash 3.2 compatible.
#
# Asserts:
#   1. PUT /users/preferences accepts a default_llm_settings with apiKey.
#   2. GET /users/preferences redacts apiKey from default_llm_settings.

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-auth-audit-XXXXXX")
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

section "GET /users/preferences redacts apiKey"
RUN_TAG="audit-auth-$$-$(date +%s)"
PUT_PAYLOAD="$OUT/prefs.json"
python3 - "$PUT_PAYLOAD" "$RUN_TAG" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({
        "default_llm_settings": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "apiKey": f"sk-test-{sys.argv[2]}-must-not-leak"
        }
    }, f)
PYEOF

curl -s -X PUT "${AUTH[@]}" "$API/api/users/preferences" \
    -H 'Content-Type: application/json' --data-binary "@$PUT_PAYLOAD" > /dev/null
pass "Saved prefs with apiKey"

curl -s "${AUTH[@]}" "$API/api/users/preferences" > "$OUT/prefs_get.json"
LEAKED=$(python3 - "$OUT/prefs_get.json" "$RUN_TAG" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
ls = data.get('default_llm_settings') or ''
try:
    parsed = json.loads(ls) if isinstance(ls, str) else ls
except Exception:
    parsed = {}
ak = parsed.get('apiKey') if isinstance(parsed, dict) else None
# Pass if redacted or empty; fail if it equals the original
if ak == '[redacted]' or ak == '' or ak is None:
    print('0')
elif sys.argv[2] in str(ak):
    print('1')
else:
    print('0')
PYEOF
)
if [ "$LEAKED" = "0" ]; then
    pass "default_llm_settings.apiKey is redacted in GET response"
else
    fail "apiKey leaked in GET /users/preferences (still contains run tag)"
fi

# Restore prefs to clean state (clear the test apiKey)
CLEAR="$OUT/clear.json"
python3 - "$CLEAR" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"default_llm_settings": None}, f)
PYEOF
curl -s -X PUT "${AUTH[@]}" "$API/api/users/preferences" \
    -H 'Content-Type: application/json' --data-binary "@$CLEAR" > /dev/null

section "Result"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\033[32m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
else
    printf "\033[31m%d passed, %d failed\033[0m\n" "$PASS_COUNT" "$FAIL_COUNT"
    printf "\nFailures:%s\n" "$FAILURES"
    exit 1
fi
