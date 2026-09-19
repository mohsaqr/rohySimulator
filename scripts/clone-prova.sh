#!/usr/bin/env bash
# Clone the Prova checkout that Rohy's Playwright reporter lives in.
#
# WHY THIS EXISTS. playwright.config.js adds the Prova reporter only when
# ../prova/reporters/playwright.mjs exists. Without it the e2e job passes
# PROVA_URL/PROVA_TOKEN to a reporter that was never loaded and records
# NOTHING — silently, because a reporter that does not load cannot warn.
# Measured 2026-09-19: secrets present and masked, no build in Prova.
#
# WHY A DEPLOY KEY. mohsaqr/prova is private, and a job's GITHUB_TOKEN is
# scoped to the repository it runs in, whoever owns the others. A read-only
# deploy key is the least privilege that works: it grants read on exactly one
# repository and nothing else, unlike a personal access token, which carries
# the whole account.
#
# Only the reporters are needed, so this is a blobless sparse clone.
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

repo="git@github.com:mohsaqr/prova.git"

if [[ -z "${PROVA_DEPLOY_KEY:-}" ]]; then
    # Not an error: forks and secret-less PRs must still run the suite. The
    # reporter is simply absent and the job is a plain e2e run.
    echo "clone-prova: PROVA_DEPLOY_KEY not set — skipping; this run will not report to Prova." >&2
    exit 0
fi

key_file="$(mktemp)"
# The key never lands in the work tree: this tree is copied into the Docker
# runtime image, and git would persist a credential-bearing remote in
# .git/config. Removed on every exit path, including failure.
cleanup() { rm -f "$key_file"; }
trap cleanup EXIT

printf '%s\n' "$PROVA_DEPLOY_KEY" > "$key_file"
chmod 600 "$key_file"

# A FAILED clone degrades exactly like a missing key: warn, skip, carry on.
# Reporting is not what the e2e job is for, and failing the suite over a
# credential turns main red while saying nothing about the software.
# BatchMode + StrictHostKeyChecking=accept-new so a runner with no known_hosts
# and no terminal fails fast instead of hanging on a prompt.
# EXPORTED, not set per-command: `--filter=blob:none` makes a partial clone,
# so `sparse-checkout` below triggers a second fetch from the promisor remote.
# Scoping the ssh command to the clone alone leaves that fetch unauthenticated
# and it fails with "could not fetch ... from promisor remote" AFTER the clone
# appears to succeed.
export GIT_SSH_COMMAND="ssh -i $key_file -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

if ! git clone --depth 1 --filter=blob:none --sparse "$repo" "$destination" 2>&1; then
    echo "clone-prova: clone FAILED (check the PROVA_DEPLOY_KEY secret and the deploy key on mohsaqr/prova)" >&2
    echo "clone-prova: continuing without the reporter — this run will not report to Prova." >&2
    rm -rf "$destination"
    exit 0
fi

git -C "$destination" sparse-checkout set reporters

if [[ ! -f "$destination/reporters/playwright.mjs" ]]; then
    echo "clone-prova: reporters/playwright.mjs missing after clone — not reporting." >&2
    rm -rf "$destination"
    exit 0
fi
echo "clone-prova: reporter available at $destination/reporters/playwright.mjs"
