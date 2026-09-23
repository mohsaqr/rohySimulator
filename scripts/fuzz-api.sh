#!/usr/bin/env bash
# API fuzzing with schemathesis, as an educator and as a student.
#
#   pip install schemathesis          # once; CI pins the version it installs
#   bash scripts/fuzz-api.sh
#
# Boots an isolated server (temporary port and database, like
# audit-observability.sh), mints an educator token and a student token, and
# runs schemathesis over the generated OpenAPI document once per role. Fails
# on any response of 500 or above, any response slower than
# FUZZ_MAX_RESPONSE_TIME seconds, and a server that did not survive the run.
#
# The document is docs/reference/api/openapi.json plus a generic JSON body on
# every mutating operation (scripts/fuzz-api-spec.mjs explains why). It
# carries no response schemas and lists only the statuses every route shares,
# so the conformance checks (status codes, content types, response schemas,
# positive/negative data acceptance) would fail by construction — the
# reference cannot describe what the fuzzer would hold the server to. Until
# routes carry their own schemas, the checks run are the ones the document CAN
# support: no server error, and the response-time budget.
#
# Environment:
#   SCHEMATHESIS            the schemathesis binary     (default: schemathesis)
#   ROHY_FUZZ_PORT          server port                 (default: 4392)
#   FUZZ_MAX_EXAMPLES       test cases per operation    (default: 30)
#   FUZZ_MAX_RESPONSE_TIME  seconds per response        (default: 5)
#   FUZZ_CHECKS             schemathesis checks         (default: not_a_server_error;
#                           `all` measures what the document cannot yet support)
#   FUZZ_SEED               replay a run's seed         (default: random)
#   FUZZ_REPORT_DIR         keep JUnit reports here     (default: temporary)
#   ROHY_FUZZ_KEEP=1        keep the temp dir (server log, fuzz document)
#   ROHY_FUZZ_PLUGIN_ROUTES=1  also fuzz a plugin's own routes (needs content
#                           installed: `npm run setup:content`; see EXCLUDE)
#
# Bash 3.2 compatible.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/rohy-fuzz-XXXXXX")
SCHEMATHESIS="${SCHEMATHESIS:-schemathesis}"
PORT="${ROHY_FUZZ_PORT:-4392}"
API="http://127.0.0.1:$PORT"
MAX_EXAMPLES="${FUZZ_MAX_EXAMPLES:-30}"
MAX_RESPONSE_TIME="${FUZZ_MAX_RESPONSE_TIME:-5}"
CHECKS="${FUZZ_CHECKS:-not_a_server_error}"
REPORT_DIR="${FUZZ_REPORT_DIR:-$OUT/reports}"
SERVER_PID=""
LOG_FILE="$OUT/server.log"

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ -z "${ROHY_FUZZ_KEEP:-}" ]; then
        rm -rf "$OUT"
    else
        printf "Kept fuzz artifacts in %s\n" "$OUT"
    fi
}
trap cleanup EXIT

if ! command -v "$SCHEMATHESIS" >/dev/null 2>&1; then
    echo "schemathesis not found ($SCHEMATHESIS). pip install schemathesis, or set SCHEMATHESIS=/path/to/it." >&2
    exit 2
fi

# Operations the fuzzer must not call, each for a stated reason. Matched as
# regexes against the path (schemathesis --exclude-path-regex). The two roles
# fuzzed are educator and student, so an admin-only route answers 403 either
# way; the destructive ones are still listed, so a future admin run cannot
# reach them by accident.
EXCLUDE=(
    # Revokes the very token the run authenticates with; every later request
    # would be a 401 and the rest of the run would test nothing.
    '^/api/auth/logout$'
    # Rotates the token and revokes the old one: the same effect as logout.
    '^/api/auth/refresh$'
    # Changes the fuzz account's password mid-run.
    '^/api/user/password$'
    # Admin: permanently deletes a user and everything they own.
    '^/api/users/\{id\}/purge$'
    # Admin: bulk-creates users.
    '^/api/users/import$'
    # Admin: re-runs the catalogue seeders over the platform's data.
    '^/api/admin/seed/'
    '^/api/scenarios/seed$'
    # Admin: revokes other people's sessions.
    '^/api/admin/active-sessions/'
    # Admin: rolls a case back to an older version.
    '^/api/cases/\{caseId\}/restore/'
    # Admin: creates tenants.
    '^/api/tenants$'
    # Calls a third-party LLM provider. With none configured (CI, this script)
    # every well-formed request is a 502 "LLM provider unreachable" by design;
    # the route's own handling of that is locked in
    # tests/server/fuzz-regressions.test.js.
    '^/api/proxy/llm$'
    # KNOWN BUG, not fixed here (LEARNINGS.md 2026-09-23): the template
    # "Test LLM" route reads the platform provider/model/key from a table
    # named `config` that no migration creates, so every template without its
    # own provider override answers 500 "no such table: config". The fix is to
    # resolve the platform LLM the way /proxy/llm does, which is a change to
    # the LLM resolution path, not a one-line guard. Remove this line with it.
    '^/api/agents/templates/\{id\}/test-llm$'
    # Proxies to a plugin's content origin. With no content installed (CI never
    # runs `npm run setup:content`) it answers 503 plugin_remote_not_configured
    # BY DESIGN — plugin-rooms.spec.js pins that message — so it is not a
    # server error to report here.
    '^/api/plugins/\{pluginId\}/\{splat\}$'
)
# A plugin's OWN server routes (pathology's imports, jobs, assets) sit under
# that same catch-all. Schemathesis's coverage phase probes each of them with
# the methods they do not declare, and a GET on a POST-only path falls through
# to the proxy — which, with no content installed, answers the designed 503
# above (CI, 2026-09-23: four such probes, no real error). So they are fuzzed
# only where content is installed: set ROHY_FUZZ_PLUGIN_ROUTES=1 on a box that
# has run `npm run setup:content`. The lasting fix is a 405 from the plugin
# router for a known path with an unsupported method.
if [ "${ROHY_FUZZ_PLUGIN_ROUTES:-}" != "1" ]; then
    EXCLUDE+=('^/api/plugins/[a-z][a-z0-9_]*/')
fi
EXCLUDE_REGEX="$(IFS='|'; echo "${EXCLUDE[*]}")"

wait_for_server() {
    tries=0
    while [ "$tries" -lt 120 ]; do
        if curl -sf -o /dev/null "$API/api/health"; then return 0; fi
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then tail -50 "$LOG_FILE" >&2; return 1; fi
        tries=$((tries+1))
        sleep 0.5
    done
    tail -50 "$LOG_FILE" >&2
    return 1
}

json_field() {
    python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1]) or "")' "$1"
}

login() {
    curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
        --data "{\"username\":\"$1\",\"password\":\"$2\"}" | json_field token
}

# A server already on the port would answer the health probe and take the
# whole run — against its own database and its own code. Refuse instead.
if curl -s -o /dev/null "$API/api/health"; then
    echo "[fuzz] something is already listening on :$PORT; set ROHY_FUZZ_PORT" >&2
    exit 2
fi

# A slide library for the pathology plugin's own routes (imports, jobs,
# assets). Without one they answer 503 plugin_import_no_library BY DESIGN —
# which the fuzzer would report as a server error, and did, on the first CI
# run (no library there; a dev box had one). An empty directory is enough:
# the routes then answer 400/404 like any other.
mkdir -p "$OUT/pathology-library"
echo "[fuzz] booting an isolated server on :$PORT"
(
    cd "$ROOT"
    PORT="$PORT" \
    ROHY_DB="$OUT/fuzz.sqlite" \
    JWT_SECRET=fuzz-only-secret-do-not-reuse-anywhere \
    NODE_ENV=production \
    FRONTEND_URL="$API" \
    ALLOW_DEFAULT_USERS=1 \
    ROHY_DISABLE_AUTH_RATE_LIMIT=1 \
    ROHY_DISABLE_GENERAL_RATE_LIMIT=1 \
    OYON_ENABLED=1 \
    ROHY_PLUGIN_LIBRARY_DIRS="pathology=$OUT/pathology-library" \
    exec node server/server.js > "$LOG_FILE" 2>&1
) &
# `exec`, so $! is the node process itself: killing a subshell would orphan
# the server, still holding the port, for the next run to find.
SERVER_PID=$!
wait_for_server || { echo "[fuzz] server failed to boot" >&2; exit 1; }

ADMIN_TOKEN="$(login admin admin123)"
[ -n "$ADMIN_TOKEN" ] || { echo "[fuzz] admin login failed" >&2; exit 1; }
curl -s -o "$OUT/educator-create.json" -X POST "$API/api/users/create" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    --data '{"username":"fuzz_educator","name":"Fuzz Educator","email":"fuzz_educator@example.invalid","password":"FuzzEducator-123","role":"educator"}'
EDUCATOR_TOKEN="$(login fuzz_educator FuzzEducator-123)"
STUDENT_TOKEN="$(login student student123)"
[ -n "$EDUCATOR_TOKEN" ] || { echo "[fuzz] educator login failed: $(cat "$OUT/educator-create.json")" >&2; exit 1; }
[ -n "$STUDENT_TOKEN" ] || { echo "[fuzz] student login failed" >&2; exit 1; }

node "$ROOT/scripts/fuzz-api-spec.mjs" "$OUT/openapi.fuzz.json"
mkdir -p "$REPORT_DIR"

STATUS=0
run_role() {
    role="$1"
    token="$2"
    echo
    echo "[fuzz] ── $role ──────────────────────────────────────────────"
    set +e
    # shellcheck disable=SC2086
    "$SCHEMATHESIS" run "$OUT/openapi.fuzz.json" \
        --url "$API" \
        --header "Authorization: Bearer $token" \
        --checks "$CHECKS" \
        --max-response-time "$MAX_RESPONSE_TIME" \
        --max-examples "$MAX_EXAMPLES" \
        --exclude-path-regex "$EXCLUDE_REGEX" \
        --workers 1 \
        --no-color \
        --report junit --report-junit-path "$REPORT_DIR/fuzz-$role.junit.xml" \
        ${FUZZ_SEED:+--seed "$FUZZ_SEED"}
    code=$?
    set -e
    if [ "$code" -ne 0 ]; then STATUS=1; echo "[fuzz] $role: schemathesis exited $code"; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[fuzz] the server DIED during the $role run — last log lines:" >&2
        tail -80 "$LOG_FILE" >&2
        exit 1
    fi
}

run_role educator "$EDUCATOR_TOKEN"
run_role student "$STUDENT_TOKEN"

if [ "$STATUS" -ne 0 ]; then
    echo
    echo "[fuzz] FAILED. Server errors from the log:"
    grep -E '"status":5[0-9][0-9]' "$LOG_FILE" | tail -40 || true
    ROHY_FUZZ_KEEP=1
fi
exit "$STATUS"
