#!/usr/bin/env bash
# Clone the Prova checkout Rohy's Playwright reporter lives in.
#
# playwright.config.js adds the Prova reporter only when
# ../prova/reporters/playwright.mjs exists, so without this the e2e job runs
# the suite and records NOTHING — silently, because a reporter that never
# loads cannot warn. The secrets alone are not enough (measured 2026-09-19:
# PROVA_URL/PROVA_TOKEN present and masked, no run posted).
#
# Only the reporters are needed, so this is a blobless sparse clone rather
# than the whole repo.
#
# Authentication uses a one-shot HTTP header rather than a token in the
# remote URL: git persists a credential-bearing URL in .git/config, and this
# tree is copied into the Docker runtime image.
set -euo pipefail

destination="${1:-}"
if [[ -z "$destination" ]]; then
    echo "usage: $0 <destination>" >&2
    exit 2
fi
if [[ -e "$destination" ]]; then
    echo "clone-prova: destination already exists: $destination" >&2
    exit 1
fi

repo="https://github.com/mohsaqr/prova.git"

if [[ -z "${PROVA_GIT_TOKEN:-}" ]]; then
    # Not an error: forks and secret-less PRs must still run the suite. The
    # reporter is simply absent and the job is a plain e2e run.
    echo "clone-prova: PROVA_GIT_TOKEN not set — skipping; the e2e run will not report to Prova." >&2
    exit 0
fi

basic_auth="$(printf 'x-access-token:%s' "$PROVA_GIT_TOKEN" | base64 | tr -d '\r\n')"
git -c "http.extraHeader=Authorization: Basic $basic_auth" \
    clone --depth 1 --filter=blob:none --sparse "$repo" "$destination"
unset basic_auth
git -C "$destination" sparse-checkout set reporters

if [[ ! -f "$destination/reporters/playwright.mjs" ]]; then
    echo "clone-prova: reporters/playwright.mjs missing after clone" >&2
    exit 1
fi
echo "clone-prova: reporter available at $destination/reporters/playwright.mjs"
