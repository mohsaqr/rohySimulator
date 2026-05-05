#!/usr/bin/env bash
# End-to-end audit of the LLM precedence chain shipped in the Stage-4 audit.
#
# Run while the API server is up on :3000:
#   bash scripts/audit-llm.sh
#
# Bash 3.2 compatible. Heredoc + curl-pipe collide on stdin; callers
# pre-write JSON to temp files (LEARNINGS.md).
#
# Asserts:
#   1. agent_templates accepts llm_temperature + llm_max_tokens via PUT and
#      round-trips them on GET. Pre-fix the columns didn't exist; admins
#      could set "temperature" in the UI but the resolver ignored it.
#   2. PUT /agents/templates/:id stores empty/null clears (resolver falls
#      back to platform/session defaults).
#   3. POST /sessions captures `system_prompt` into case_snapshot. Pre-fix
#      it captured config + scenario only, so the chat persona drifted
#      live with admin edits to cases.system_prompt.
#   4. GET /sessions/:id redacts the `apiKey` field from llm_settings JSON
#      (it could carry an API key from user_preferences.default_llm_settings).

set -eo pipefail

API="${ROHY_API:-http://localhost:3000}"
ADMIN_USER="${ROHY_AUDIT_USER:-admin}"
ADMIN_PASS="${ROHY_AUDIT_PASS:-admin123}"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-llm-audit-XXXXXX")
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

# ── 1. Agent template temperature + max_tokens round-trip ──────────────────
section "PUT/GET agent_templates llm_temperature + llm_max_tokens"

# Pick a standard template.
curl -s "${AUTH[@]}" "$API/api/agents/templates" > "$OUT/templates.json"
TPL_ID=$(python3 -c "import json,sys; d=json.load(open('$OUT/templates.json')); ts = d.get('templates') or d; print(ts[0].get('id') if isinstance(ts, list) and ts else (ts.get('templates') and ts.get('templates')[0].get('id')) or '')")
[ -n "$TPL_ID" ] || { fail "No agent templates"; exit 1; }
pass "Using agent template id=$TPL_ID"

# PUT temperature=0.3 + max_tokens=512.
PUT_PAYLOAD="$OUT/put_tpl.json"
python3 - "$PUT_PAYLOAD" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"llm_temperature": 0.3, "llm_max_tokens": 512}, f)
PYEOF

curl -s -X PUT "${AUTH[@]}" "$API/api/agents/templates/$TPL_ID" \
    -H 'Content-Type: application/json' \
    --data-binary "@$PUT_PAYLOAD" > "$OUT/put_tpl_resp.json"

# GET and verify both stored.
curl -s "${AUTH[@]}" "$API/api/agents/templates/$TPL_ID" > "$OUT/tpl_after.json"
T_AFTER=$(json_get "$OUT/tpl_after.json" "llm_temperature")
M_AFTER=$(json_get "$OUT/tpl_after.json" "llm_max_tokens")

if [ "$T_AFTER" = "0.3" ] && [ "$M_AFTER" = "512" ]; then
    pass "Stored llm_temperature=0.3 + llm_max_tokens=512 (round-trip)"
else
    fail "Round-trip failed: temp='$T_AFTER' (want 0.3), max='$M_AFTER' (want 512)"
fi

# Clear with empty strings — should null out so resolver falls back.
CLEAR_PAYLOAD="$OUT/clear_tpl.json"
python3 - "$CLEAR_PAYLOAD" <<'PYEOF'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump({"llm_temperature": "", "llm_max_tokens": ""}, f)
PYEOF
curl -s -X PUT "${AUTH[@]}" "$API/api/agents/templates/$TPL_ID" \
    -H 'Content-Type: application/json' \
    --data-binary "@$CLEAR_PAYLOAD" > /dev/null

curl -s "${AUTH[@]}" "$API/api/agents/templates/$TPL_ID" > "$OUT/tpl_cleared.json"
T_CLEAR=$(json_get "$OUT/tpl_cleared.json" "llm_temperature")
M_CLEAR=$(json_get "$OUT/tpl_cleared.json" "llm_max_tokens")
if [ -z "$T_CLEAR" ] && [ -z "$M_CLEAR" ]; then
    pass "Empty string clears llm_temperature + llm_max_tokens to NULL"
else
    fail "Clear failed: temp='$T_CLEAR', max='$M_CLEAR' (expected both empty)"
fi

# ── 2. case_snapshot includes system_prompt ────────────────────────────────
section "POST /sessions captures system_prompt into case_snapshot"

curl -s "${AUTH[@]}" "$API/api/cases" > "$OUT/cases.json"
CASE_ID=$(json_get "$OUT/cases.json" "cases.0.id")
[ -n "$CASE_ID" ] || { fail "No cases"; exit 1; }

curl -s -X POST "${AUTH[@]}" "$API/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"case_id\":$CASE_ID,\"student_name\":\"LlmAudit\"}" \
    > "$OUT/session.json"
SESSION_ID=$(json_get "$OUT/session.json" "id")
[ -n "$SESSION_ID" ] || { fail "Session create failed"; exit 1; }
pass "Session id=$SESSION_ID created"

# Snapshot should be JSON-decodeable and have a system_prompt key.
curl -s "${AUTH[@]}" "$API/api/sessions/$SESSION_ID" > "$OUT/session_get.json"
HAS_SP=$(python3 - "$OUT/session_get.json" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
snap = data.get('session', {}).get('case_snapshot') or ''
try:
    parsed = json.loads(snap) if isinstance(snap, str) else snap
except Exception:
    parsed = {}
# Even if cases.system_prompt was NULL, the *key* should be present (set to None).
print('1' if isinstance(parsed, dict) and 'system_prompt' in parsed else '0')
PYEOF
)
if [ "$HAS_SP" = "1" ]; then
    pass "case_snapshot includes system_prompt key (chat persona is now snapshot-bound)"
else
    fail "case_snapshot missing system_prompt key — chat persona will still drift"
fi

# ── 3. GET /sessions/:id redacts apiKey from llm_settings ──────────────────
section "GET /sessions/:id redacts apiKey from llm_settings JSON"
REDACTION_OK=$(python3 - "$OUT/session_get.json" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
ls = data.get('session', {}).get('llm_settings') or ''
try:
    parsed = json.loads(ls) if isinstance(ls, str) else ls
except Exception:
    parsed = {}
# If apiKey present, must equal '[redacted]' or empty. If absent, that's fine.
ak = parsed.get('apiKey')
if ak is None or ak == '' or ak == '[redacted]':
    print('1')
else:
    print('0')
PYEOF
)
if [ "$REDACTION_OK" = "1" ]; then
    pass "llm_settings.apiKey is redacted or empty in GET response"
else
    fail "llm_settings.apiKey leaked in GET /sessions/:id response"
fi

# ── End ────────────────────────────────────────────────────────────────────
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
