#!/usr/bin/env bash
# scripts/post-verify-rohy.sh — POST_VERIFY hook wrapper that mints a
# fresh auth token before invoking tech-test.sh so the Oyon contract
# probe (section 6 of tech-test.sh) actually fires every deploy.
#
# Without this wrapper, POST_VERIFY runs tech-test.sh with no token, the
# contract probe gates on `[[ -n "$TOKEN" ]]` and silently skips, and we
# only verify "routes are mounted" — not "validator still rejects
# malformed batches." That's exactly how the May-2026 label-set bug
# slipped through deploy verification: every probe was an unauth'd 401
# check and nothing actually exercised the validator.
#
# Operator setup (one-time per machine):
#   1. Create $HOME/.rohy-deploy-creds with mode 0600:
#         ROHY_LOGIN_URL='https://192.168.50.39:4001/rohy/api/auth/login'
#         ROHY_DEPLOY_USER='deploy-verifier'
#         ROHY_DEPLOY_PASS='...'
#      The credentials must belong to a real user account in rohy. A
#      dedicated low-privilege user is recommended (the contract probe
#      doesn't need any data access — it just needs to pass the
#      `authenticateToken` middleware so the route reaches the
#      validator). Any role works.
#   2. chmod 600 $HOME/.rohy-deploy-creds
#
# If the file is absent → wrapper runs tech-test.sh without a token, the
# contract probe skips, and the deploy still passes on the other 27
# checks. No-op for operators who haven't opted in.
#
# Usage (driven by JStats/website/sites.conf POST_VERIFY_rohy):
#   post-verify-rohy.sh https://192.168.50.39:4001/rohy

set -uo pipefail

BASE_URL="${1:-}"
[[ -z "$BASE_URL" ]] && { echo "usage: $0 <base-url>" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS_FILE="${ROHY_DEPLOY_CREDS:-$HOME/.rohy-deploy-creds}"
INSECURE_ARG=""; [[ "${ROHY_INSECURE:-1}" == "1" ]] && INSECURE_ARG="-k"

# Try to mint a token. Three failure modes are tolerated by design:
#   1. Creds file missing → operator hasn't opted in. Skip the mint, run
#      tech-test.sh anyway (without a token); contract probe will skip.
#   2. Creds file present but login returns non-2xx → log a warning and
#      run without a token. Don't fail the deploy on a stale password
#      because that would block legitimate code deploys on creds rot.
#   3. Login succeeds but response shape is unexpected → same as #2.
TOKEN=""
if [[ -r "$CREDS_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS_FILE"
    if [[ -n "${ROHY_LOGIN_URL:-}" && -n "${ROHY_DEPLOY_USER:-}" && -n "${ROHY_DEPLOY_PASS:-}" ]]; then
        login_body=$(printf '{"username":%s,"password":%s}' \
            "$(printf '%s' "$ROHY_DEPLOY_USER" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
            "$(printf '%s' "$ROHY_DEPLOY_PASS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
        login_response=$(curl $INSECURE_ARG -sS -X POST \
            -H 'Content-Type: application/json' \
            -d "$login_body" \
            --max-time 10 \
            "$ROHY_LOGIN_URL" 2>/dev/null || echo '')
        # Accept either {"token":"..."} or {"data":{"token":"..."}} shape.
        TOKEN=$(printf '%s' "$login_response" | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read() or "{}")
except Exception:
    sys.exit(0)
print(d.get("token") or d.get("data", {}).get("token") or "")
' 2>/dev/null || echo "")
        if [[ -z "$TOKEN" ]]; then
            echo "  ! post-verify: credential file present but token mint failed (login returned: ${login_response:0:120}). Running without contract probe." >&2
        fi
    fi
fi

# Exec tech-test.sh. Pass through ROHY_INSECURE (already set in the
# POST_VERIFY env). If TOKEN is empty, the contract probe section in
# tech-test.sh detects that and skips itself.
exec env \
    ROHY_INSECURE="${ROHY_INSECURE:-1}" \
    ROHY_TOKEN="$TOKEN" \
    ROHY_VERBOSE="${ROHY_VERBOSE:-0}" \
    "$SCRIPT_DIR/tech-test.sh" "$BASE_URL"
