#!/usr/bin/env bash
# production/deploy.sh — LEGACY PATH; not production-safe by default.
#
# This is an old SSH-pull-restart script that predates the supported
# deployment flow (deploy/bootstrap.sh → preflight → smoke → rollback).
# It does NOT run preflight, has no rollback, and has no smoke check;
# a bad commit in main rolls straight to production with no guardrails.
#
# It is preserved only because some operators still have muscle memory
# for it. New deploys should use one of the documented paths in README:
#
#   Linux/systemd:  sudo deploy/bootstrap.sh ...
#                   then deploy/preflight.sh && systemctl restart rohy
#                   and  scripts/smoke.sh https://your-host/rohy
#
#   Docker:         docker compose -f deploy/docker/compose.yml up -d --build
#                   then  scripts/smoke.sh https://your-host/rohy
#
# To proceed with this legacy script anyway (you accept the lack of
# preflight/rollback/smoke), set PRODUCTION_DEPLOY_FORCE=1.

set -euo pipefail

if [ "${PRODUCTION_DEPLOY_FORCE:-0}" != "1" ]; then
    cat >&2 <<'EOF'
==============================================================================
  REFUSING TO RUN — production/deploy.sh is the LEGACY deploy path.

  It has no preflight, no rollback, and no smoke check. Use one of:

    Linux/systemd:
      sudo deploy/bootstrap.sh --frontend-url=https://your-host/rohy
      deploy/preflight.sh
      sudo systemctl restart rohy
      scripts/smoke.sh https://your-host/rohy

    Docker:
      docker compose -f deploy/docker/compose.yml up -d --build
      scripts/smoke.sh https://your-host/rohy

  If you really need this script (you accept the lack of guardrails),
  re-run with:

      PRODUCTION_DEPLOY_FORCE=1 production/deploy.sh

==============================================================================
EOF
    exit 1
fi

echo "[deploy.sh] PRODUCTION_DEPLOY_FORCE=1 — proceeding with legacy SSH-pull deploy."
echo "[deploy.sh] No preflight, no rollback, no smoke. You're on your own."

# Load .env
if [ ! -f .env ]; then
  echo ".env file not found"
  exit 1
fi

set -a
source .env
set +a

# Basic validation
: "${SSH_KEY_PATH:?Missing SSH_KEY_PATH}"
: "${SSH_USER:?Missing SSH_USER}"
: "${SSH_HOST:?Missing SSH_HOST}"
: "${REMOTE_DIR:?Missing REMOTE_DIR}"

SSH_CMD="ssh -i ${SSH_KEY_PATH} -p ${SSH_PORT:-22} \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  ${SSH_USER}@${SSH_HOST}"

echo "== Deploying to ${SSH_USER}@${SSH_HOST} =="

$SSH_CMD <<EOF
  set -e

  cd ${REMOTE_DIR}

  git fetch --all --prune
  git pull --ff-only

  npm ci

  # If your repo builds both frontend and backend:
  if npm run | grep -q " build"; then
    npm run build
  fi

  sudo systemctl restart ${SYSTEMD_SERVICE}
  sudo nginx -t
  sudo systemctl reload nginx
EOF

echo "✅ Deployment finished"
