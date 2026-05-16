#!/usr/bin/env bash
# Docs maintenance gate (Stage 7).
#
# Fails the build if the generated reference has drifted from source — i.e.
# someone changed a route / schema / env var / CLI without regenerating the
# reference. This is what keeps "generated reference never lies" true over
# time (DOCUMENTATION-PLAN §1, §7).
#
# Also validates the OpenAPI document is parseable JSON and that the
# VitePress site builds with dead-link enforcement ON.
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> Regenerating reference from source"
npm run --silent docs:gen:api
npm run --silent docs:gen:data
npm run --silent docs:gen:config
npm run --silent docs:gen:cli

echo "==> Checking for drift (generated docs must match committed)"
if ! git diff --quiet -- docs/reference; then
  echo "ERROR: generated reference is out of date. Run the docs:gen:* scripts and commit:" >&2
  git --no-pager diff --stat -- docs/reference >&2
  exit 1
fi

echo "==> Validating OpenAPI document"
node -e "JSON.parse(require('node:fs').readFileSync('docs/reference/api/openapi.json','utf8')); console.log('openapi.json: valid JSON')"

echo "==> Building docs (dead-link enforcement on)"
DOCS_BASE=/ npm run --silent docs:build >/dev/null
echo "==> Docs check passed"
