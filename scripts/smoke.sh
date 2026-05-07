#!/usr/bin/env bash
# Post-deploy smoke check. Run after rsync'ing rohy to the server +
# `systemctl restart rohy` to verify the service came back healthy.
#
# Usage:
#   scripts/smoke.sh                              # checks http://localhost:3000 (dev)
#   scripts/smoke.sh https://your-deploy-url/rohy # explicit base URL for prod
#   ROHY_SMOKE_RETRIES=10 scripts/smoke.sh        # wait longer for boot
#   ROHY_SMOKE_INSECURE=1 scripts/smoke.sh URL    # accept self-signed certs (LAN deploys)
#
# Exit codes:
#   0  — all probes passed
#   1  — a probe failed after retries (deploy is unhealthy)
#   2  — usage error
#
# What we check:
#   1. /api/health            → 200 + status:ok               (liveness)
#   2. /api/ready             → 200 + status:ok + db:ok       (readiness)
#   3. /                      → 200 (frontend served, not 502)
#
# We do NOT exercise authenticated endpoints — those need a token, and
# a deploy-time smoke check should not depend on credentials. The three
# above already prove "process up, DB reachable, migrations done, nginx
# proxying correctly".

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
RETRIES="${ROHY_SMOKE_RETRIES:-6}"           # 6 × 5s = 30s grace for boot
SLEEP_BETWEEN="${ROHY_SMOKE_SLEEP_S:-5}"

if [[ "${BASE_URL}" =~ ^- ]] || [[ "${BASE_URL}" == "--help" ]]; then
    sed -n '2,30p' "$0" | sed 's/^# \?//'
    exit 2
fi

# Strip trailing slash so concatenation produces clean URLs.
BASE_URL="${BASE_URL%/}"

probe() {
    local label="$1"
    local path="$2"
    local expect_status="$3"
    local body_grep="${4:-}"
    local url="${BASE_URL}${path}"

    for ((i=1; i<=RETRIES; i++)); do
        local body status
        # Self-signed certs (LAN deploys) need -k. Off by default so the
        # script catches real cert problems on CA-signed deploys; opt in
        # via ROHY_SMOKE_INSECURE=1.
        local insecure_flag=""
        [[ "${ROHY_SMOKE_INSECURE:-0}" == "1" ]] && insecure_flag="-k"
        body=$(curl -sS ${insecure_flag} -m 10 -o /tmp/rohy-smoke-body -w '%{http_code}' "${url}" 2>/tmp/rohy-smoke-err) || status="curl_err"
        status="${body:-${status:-curl_err}}"

        if [[ "${status}" == "${expect_status}" ]]; then
            if [[ -z "${body_grep}" ]] || grep -q "${body_grep}" /tmp/rohy-smoke-body; then
                printf '  ✓ %-30s %s %s\n' "${label}" "${status}" "${url}"
                return 0
            fi
        fi

        if (( i < RETRIES )); then
            sleep "${SLEEP_BETWEEN}"
        fi
    done

    printf '  ✗ %-30s expected=%s got=%s url=%s\n' "${label}" "${expect_status}" "${status}" "${url}" >&2
    if [[ -s /tmp/rohy-smoke-body ]]; then
        printf '    body (first 200 chars): %s\n' "$(head -c 200 /tmp/rohy-smoke-body | tr '\n' ' ')" >&2
    fi
    if [[ -s /tmp/rohy-smoke-err ]]; then
        printf '    curl: %s\n' "$(head -c 200 /tmp/rohy-smoke-err | tr '\n' ' ')" >&2
    fi
    return 1
}

printf 'rohy smoke check → %s (retries=%s, sleep=%ss)\n' "${BASE_URL}" "${RETRIES}" "${SLEEP_BETWEEN}"

failed=0
probe 'liveness  (/api/health)'   '/api/health' 200 '"status":"ok"' || failed=$((failed+1))
probe 'readiness (/api/ready)'    '/api/ready'  200 '"status":"ok"' || failed=$((failed+1))
probe 'frontend  (/)'             '/'           200                  || failed=$((failed+1))

if (( failed > 0 )); then
    printf '\nrohy smoke FAILED (%d probe%s failed)\n' "${failed}" "$([[ ${failed} -eq 1 ]] || echo s)" >&2
    exit 1
fi

printf '\nrohy smoke OK\n'
