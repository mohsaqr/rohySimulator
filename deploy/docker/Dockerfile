# syntax=docker/dockerfile:1.7
#
# rohy — production container image.
#
# Multi-stage build:
#   1. builder  — clones the dynajs sibling, installs full deps, runs vite build
#   2. piper    — optional, builds the Piper TTS Python venv in an isolated layer
#   3. runtime  — slim Node 22 + production deps + built frontend + (optional) Piper
#
# Why slim, not alpine:
#   sqlite3 and @huggingface/transformers ship native modules that link
#   cleanly against glibc. musl (alpine) requires rebuild flags and
#   sometimes runtime-loader quirks. Image size delta (~80 MB) isn't worth
#   the boot-time surprises.
#
# Build:
#   docker build -f deploy/docker/Dockerfile -t rohy:latest .
#
# Build with Piper TTS bundled:
#   docker build -f deploy/docker/Dockerfile --build-arg INCLUDE_PIPER=1 -t rohy:latest .
#
# Pin the dynajs commit (recommended for reproducible builds):
#   docker build -f deploy/docker/Dockerfile \
#     --build-arg DYNAJS_GIT_REF=<sha-or-tag> -t rohy:latest .

ARG NODE_VERSION=22-bookworm-slim
ARG INCLUDE_PIPER=0
ARG DYNAJS_GIT_URL=https://github.com/mohsaqr/dynajs.git
ARG DYNAJS_GIT_REF=main

# ===========================================================================
# Stage 1: builder
# ===========================================================================
FROM node:${NODE_VERSION} AS builder

ARG DYNAJS_GIT_URL
ARG DYNAJS_GIT_REF

# Build deps: git for cloning dynajs, python3/make/g++ for sqlite3 native
# build, curl for OyonR/scripts/download-models.sh (fetches the ~93 MB
# MediaPipe + ONNX vendor bundles that are gitignored — see .gitignore).
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
        git ca-certificates python3 make g++ curl \
 && rm -rf /var/lib/apt/lists/*

# Clone + build dynajs FIRST so its dist/ exists before rohy's npm install
# runs. Layer is cached on DYNAJS_GIT_REF.
WORKDIR /workspace
RUN git clone --depth 1 --branch "${DYNAJS_GIT_REF}" "${DYNAJS_GIT_URL}" dynajs \
 || git clone "${DYNAJS_GIT_URL}" dynajs && cd dynajs && git checkout "${DYNAJS_GIT_REF}"
WORKDIR /workspace/dynajs
# Use install (not ci) so the prepare script that produces dist/ runs.
RUN npm install --prefer-offline --no-audit --no-fund

# Copy rohy and install. The bind-mount of package*.json gives a cached
# layer when source changes but deps don't. OyonR/ has to be copied
# BEFORE `npm install` because rohy's package.json declares
# `"oyon": "file:./OyonR"` — npm needs that directory present at
# install time to satisfy the local file dep. Without it, the build
# either fails or silently skips Oyon, and the runtime image ships
# without the local module.
WORKDIR /workspace/rohy
COPY package.json package-lock.json* ./
COPY OyonR ./OyonR
# `npm install` triggers our postinstall hook which calls
# OyonR/scripts/download-models.sh — that fetches the ~93 MB MediaPipe +
# ONNX bundles + emotion models. The script is idempotent (skips if
# already present) and the postinstall is `|| true` tolerant, so we
# re-run it explicitly here to FAIL THE BUILD if the download didn't
# succeed (vs. shipping a runtime image without face/emotion assets).
RUN npm install --prefer-offline --no-audit --no-fund \
 && bash OyonR/scripts/download-models.sh

# Now bring in source and build.
COPY . .
RUN npm run build

# Strip the built tree to production-only deps so the runtime stage copies
# fewer files. Keep dynajs reachable at the same relative path.
RUN npm prune --omit=dev --no-audit --no-fund

# ===========================================================================
# Stage 2: piper-builder (optional — gated by INCLUDE_PIPER)
# ===========================================================================
FROM node:${NODE_VERSION} AS piper-builder
ARG INCLUDE_PIPER

# Build Piper venv only when requested. The bind mount + script approach
# keeps the venv portable across runtime architectures (the wheel ships
# espeak-ng inside it, no system deps needed at runtime).
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /piper-out
COPY server/scripts/install-piper.sh ./install-piper.sh

# Mimic the directory layout the runtime expects: /piper-out/data/piper/.
RUN if [ "${INCLUDE_PIPER}" = "1" ]; then \
        mkdir -p /piper-out/server/data/piper && \
        cd /piper-out && \
        bash install-piper.sh ; \
    else \
        echo "INCLUDE_PIPER not set — skipping Piper venv (TTS will use Kokoro/Google/OpenAI)" ; \
        mkdir -p /piper-out/server/data/piper ; \
    fi

# ===========================================================================
# Stage 3: runtime
# ===========================================================================
FROM node:${NODE_VERSION} AS runtime
ARG INCLUDE_PIPER

LABEL org.opencontainers.image.source="https://github.com/mohsaqr/rohySimulator"
LABEL org.opencontainers.image.description="rohy — Virtual Patient Simulation Platform"
LABEL org.opencontainers.image.licenses="MIT"

# Runtime essentials only. python3 stays in case the operator wants to
# re-run install-piper.sh inside a running container; sqlite3 makes
# incident triage possible without exec'ing a separate image.
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
        ca-certificates curl sqlite3 tini \
        $(if [ "${INCLUDE_PIPER}" = "1" ]; then echo "python3 python3-venv"; fi) \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/rohy /var/lib/rohy /var/cache/rohy-hf \
 && chown -R node:node /opt/rohy /var/lib/rohy /var/cache/rohy-hf

WORKDIR /opt/rohy

# Copy the built rohy + pruned node_modules + dynajs from the builder.
COPY --from=builder --chown=node:node /workspace/rohy/package.json ./
COPY --from=builder --chown=node:node /workspace/rohy/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/rohy/server ./server
COPY --from=builder --chown=node:node /workspace/rohy/scripts ./scripts
COPY --from=builder --chown=node:node /workspace/rohy/migrations ./migrations
COPY --from=builder --chown=node:node /workspace/rohy/frontend ./frontend
COPY --from=builder --chown=node:node /workspace/rohy/dist ./dist
# OyonR/ ships the standalone HTML/JS/wasm/onnx assets that Express
# serves at /oyon/* and /standalone/*; without it those routes 404
# in the container.
COPY --from=builder --chown=node:node /workspace/rohy/OyonR ./OyonR
# Repo-root lab catalogue files. `server/services/labDatabase.js` and
# `scripts/seed-lab-tests-from-json.js` both read these via
# `path.resolve(__dirname, '../../Lab_database.json')` / `heart.txt`.
# They aren't under server/ so the directory-level COPYs above miss them,
# which used to ship the runtime image with an empty lab table.
COPY --from=builder --chown=node:node /workspace/rohy/Lab_database.json ./Lab_database.json
COPY --from=builder --chown=node:node /workspace/rohy/heart.txt ./heart.txt
COPY --from=builder --chown=node:node /workspace/dynajs /opt/dynajs

# rohy's package.json declares dynajs at "file:../dynajs". Recreate that
# relative layout: /opt/dynajs is the sibling of /opt/rohy.
RUN ln -snf /opt/dynajs ../dynajs

# Optional Piper venv (empty dir if INCLUDE_PIPER=0 — TTS still works via
# Kokoro/Google/OpenAI; admin can switch the provider in Settings).
COPY --from=piper-builder --chown=node:node /piper-out/server/data/piper ./server/data/piper

COPY --chown=node:node deploy/docker/entrypoint.sh /usr/local/bin/rohy-entrypoint
RUN chmod +x /usr/local/bin/rohy-entrypoint

# Persistent state lives in volumes so `docker compose down && up` doesn't
# wipe the DB or force a 330 MB Kokoro re-download.
VOLUME ["/var/lib/rohy", "/var/cache/rohy-hf"]

ENV NODE_ENV=production \
    PORT=4000 \
    ROHY_DB=/var/lib/rohy/database.sqlite \
    TRANSFORMERS_CACHE=/var/cache/rohy-hf \
    ROHY_TRUST_PROXY=loopback

EXPOSE 4000

USER node

# tini reaps zombies and forwards signals so SIGTERM reaches Node directly,
# enabling installGracefulShutdown to drain in-flight requests.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/rohy-entrypoint"]
CMD ["node", "server/server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1
