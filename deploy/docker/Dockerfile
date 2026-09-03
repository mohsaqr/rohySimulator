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
#
# The 3D patient room (`rohy-3d-patient-room`, "file:../3D") is a second
# sibling. For a private repository, pass its credential as a BuildKit secret:
#   docker build --secret id=room3d_token,env=ROOM3D_GIT_TOKEN ...
# The pinned ref/version live in scripts/room3d-version.json. Credentials are
# never put in a build argument or Git remote, and clone-room3d.sh removes
# repository metadata before the package reaches the runtime image.

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

# The 3D patient room beside rohy as well ("file:../3D"). Raw ES modules:
# nothing to build, so no install step. The optional secret is consumed only
# by this RUN and the helper removes .git before the layer is committed.
WORKDIR /workspace
COPY scripts/clone-room3d.sh scripts/room3d-version.json /workspace/room3d-bootstrap/
RUN --mount=type=secret,id=room3d_token,required=false \
    if [ -s /run/secrets/room3d_token ]; then \
        export ROOM3D_GIT_TOKEN="$(cat /run/secrets/room3d_token)"; \
    fi; \
    bash /workspace/room3d-bootstrap/clone-room3d.sh /workspace/3D

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
# `scripts/` must land BEFORE npm install, not with the `COPY . .` below.
# postinstall → `setup:oyon` → `verify:oyon` → `node
# scripts/verify-oyon-install.mjs`, so without this npm install dies with
# MODULE_NOT_FOUND and takes the whole image build with it. The verifier
# imports only node built-ins, so the directory alone is enough.
#
# This is the same two-gate Docker trap recorded in CLAUDE.md, in its other
# form: not "a root file missed by directory COPYs", but "a file that exists
# in the repo yet not YET in the layer that needs it". Adding a postinstall
# step means checking what the install layer can actually see.
COPY scripts ./scripts
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
LABEL org.opencontainers.image.licenses="LicenseRef-Carm-Research-License"

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
# server/routes/analytics-routes.js imports shared analytics + oyon logic from
# src/ (momentsJoin.js, turnRows.js, caseInsights.js and their transitive
# src/components/oyon/* deps). These live under src/, not server/, so the
# directory-level COPYs above miss them — without this the container crashes on
# boot with ERR_MODULE_NOT_FOUND for momentsJoin.js and never becomes healthy.
COPY --from=builder --chown=node:node /workspace/rohy/src ./src
# OyonR/ ships the standalone HTML/JS/wasm/onnx assets that Express
# serves at /oyon/* and /standalone/*; without it those routes 404
# in the container.
COPY --from=builder --chown=node:node /workspace/rohy/OyonR ./OyonR
# (The lab catalogue used to need two explicit COPYs here. It lived at the repo
# root, the directory-level COPYs above missed it, and the runtime image shipped
# with an empty lab table until someone noticed. Both files now live in
# server/data/ beside radiology_database.json, so `COPY … /server ./server`
# above carries them and there is no special case left to forget.)
# Repo-root CHANGELOG.md. `server/routes/help-routes.js` reads it via
# `join(REPO_ROOT, 'CHANGELOG.md')` to power the in-app "What's new" surface.
# It lives at the repo root (not under server/), so the directory-level COPYs
# above miss it — without this line the release-notes endpoint 500s with
# `release_notes_unavailable` in the container. (.dockerignore re-includes it
# past the blanket `*.md` exclusion.)
COPY --from=builder --chown=node:node /workspace/rohy/CHANGELOG.md ./CHANGELOG.md
# Licensing artifacts. The Carm Research License requires third-party notices
# to travel with every copy, so an image without these ships in breach — and
# that bites hardest when the image is built with INCLUDE_PIPER=1, which
# redistributes GPL-3.0 software (see NOTICE.md). Same two-gate trap as
# CHANGELOG.md above: NOTICE.md also needs the `!NOTICE.md` re-include in
# .dockerignore to survive the blanket `*.md` exclusion. LICENSE has no
# extension and is never excluded; `licenses/` is a directory, likewise.
# tests/server/license-contract.test.js pins all three.
COPY --from=builder --chown=node:node /workspace/rohy/LICENSE ./LICENSE
COPY --from=builder --chown=node:node /workspace/rohy/NOTICE.md ./NOTICE.md
COPY --from=builder --chown=node:node /workspace/rohy/licenses ./licenses
COPY --from=builder --chown=node:node /workspace/dynajs /opt/dynajs
COPY --from=builder --chown=node:node /workspace/3D /opt/3D

# rohy's package.json declares dynajs at "file:../dynajs" and the 3D room at
# "file:../3D". Recreate that relative layout: both are siblings of /opt/rohy.
RUN ln -snf /opt/dynajs ../dynajs && ln -snf /opt/3D ../3D

# Optional Piper venv (empty dir if INCLUDE_PIPER=0 — TTS still works via
# Kokoro/Google/OpenAI; admin can switch the provider in Settings).
COPY --from=piper-builder --chown=node:node /piper-out/server/data/piper ./server/data/piper

COPY --chown=node:node deploy/docker/entrypoint.sh /usr/local/bin/rohy-entrypoint
RUN chmod +x /usr/local/bin/rohy-entrypoint

# Runtime uploads (body-map silhouettes land in public/uploads/bodymap — see
# server/routes/uploads-routes.js). The repo's public/ tree is build-input
# only (Vite bakes it into frontend/), so the directory does not exist in the
# image unless we create it — and a named volume mounted over a NONEXISTENT
# path is created root-owned, which breaks writes for the node user. Create
# it with the right ownership so the rohy-uploads volume inherits it.
RUN mkdir -p /opt/rohy/public/uploads && chown -R node:node /opt/rohy/public

# Persistent state lives in volumes so `docker compose down && up` doesn't
# wipe the DB, force a 330 MB Kokoro re-download, or drop uploaded images.
VOLUME ["/var/lib/rohy", "/var/cache/rohy-hf", "/opt/rohy/public/uploads"]

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
