#!/usr/bin/env bash
# scripts/tech-test.sh — comprehensive technical verification of a rohy deploy.
#
# Goes beyond smoke.sh (which only proves liveness): exercises the full Oyon
# API surface, nginx proxy parity (the deployment_fix.md P1 fix), static
# asset paths, auth gating, response timing, and security headers.
#
# Usage:
#   scripts/tech-test.sh https://192.168.50.39:4001/rohy
#   ROHY_TOKEN=eyJ... scripts/tech-test.sh https://saqr.me/rohy   # exercises auth'd endpoints
#   ROHY_INSECURE=1 scripts/tech-test.sh ...                       # accept self-signed certs
#   ROHY_VERBOSE=1 scripts/tech-test.sh ...                        # print response bodies on FAIL
#
# Minting a token for the contract probe (operator-side, one-shot):
#   curl -ksS -X POST -H 'Content-Type: application/json' \
#     -d '{"username":"<op>","password":"<pw>"}' \
#     https://192.168.50.39:4001/rohy/api/auth/login | jq -r .token
# Stash it in your shell:
#   export ROHY_TOKEN=...
# Then re-run tech-test.sh; the Oyon contract probe (section 8) will fire.
#
# Exit codes: 0 = all pass · 1 = any fail · 2 = usage error.
#
# Output: each check is one line, color-coded:
#   ✓ PASS · ✗ FAIL · ! WARN (e.g. nginx parity gap that doesn't break the API)
# Summary at the end gives counts, total time, and a copy-paste retry hint
# scoped to the failing categories so the operator can iterate fast.

set -uo pipefail

BASE_URL="${1:-}"
[[ -z "$BASE_URL" ]] && { echo "usage: $0 <base-url>   e.g. https://192.168.50.39:4001/rohy" >&2; exit 2; }
BASE_URL="${BASE_URL%/}"   # strip trailing slash

# ── globals ────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRN=$'\033[0;32m'; BLU=$'\033[0;34m'; DIM=$'\033[2m'; CLR=$'\033[0m'
INSECURE_ARG=""; [[ "${ROHY_INSECURE:-0}" == "1" ]] && INSECURE_ARG="-k"
TOKEN="${ROHY_TOKEN:-}"
VERBOSE="${ROHY_VERBOSE:-0}"
AUTH_HDR=()
[[ -n "$TOKEN" ]] && AUTH_HDR=(-H "Authorization: Bearer $TOKEN")

PASS=0; FAIL=0; WARN=0; SKIP=0
FAILED_CATEGORIES=()
START_NS=$(date +%s%N 2>/dev/null || date +%s)

# Readiness wait: when invoked as a POST_VERIFY hook right after `systemctl
# restart rohy`, the Express upstream needs ~3-6s to finish init (sqlite open,
# migrations, seed checks). Without this, tech-test races the restart and
# every probe sees nginx returning 502 (no upstream). Polls /api/health up
# to ROHY_WAIT_READY_S seconds; default 30. Set to 0 to skip (e.g. when
# verifying an already-stable deploy).
ROHY_WAIT_READY_S="${ROHY_WAIT_READY_S:-30}"

# ── helpers ────────────────────────────────────────────────────────────────
# probe URL EXPECTED_STATUSES [auth=0|1] [body_grep=]
# auth=1 will skip if no token, send token if present
# body_grep is an extended regex; set empty to skip body check
probe() {
    local url="$1"; local expect="$2"; local auth="${3:-0}"; local body_re="${4:-}"
    local label="${5:-${url#"$BASE_URL"}}"
    local hdr=()
    [[ "$auth" == "1" ]] && hdr=("${AUTH_HDR[@]+"${AUTH_HDR[@]}"}")
    local out_body; out_body=$(mktemp)
    local timing; timing=$(curl $INSECURE_ARG -sS -o "$out_body" -w "%{http_code} %{time_total}" \
        "${hdr[@]+"${hdr[@]}"}" "$url" 2>/dev/null || echo "000 0")
    local status="${timing% *}"; local secs="${timing#* }"
    local ms; ms=$(awk -v s="$secs" 'BEGIN { printf "%d", s*1000 }')
    if [[ ",$expect," == *",$status,"* ]]; then
        local body_ok=1
        if [[ -n "$body_re" ]] && ! grep -qE "$body_re" "$out_body" 2>/dev/null; then body_ok=0; fi
        if (( body_ok )); then
            printf '  %s✓%s %-46s %s%s%s in %sms\n' "$GRN" "$CLR" "$label" "$DIM" "$status" "$CLR" "$ms"
            PASS=$((PASS+1))
        else
            printf '  %s✗%s %-46s %s (body did not match: %s)\n' "$RED" "$CLR" "$label" "$status" "$body_re"
            FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("$CURRENT_CAT")
            (( VERBOSE )) && { echo "    body:"; sed 's/^/      /' "$out_body" | head -8; }
        fi
    else
        printf '  %s✗%s %-46s got %s, expected %s in %sms\n' "$RED" "$CLR" "$label" "$status" "$expect" "$ms"
        FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("$CURRENT_CAT")
        (( VERBOSE )) && { echo "    body:"; sed 's/^/      /' "$out_body" | head -8; }
    fi
    rm -f "$out_body"
}

# warn URL EXPECTED — same shape as probe but a mismatch is yellow not red.
# Used for nginx parity issues that don't break the core API but reduce UX.
warn_probe() {
    local url="$1"; local expect="$2"; local label="${3:-${url#"$BASE_URL"}}"
    local status; status=$(curl $INSECURE_ARG -sS -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [[ ",$expect," == *",$status,"* ]]; then
        printf '  %s✓%s %-46s %s\n' "$GRN" "$CLR" "$label" "$status"; PASS=$((PASS+1))
    else
        printf '  %s!%s %-46s got %s, expected %s (operational warning)\n' "$YEL" "$CLR" "$label" "$status" "$expect"
        WARN=$((WARN+1))
    fi
}

# header_check URL HEADER_NAME EXPECTED_REGEX
header_check() {
    local url="$1"; local name="$2"; local re="$3"
    local val; val=$(curl $INSECURE_ARG -sIS "$url" 2>/dev/null | awk -v h="$name:" 'BEGIN{IGNORECASE=1} tolower($1)==tolower(h){sub(/^[^:]*:[ \t]*/,""); print; exit}' | tr -d '\r')
    if [[ -n "$val" ]] && echo "$val" | grep -qE "$re"; then
        printf '  %s✓%s %-46s %s%s%s\n' "$GRN" "$CLR" "$name" "$DIM" "${val:0:40}" "$CLR"; PASS=$((PASS+1))
    elif [[ -z "$val" ]]; then
        printf '  %s!%s %-46s missing\n' "$YEL" "$CLR" "$name"; WARN=$((WARN+1))
    else
        printf '  %s✗%s %-46s got %s, expected match %s\n' "$RED" "$CLR" "$name" "$val" "$re"
        FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("$CURRENT_CAT")
    fi
}

section() { CURRENT_CAT="$1"; printf '\n%s━━━ %s ━━━%s\n' "$BLU" "$1" "$CLR"; }

# ── start ──────────────────────────────────────────────────────────────────
echo "═══ rohy tech test ═══"
echo "  target:   $BASE_URL"
echo "  insecure: $([[ -n "$INSECURE_ARG" ]] && echo yes || echo no)"
echo "  token:    $([[ -n "$TOKEN" ]] && echo provided || echo none — auth\'d endpoints will SKIP if 401 expected)"
echo "  started:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Early-warn if TLS will block every probe — saves the operator scrolling
# through a screen of red `000`s before realising the cert is self-signed.
if [[ "$BASE_URL" == https://* && -z "$INSECURE_ARG" ]]; then
    if ! curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$BASE_URL/api/health" 2>/dev/null | grep -qE '^[1-5][0-9][0-9]$'; then
        printf '\n%s!%s pre-flight: TLS/connect failed on https URL.\n' "$YEL" "$CLR"
        printf '   if your cert is self-signed (LAN deploy), re-run with %sROHY_INSECURE=1%s :\n' "$DIM" "$CLR"
        printf '       ROHY_INSECURE=1 %s %s\n' "$0" "$BASE_URL"
        echo
    fi
fi

# Readiness probe: poll /api/health until it returns 200 or the timeout
# elapses. 502 from nginx means the Express upstream hasn't bound yet — the
# normal state during a freshly-fired `systemctl restart rohy`. 200 means
# we're ready to start verifying. Anything else (or a timeout) → bail with
# a clear "upstream never came ready" message rather than producing a sea
# of misleading FAILs.
if (( ROHY_WAIT_READY_S > 0 )); then
    printf '  %s→%s waiting for upstream readiness (max %ss)... ' "$BLU" "$CLR" "$ROHY_WAIT_READY_S"
    waited=0
    while (( waited < ROHY_WAIT_READY_S )); do
        st=$(curl $INSECURE_ARG -sS -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL/api/health" 2>/dev/null || echo 000)
        if [[ "$st" == "200" ]]; then
            printf '%sready in %ss%s\n\n' "$GRN" "$waited" "$CLR"
            break
        fi
        sleep 1
        waited=$((waited+1))
    done
    if (( waited >= ROHY_WAIT_READY_S )); then
        printf '%sgave up (last status: %s)%s\n' "$RED" "$st" "$CLR"
        printf '  %s✗%s upstream did not become ready within %ss — failing fast\n\n' "$RED" "$CLR" "$ROHY_WAIT_READY_S"
        exit 1
    fi
fi

# ── 1. Liveness ────────────────────────────────────────────────────────────
section "Liveness"
probe "$BASE_URL/api/health"  "200" 0 '"status":"ok"' "GET /api/health"
probe "$BASE_URL/api/ready"   "200" 0 '"status":"ok"' "GET /api/ready"
probe "$BASE_URL/"            "200" 0 ""              "GET /  (SPA shell)"

# ── 2. Frontend bundle integrity ───────────────────────────────────────────
section "Frontend bundle"
INDEX_HTML=$(curl $INSECURE_ARG -sS "$BASE_URL/" 2>/dev/null)
JS_REF=$(echo "$INDEX_HTML" | grep -oE '/(rohy/)?assets/index-[A-Za-z0-9_-]+\.js' | head -1)
CSS_REF=$(echo "$INDEX_HTML" | grep -oE '/(rohy/)?assets/index-[A-Za-z0-9_-]+\.css' | head -1)
if [[ -n "$JS_REF" ]]; then
    # The href in index.html is already absolute under the deploy base; resolve against host root.
    HOST_ROOT="${BASE_URL%/rohy}"
    [[ "$HOST_ROOT" == "$BASE_URL" ]] && HOST_ROOT=$(echo "$BASE_URL" | grep -oE 'https?://[^/]+')
    probe "${HOST_ROOT}${JS_REF}"  "200" 0 "" "JS bundle loads"
    probe "${HOST_ROOT}${CSS_REF}" "200" 0 "" "CSS bundle loads"
else
    printf '  %s!%s no JS bundle reference found in index.html\n' "$YEL" "$CLR"; WARN=$((WARN+1))
fi

# ── 3. Oyon API surface ────────────────────────────────────────────────────
# Without a token: real Oyon routes return 401 (auth gate fired = mounted).
# Disabled stub returns 503 + {code:"OYON_DISABLED"} = OYON_ENABLED missing.
# Bare 404 = older code without stub OR nginx blocking the path.
section "Oyon API (no token expected = 401 if mounted, 503 if disabled, 404 if pre-stub)"
# curl -w already emits "000" when TLS / connect fails — don't pile another
# "000" on top via `|| echo`, that produced "000000" and confused the case.
OYON_STATUS=$(curl $INSECURE_ARG -sS -o /tmp/oyon-cfg.$$ -w "%{http_code}" "$BASE_URL/api/addons/oyon/config" 2>/dev/null)
OYON_STATUS="${OYON_STATUS:-000}"
OYON_BODY=$(cat /tmp/oyon-cfg.$$ 2>/dev/null); rm -f /tmp/oyon-cfg.$$
case "$OYON_STATUS" in
    401) printf '  %s✓%s Oyon routes mounted (401 auth required)        %s\n' "$GRN" "$CLR" "$DIM"; PASS=$((PASS+1)) ;;
    503) if echo "$OYON_BODY" | grep -q OYON_DISABLED; then
            printf '  %s!%s Oyon disabled stub responding — set OYON_ENABLED=1 in env and restart\n' "$YEL" "$CLR"; WARN=$((WARN+1))
         elif echo "$OYON_BODY" | grep -q OYON_IMPORT_FAILED; then
            printf '  %s✗%s Oyon import failed — assets missing? body:\n' "$RED" "$CLR"; FAIL=$((FAIL+1))
            echo "$OYON_BODY" | head -c 300 | sed 's/^/      /'; echo
         else
            printf '  %s!%s 503 but unrecognized body:\n' "$YEL" "$CLR"; WARN=$((WARN+1))
            echo "$OYON_BODY" | head -c 300 | sed 's/^/      /'; echo
         fi ;;
    404) printf '  %s✗%s Bare 404 — old code without stub OR nginx blocking /api/addons/oyon\n' "$RED" "$CLR"; FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("Oyon API") ;;
    *)   printf '  %s✗%s unexpected status %s\n' "$RED" "$CLR" "$OYON_STATUS"; FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("Oyon API") ;;
esac
# Other Oyon endpoints — same gate behavior; verify uniformity.
for p in /api/addons/oyon/settings /api/addons/oyon/analytics/students /api/addons/oyon/analytics/cases /api/addons/oyon/emotion-records /api/addons/oyon/admin/live /api/addons/oyon/student/me; do
    probe "$BASE_URL$p" "401,503" 0 "" "$p"
done

# ── 4. Oyon static assets (the deployment_fix.md P1 surface) ───────────────
# These need root-absolute paths via nginx; failures here are operational
# warnings rather than fatal — the API tabs work, only "Open Oyon" iframes break.
section "Oyon static (nginx parity — warns not fails)"
HOST_ROOT="${BASE_URL%/rohy}"
[[ "$HOST_ROOT" == "$BASE_URL" ]] && HOST_ROOT=$(echo "$BASE_URL" | grep -oE 'https?://[^/]+')
warn_probe "$HOST_ROOT/oyon/standalone/"            "200" "GET /oyon/standalone/  (Open Oyon)"
warn_probe "$HOST_ROOT/oyon/standalone/logs.html"   "200" "GET /oyon/standalone/logs.html"

# ORT vendor runtime files. The browser pulls these at session start —
# checking them at deploy time catches the May-2026 / Docker class of
# bug where a missing wasm file makes ORT throw "no available backend
# found" at first capture instead of failing loud at install.
#
# REQUIRED set: the plain `onnxruntime-web` bundle's runtime deps.
# These MUST be present and 200 — failure here means the camera widget
# won't initialise on this host.
ORT_VENDOR="$HOST_ROOT/standalone/vendor/onnxruntime-web"
for f in ort.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
    probe "$ORT_VENDOR/$f" "200" 0 "" "GET /standalone/vendor/onnxruntime-web/$f"
done

# OPTIONAL set: present in some ORT versions, absent in others. As of
# 1.20.x the asyncify variant is NOT published on jsDelivr and we no
# longer load the WebGPU bundle (which dynamically imports it). A 404
# here is fine as long as the served frontend bundle doesn't import
# 'onnxruntime-web/webgpu'. Probed as warn so the operator notices if
# someone reverts the loadOrt() fix.
for f in ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm; do
    warn_probe "$ORT_VENDOR/$f" "200,404" "GET /standalone/vendor/onnxruntime-web/$f (optional)"
done

# ── 5. Auth gating sanity ──────────────────────────────────────────────────
# A handful of GET-protected routes that MUST NOT return 2xx without a token.
# We accept 401/403 (auth gate did its job) AND 404 (route doesn't exist for
# unauthenticated GET — also fine, as long as it's not 200). The only way
# this section fails is if an unauthenticated GET returned data.
section "Auth gating (no 2xx without token)"
for p in /api/users /api/cases /api/auth/profile /api/auth/verify /api/admin/database-stats; do
    probe "$BASE_URL$p" "401,403,404" 0 "" "$p"
done

# ── 6. Oyon contract probe (auth'd) ────────────────────────────────────────
# When ROHY_TOKEN is set, POST a synthetic batch with a deliberately-bad
# probabilities sum (7 labels of 0.125 = 0.875) and assert the validator
# catches it with 400 + "sum close to 1" in the body. Catches the May-2026
# regression class — drift between client label set and server validator
# — at deploy time, before any user starts a capture.
#
# The route's check order (oyon-routes.js:212-265) is:
#   1. settings.emotion_capture_enabled → 403 if disabled
#   2. validateEmotionBatch              → 400 if payload invalid
#   3. session lookup                    → 404 if not found
#   4. ownership check                   → 403 if wrong user
#   5. consent check                     → 403 if not granted
# Step 2 fires before any session/consent check, so we don't need a real
# session — a bogus session_id is fine because the bad payload trips the
# validator first.
if [[ -n "$TOKEN" ]]; then
    section "Oyon contract probe (auth'd)"
    BAD_BATCH='{"session_id":"contract-probe-no-such-session","events":[{"window_start":"2026-05-10T00:00:00Z","window_end":"2026-05-10T00:00:10Z","duration_ms":10000,"expected_samples":10,"dominant_emotion":"happy","probabilities":{"neutral":0.125,"happy":0.125,"sad":0.125,"surprise":0.125,"anger":0.125,"fear":0.125,"disgust":0.125},"valence":0.1,"arousal":0.05,"confidence":0.5,"entropy":1.5,"valid_frames":6,"missing_face_ratio":0.1,"capture_mode":"local-browser","consent_version":"fer-consent-v1"}]}'
    out_body=$(mktemp)
    bad_status=$(curl $INSECURE_ARG -sS -o "$out_body" -w "%{http_code}" \
        -X POST -H "Content-Type: application/json" "${AUTH_HDR[@]+"${AUTH_HDR[@]}"}" \
        -d "$BAD_BATCH" "$BASE_URL/api/addons/oyon/emotion-records" 2>/dev/null || echo 000)
    if [[ "$bad_status" == "400" ]] && grep -q "sum close to 1" "$out_body" 2>/dev/null; then
        printf '  %s✓%s %-46s validator caught 7-of-8 sum (400 + correct error)\n' "$GRN" "$CLR" "POST emotion-records (bad sum)"
        PASS=$((PASS+1))
    elif [[ "$bad_status" == "400" ]]; then
        printf '  %s!%s %-46s 400 received but error message unexpected\n' "$YEL" "$CLR" "POST emotion-records (bad sum)"
        WARN=$((WARN+1))
        (( VERBOSE )) && { echo "    body:"; head -c 300 "$out_body" | sed 's/^/      /'; echo; }
    else
        printf '  %s✗%s %-46s expected 400 (validator), got %s\n' "$RED" "$CLR" "POST emotion-records (bad sum)" "$bad_status"
        FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("$CURRENT_CAT")
        (( VERBOSE )) && { echo "    body:"; head -c 300 "$out_body" | sed 's/^/      /'; echo; }
    fi
    rm -f "$out_body"
fi

# ── 7. Security headers ────────────────────────────────────────────────────
section "Security headers"
header_check "$BASE_URL/api/health" "X-Content-Type-Options" "nosniff"
header_check "$BASE_URL/"           "X-Frame-Options"        "DENY|SAMEORIGIN"
header_check "$BASE_URL/"           "Referrer-Policy"        "."
header_check "$BASE_URL/"           "Content-Security-Policy" "default-src|script-src"
header_check "$BASE_URL/"           "Strict-Transport-Security" "max-age" || true   # only on HTTPS

# ── 8. Response timing sanity ──────────────────────────────────────────────
# Anything > 5000 ms on a static route signals nginx misconfig or back-pressure.
# Reject status≠200 first — a TLS/connect failure can return in 20ms and would
# otherwise look "fast" in the timing column.
section "Response timing"
for url in "$BASE_URL/api/health" "$BASE_URL/api/ready" "$BASE_URL/"; do
    out=$(curl $INSECURE_ARG -sS -o /dev/null -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 99")
    code="${out% *}"; t="${out#* }"
    ms=$(awk -v s="$t" 'BEGIN { printf "%d", s*1000 }')
    label="${url#"$BASE_URL"}"; [[ -z "$label" ]] && label="/"
    if [[ "$code" != "200" ]]; then
        printf '  %s✗%s %-46s status %s in %sms (no-go for timing)\n' "$RED" "$CLR" "$label" "$code" "$ms"
        FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("Timing")
    elif (( ms < 1000 )); then
        printf '  %s✓%s %-46s %sms\n' "$GRN" "$CLR" "$label" "$ms"; PASS=$((PASS+1))
    elif (( ms < 5000 )); then
        printf '  %s!%s %-46s %sms (slow)\n' "$YEL" "$CLR" "$label" "$ms"; WARN=$((WARN+1))
    else
        printf '  %s✗%s %-46s %sms (>5s)\n' "$RED" "$CLR" "$label" "$ms"; FAIL=$((FAIL+1)); FAILED_CATEGORIES+=("Timing")
    fi
done

# ── summary ────────────────────────────────────────────────────────────────
END_NS=$(date +%s%N 2>/dev/null || date +%s)
ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))
[[ "$ELAPSED_MS" -lt 0 ]] && ELAPSED_MS=$(( END_NS - START_NS ))   # fallback for non-ns date
TOTAL=$((PASS+FAIL+WARN+SKIP))

printf '\n%s═══ summary ═══%s\n' "$BLU" "$CLR"
printf '  %s✓ PASS%s : %d\n' "$GRN" "$CLR" "$PASS"
printf '  %s! WARN%s : %d  %s(operational, not deploy-blocking)%s\n' "$YEL" "$CLR" "$WARN" "$DIM" "$CLR"
printf '  %s✗ FAIL%s : %d\n' "$RED" "$CLR" "$FAIL"
printf '  total  : %d  in %dms\n' "$TOTAL" "$ELAPSED_MS"

if (( FAIL > 0 )); then
    printf '\n%sFailed categories:%s %s\n' "$RED" "$CLR" "$(printf '%s\n' "${FAILED_CATEGORIES[@]}" | sort -u | paste -sd ', ' -)"
    printf 'Re-run with %sROHY_VERBOSE=1%s for response bodies on FAILs.\n' "$DIM" "$CLR"
    exit 1
fi
exit 0
