#!/bin/sh
# rohy container entrypoint.
#
# Responsibilities (idempotent — safe to run on every container start):
#   1. Generate a JWT_SECRET on first run if the operator didn't set one.
#      Persists to /var/lib/rohy/.secrets/jwt_secret so the same secret
#      survives container restarts (otherwise every restart logs out
#      every user).
#   2. Validate FRONTEND_URL is set when not in dev — bail out with a
#      clear error rather than letting the app boot into silent CORS 500s.
#   3. Pre-create the DB parent dir (volume might be empty on first run).
#   4. Exec the CMD (default: node server/server.js).
#
# Why a shell script instead of "just env vars in compose":
#   - JWT_SECRET should not be committed to docker-compose.yml or .env.
#     Auto-generating + persisting in a volume is the right default for
#     "I just want it running" deployments.
#   - The validation messages match the messages from validateEnv.js so
#     operators only have to learn one error vocabulary.

set -eu

SECRETS_DIR="${ROHY_SECRETS_DIR:-/var/lib/rohy/.secrets}"
JWT_FILE="${SECRETS_DIR}/jwt_secret"

# 1. JWT_SECRET ------------------------------------------------------------
if [ -z "${JWT_SECRET:-}" ]; then
    if [ -r "$JWT_FILE" ]; then
        JWT_SECRET="$(cat "$JWT_FILE")"
        export JWT_SECRET
        echo "[entrypoint] Loaded JWT_SECRET from $JWT_FILE"
    else
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
        # Use Node's crypto rather than /dev/urandom + base64: matches the
        # generator in deploy/env.example so re-using JWTs across deploys
        # would be byte-identical if the secret is rotated the same way.
        JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
        umask 077
        printf '%s' "$JWT_SECRET" > "$JWT_FILE"
        export JWT_SECRET
        echo "[entrypoint] Generated a fresh JWT_SECRET and stored it at $JWT_FILE"
        echo "[entrypoint] Back this file up if you ever recreate the volume — losing it logs everyone out."
    fi
fi

# 2. FRONTEND_URL ----------------------------------------------------------
# Mirror the validateEnv.js policy: required in production, warn elsewhere.
if [ "${NODE_ENV:-production}" = "production" ] && [ -z "${FRONTEND_URL:-}" ]; then
    echo "[entrypoint] FATAL: FRONTEND_URL is not set." >&2
    echo "[entrypoint] Browsers reaching this container will see CORS 500s on every asset." >&2
    echo "[entrypoint] Fix one of these in your compose file or .env:" >&2
    echo "[entrypoint]   FRONTEND_URL=https://your-deploy/rohy" >&2
    echo "[entrypoint]   FRONTEND_URL=http://localhost:4000     # dev only" >&2
    exit 1
fi

# 3. DB parent dir ---------------------------------------------------------
DB_PATH="${ROHY_DB:-/var/lib/rohy/database.sqlite}"
DB_PARENT="$(dirname "$DB_PATH")"
mkdir -p "$DB_PARENT"

# 4. HF cache --------------------------------------------------------------
mkdir -p "${TRANSFORMERS_CACHE:-/var/cache/rohy-hf}"

# 5. First-boot admin bootstrap --------------------------------------------
# Three ways an instance reaches its first admin. All apply only while the
# users table is empty; announce which one is live so a stuck operator can see
# it in the boot log rather than guessing at the login screen.
if [ -n "${ROHY_ADMIN_USERNAME:-}" ] && [ -n "${ROHY_ADMIN_PASSWORD:-}" ]; then
    echo "[entrypoint] admin bootstrap: provisioning '${ROHY_ADMIN_USERNAME}' from ROHY_ADMIN_* (first boot only, if users table is empty)." >&2
elif [ "${ALLOW_DEFAULT_USERS:-0}" = "1" ]; then
    echo "[entrypoint] WARNING: ALLOW_DEFAULT_USERS=1 — admin/admin123 will be seeded if users table is empty." >&2
    echo "[entrypoint] After first login + password change, REMOVE this env var and restart the container." >&2
else
    echo "[entrypoint] admin bootstrap: none configured — the FIRST account registered through the UI will claim this instance as admin." >&2
    echo "[entrypoint] To provision an admin instead, set ROHY_ADMIN_USERNAME + ROHY_ADMIN_PASSWORD and start with an empty DB volume." >&2
fi

# 6. Exec the command ------------------------------------------------------
exec "$@"
