#!/usr/bin/env bash
# scripts/smoke-deployed.sh — run the read-only smoke battery against a DEPLOYED
# instance and report the result to Prova against the build that instance is
# actually serving.
#
#   scripts/smoke-deployed.sh https://rohy.lacarm.com
#
# This is the battery's upgrade hook. `bin/rohy-update apply` already runs
# post_verify (scripts/post-verify-rohy.sh -> tech-test.sh) and rolls back when
# it fails; this adds the Playwright-run, Prova-recorded half, so an upgrade
# leaves evidence in the same place a CI run does.
#
# Safety: every check in tests/smoke/ is read-only and unauthenticated. It never
# logs in, never writes and never touches case or learner data, which is what
# makes it safe against production. Do NOT point the e2e suite (tests/e2e/) at a
# real deployment — that one seeds and mutates a database.
#
# Prova reporting is optional. With PROVA_URL + PROVA_TOKEN the run is posted;
# without them the reporter does nothing and this is simply a smoke run.
#
# Environment:
#   PROVA_URL, PROVA_TOKEN   post the run to Prova (needs results:write on rohy;
#                            the token must carry gate=1 and belong to a PERSON
#                            account for the result to count toward the gate)
#   ROHY_INSECURE=0          refuse self-signed certificates (default: allow, to
#                            match the deploy hub's verifier)
#   PROVA_LABEL              label for the run in Prova (default: deployed-smoke)
#
# Exit codes: 0 all checks passed · 1 a check failed · 2 bad usage or unreachable

set -uo pipefail

TARGET="${1:-${ROHY_SMOKE_URL:-}}"
if [[ -z "$TARGET" ]]; then
    echo "usage: $0 <base-url>   (e.g. $0 https://rohy.lacarm.com)" >&2
    exit 2
fi
TARGET="${TARGET%/}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

INSECURE_ARG=""
[[ "${ROHY_INSECURE:-1}" != "0" ]] && INSECURE_ARG="-k"

# Read the build from the TARGET, not from this working copy. Without this the
# Prova reporter falls back to the local package.json and would label a remote
# deployment with whatever version this checkout happens to sit on — quietly
# attributing results to the wrong build.
echo "==> reading the build from ${TARGET}/api/health"
HEALTH=$(curl $INSECURE_ARG -sS --max-time 15 "${TARGET}/api/health" 2>/dev/null || echo '')
if [[ -z "$HEALTH" ]]; then
    echo "✗ ${TARGET}/api/health is unreachable — nothing to smoke." >&2
    exit 2
fi

VERSION=$(printf '%s' "$HEALTH" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  try { process.stdout.write(String(JSON.parse(s).version ?? "")); } catch { process.stdout.write(""); }
});' 2>/dev/null)

if [[ -z "$VERSION" || "$VERSION" == "unknown" ]]; then
    echo "✗ ${TARGET} did not report a usable version (got: ${VERSION:-<none>})." >&2
    exit 2
fi
echo "    build under test: $VERSION"

# The deployed artifact's provenance is the instance's own version. We do not
# claim a commit: this checkout's HEAD is not necessarily what that host runs,
# and asserting otherwise would put a false commit on a real build record.
export ROHY_SMOKE_URL="$TARGET"
export PROVA_BUILD_VERSION="$VERSION"
export PROVA_LABEL="${PROVA_LABEL:-deployed-smoke}"

if [[ -n "${PROVA_URL:-}" && -n "${PROVA_TOKEN:-}" ]]; then
    echo "==> smoke against $TARGET (reporting to $PROVA_URL)"
else
    echo "==> smoke against $TARGET (PROVA_URL/PROVA_TOKEN unset — not reporting)"
fi

npx playwright test --config=playwright.smoke.config.js
STATUS=$?

if [[ $STATUS -eq 0 ]]; then
    echo "✓ deployed smoke passed against $VERSION"
else
    echo "✗ deployed smoke FAILED against $VERSION" >&2
fi
exit $STATUS
