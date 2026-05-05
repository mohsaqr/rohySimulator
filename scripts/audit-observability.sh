#!/usr/bin/env bash
# End-to-end audit for Stage E9 observability hooks.
#
# Bash 3.2 compatible. This starts an isolated server on a temporary port and
# database so ROHY_SLOW_QUERY_MS can be forced low without touching the
# orchestrator-managed :3000 process.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-observability-audit-XXXXXX")
trap 'cleanup' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""
SERVER_PID=""
PORT=$((3900 + ($$ % 500)))
API="http://localhost:$PORT"
DB_PATH="$OUT/observability.sqlite"
LOG_FILE="$OUT/server.log"

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  PASS %s\n" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES="${FAILURES}
  - $1"; printf "  FAIL %s\n" "$1"; }
section() { printf "\n%s\n" "$1"; }

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ -z "${ROHY_AUDIT_KEEP:-}" ]; then
        rm -rf "$OUT"
    else
        printf "Kept audit artifacts in %s\n" "$OUT"
    fi
}

header_value() {
    awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="x-request-id"{gsub(/\r/,"",$2); print $2; exit}' "$1"
}

json_get() {
    python3 - "$1" "$2" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
cur = data
for part in sys.argv[2].split('.'):
    cur = cur.get(part) if isinstance(cur, dict) else None
print('' if cur is None else cur)
PYEOF
}

wait_for_server() {
    tries=0
    while [ "$tries" -lt 80 ]; do
        if curl -s -o /dev/null "$API/api/admin/database-stats"; then
            return 0
        fi
        if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
            cat "$LOG_FILE" 2>/dev/null || true
            return 1
        fi
        tries=$((tries+1))
        sleep 0.25
    done
    cat "$LOG_FILE" 2>/dev/null || true
    return 1
}

assert_log() {
    description="$1"
    shift
    if python3 - "$LOG_FILE" "$@" <<'PYEOF'
import json, sys
log_file = sys.argv[1]
checks = dict(arg.split('=', 1) for arg in sys.argv[2:])
for line in open(log_file, errors='ignore'):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        row = json.loads(line)
    except Exception:
        continue
    ok = True
    for key, expected in checks.items():
        value = row
        for part in key.split('.'):
            value = value.get(part) if isinstance(value, dict) else None
        if expected == '__present__':
            if value is None:
                ok = False
                break
        elif str(value) != expected:
            ok = False
            break
    if ok:
        sys.exit(0)
sys.exit(1)
PYEOF
    then
        pass "$description"
    else
        fail "$description"
    fi
}

section "Start isolated server"
(
    cd "$ROOT"
    PORT="$PORT" \
    ROHY_DB="$DB_PATH" \
    JWT_SECRET="observability-audit-secret" \
    ROHY_LOG_LEVEL="debug" \
    ROHY_SLOW_QUERY_MS="0" \
    ROHY_LOG_SKIP_PATHS="/api/proxy/llm,/health,/@vite*,/src*,/node_modules*" \
    node server/server.js
) > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

if wait_for_server; then
    pass "server booted on isolated port $PORT"
else
    fail "server did not boot on isolated port $PORT"
    exit 1
fi

section "Request id propagation"
curl -s -D "$OUT/headers-a.txt" -o "$OUT/body-a.json" "$API/api/admin/database-stats" >/dev/null
curl -s -D "$OUT/headers-b.txt" -o "$OUT/body-b.json" "$API/api/admin/database-stats" >/dev/null
RID_A=$(header_value "$OUT/headers-a.txt")
RID_B=$(header_value "$OUT/headers-b.txt")
if [ -n "$RID_A" ] && [ -n "$RID_B" ] && [ "$RID_A" != "$RID_B" ]; then
    pass "server generates unique X-Request-Id values"
else
    fail "server did not generate unique X-Request-Id values"
fi

CUSTOM_RID="audit-e9-$$-$(date +%s)"
curl -s -D "$OUT/headers-custom.txt" -o "$OUT/body-custom.json" \
    -H "X-Request-Id: $CUSTOM_RID" "$API/api/admin/database-stats" >/dev/null
RID_CUSTOM=$(header_value "$OUT/headers-custom.txt")
if [ "$RID_CUSTOM" = "$CUSTOM_RID" ]; then
    pass "server echoes sane inbound X-Request-Id"
else
    fail "server did not echo custom X-Request-Id"
fi

section "Authenticated request and slow query"
curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}' > "$OUT/login.json"
TOKEN=$(json_get "$OUT/login.json" "token")
if [ -n "$TOKEN" ]; then
    pass "admin login succeeded"
else
    fail "admin login failed"
fi

AUTH_RID="audit-e9-auth-$$-$(date +%s)"
curl -s -D "$OUT/headers-auth.txt" -o "$OUT/body-auth.json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Request-Id: $AUTH_RID" \
    "$API/api/admin/database-stats" >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    curl -s -o "$OUT/body-auth-$i.json" \
        -H "Authorization: Bearer $TOKEN" \
        -H "X-Request-Id: $AUTH_RID" \
        "$API/api/admin/database-stats" >/dev/null
done
sleep 0.5

assert_log "request log contains expected structured fields" \
    "event=request" "request_id=$AUTH_RID" "method=GET" "path=/api/admin/database-stats" \
    "status=200" "duration_ms=__present__" "bytes_sent=__present__"

assert_log "slow-query log emitted with request id" \
    "event=slow_query" "request_id=$AUTH_RID" "duration_ms=__present__" "sql=__present__"

section "Structured 4xx error signal"
assert_log "4xx response emitted structured http_error entry" \
    "event=http_error" "request_id=$CUSTOM_RID" "method=GET" \
    "path=/api/admin/database-stats" "status=401" "duration_ms=__present__"

section "Summary"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
    exit 0
fi

printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
printf "Failures:%s\n" "$FAILURES"
exit 1
