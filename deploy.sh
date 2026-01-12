#!/usr/bin/env bash
set -euo pipefail

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
