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
#   3. /                      → 200 (frontend HTML served, not 502)
#   4. JS/CSS from index.html → 200 (frontend assets really load)
#
# We do NOT exercise authenticated endpoints — those need a token, and
# a deploy-time smoke check should not depend on credentials. The probes
# above prove "process up, DB reachable, migrations done, nginx proxying
# correctly, and the SPA bundle is not blank due to asset 404s".

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
ORIGIN="${BASE_URL%%/}"
if [[ "$BASE_URL" =~ ^(https?://[^/]+) ]]; then
    ORIGIN="${BASH_REMATCH[1]}"
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/rohy-smoke-XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

curl_insecure_flag() {
    [[ "${ROHY_SMOKE_INSECURE:-0}" == "1" ]] && printf -- '-k'
}

resolve_asset_url() {
    local href="$1"
    case "$href" in
        http://*|https://*) printf '%s' "$href" ;;
        /*)                 printf '%s%s' "$ORIGIN" "$href" ;;
        *)                  printf '%s/%s' "$BASE_URL" "$href" ;;
    esac
}

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
        local insecure_flag
        insecure_flag=$(curl_insecure_flag)
        body=$(curl -sS ${insecure_flag} -m 10 -o "$TMP_DIR/body" -w '%{http_code}' "${url}" 2>"$TMP_DIR/err") || status="curl_err"
        status="${body:-${status:-curl_err}}"

        if [[ "${status}" == "${expect_status}" ]]; then
            if [[ -z "${body_grep}" ]] || grep -q "${body_grep}" "$TMP_DIR/body"; then
                printf '  ✓ %-30s %s %s\n' "${label}" "${status}" "${url}"
                return 0
            fi
        fi

        if (( i < RETRIES )); then
            sleep "${SLEEP_BETWEEN}"
        fi
    done

    printf '  ✗ %-30s expected=%s got=%s url=%s\n' "${label}" "${expect_status}" "${status}" "${url}" >&2
    if [[ -s "$TMP_DIR/body" ]]; then
        printf '    body (first 200 chars): %s\n' "$(head -c 200 "$TMP_DIR/body" | tr '\n' ' ')" >&2
    fi
    if [[ -s "$TMP_DIR/err" ]]; then
        printf '    curl: %s\n' "$(head -c 200 "$TMP_DIR/err" | tr '\n' ' ')" >&2
    fi
    return 1
}

fetch_frontend_html() {
    local url="${BASE_URL}/"
    local insecure_flag status
    insecure_flag=$(curl_insecure_flag)
    status=$(curl -sS ${insecure_flag} -m 10 -o "$TMP_DIR/frontend.html" -w '%{http_code}' "$url" 2>"$TMP_DIR/frontend.err") || status="curl_err"
    if [[ "$status" == "200" ]]; then
        printf '  ✓ %-30s %s %s\n' 'frontend html (/)' "$status" "$url"
        return 0
    fi
    printf '  ✗ %-30s expected=200 got=%s url=%s\n' 'frontend html (/)' "$status" "$url" >&2
    if [[ -s "$TMP_DIR/frontend.err" ]]; then
        printf '    curl: %s\n' "$(head -c 200 "$TMP_DIR/frontend.err" | tr '\n' ' ')" >&2
    fi
    return 1
}

probe_asset_url() {
    local label="$1"
    local href="$2"
    local url status insecure_flag
    url=$(resolve_asset_url "$href")
    insecure_flag=$(curl_insecure_flag)
    status=$(curl -sS ${insecure_flag} -m 10 -o "$TMP_DIR/${label//[^a-zA-Z0-9]/-}" -w '%{http_code}' "$url" 2>"$TMP_DIR/${label//[^a-zA-Z0-9]/-}.err") || status="curl_err"
    if [[ "$status" == "200" ]]; then
        printf '  ✓ %-30s 200 %s\n' "$label" "$url"
        return 0
    fi
    printf '  ✗ %-30s expected=200 got=%s url=%s\n' "$label" "$status" "$url" >&2
    return 1
}

probe_frontend_assets() {
    if ! fetch_frontend_html; then
        return 1
    fi

    local js_asset css_asset
    js_asset=$(grep -Eo '<script[^>]+src="[^"]+"' "$TMP_DIR/frontend.html" | sed -E 's/.*src="([^"]+)".*/\1/' | head -n 1 || true)
    css_asset=$(grep -Eo '<link[^>]+rel="stylesheet"[^>]+href="[^"]+"|<link[^>]+href="[^"]+"[^>]+rel="stylesheet"' "$TMP_DIR/frontend.html" | sed -E 's/.*href="([^"]+)".*/\1/' | head -n 1 || true)

    local asset_failed=0
    if [[ -z "$js_asset" ]]; then
        printf '  ✗ %-30s no script src found in frontend HTML\n' 'frontend asset (js)' >&2
        asset_failed=$((asset_failed+1))
    else
        probe_asset_url 'frontend asset (js)' "$js_asset" || asset_failed=$((asset_failed+1))
    fi

    if [[ -z "$css_asset" ]]; then
        printf '  ✗ %-30s no stylesheet href found in frontend HTML\n' 'frontend asset (css)' >&2
        asset_failed=$((asset_failed+1))
    else
        probe_asset_url 'frontend asset (css)' "$css_asset" || asset_failed=$((asset_failed+1))
    fi

    [[ "$asset_failed" -eq 0 ]]
}

printf 'rohy smoke check → %s (retries=%s, sleep=%ss)\n' "${BASE_URL}" "${RETRIES}" "${SLEEP_BETWEEN}"

failed=0
probe 'liveness  (/api/health)'   '/api/health' 200 '"status":"ok"' || failed=$((failed+1))
probe 'readiness (/api/ready)'    '/api/ready'  200 '"status":"ok"' || failed=$((failed+1))
probe_frontend_assets || failed=$((failed+1))

if (( failed > 0 )); then
    printf '\nrohy smoke FAILED (%d probe%s failed)\n' "${failed}" "$([[ ${failed} -eq 1 ]] || echo s)" >&2
    exit 1
fi

printf '\nrohy smoke OK\n'
