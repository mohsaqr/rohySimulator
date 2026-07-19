#!/usr/bin/env bash
# deploy/bundle-airgap.sh — produce a self-contained tarball for offline rohy installs.
#
# Why: the repo intentionally gitignores ~1 GB of binary deps (npm packages,
# Oyon model bundles, Piper voices, the Kokoro HF cache). Every fresh install
# pulls those from the network. Operators on air-gapped sites need a bundle
# that can install without ever touching the public internet. This script is
# the build side of that flow — it assumes you're on a connected build host
# with everything already downloaded, and packs it for the offline target.
#
# Two output formats:
#   --mode=source   Tarball of the repo + node_modules + Oyon vendor + Piper
#                   + (optionally) the HF cache and dynajs sibling. Operator
#                   extracts and runs the embedded airgap-install.sh. Needs
#                   node + sqlite3 + (nginx|caddy) already on target host.
#   --mode=docker   docker save'd image + compose.yml + Caddyfile + install.sh.
#                   Operator only needs docker on the target host.
#   --mode=both     Build both (default).
#
# Usage:
#   deploy/bundle-airgap.sh                                          # both, no HF cache
#   deploy/bundle-airgap.sh --mode=source --with-hf-cache --with-dynajs
#   deploy/bundle-airgap.sh --mode=docker --output=/srv/builds
#   deploy/bundle-airgap.sh --dry-run                                # plan only
#
# Output (default to ./dist/airgap/):
#   rohy-airgap-source-<sha>-<platform>-<date>.tar.gz   (and .sha256)
#   rohy-airgap-docker-<sha>-<platform>-<date>.tar.gz   (and .sha256)
#
# Each tarball contains a manifest.json at its root describing what's
# inside (platform, git sha, included packages, flags). Inspect with:
#     tar -xzOf rohy-airgap-source-*.tar.gz '*/manifest.json' | jq .

set -euo pipefail

# -- args ----------------------------------------------------------------
MODE="both"
OUTPUT_DIR=""
WITH_HF_CACHE=0
WITH_DYNAJS=0
WITH_PIPER="auto"   # auto | yes | no
SKIP_CHECKSUM=0
DRY_RUN=0

for arg in "$@"; do
    case "$arg" in
        --mode=source|--mode=docker|--mode=both) MODE="${arg#--mode=}" ;;
        --output=*)      OUTPUT_DIR="${arg#--output=}" ;;
        --with-hf-cache) WITH_HF_CACHE=1 ;;
        --with-dynajs)   WITH_DYNAJS=1 ;;
        --with-piper)    WITH_PIPER="yes" ;;
        --no-piper)      WITH_PIPER="no" ;;
        --skip-checksum) SKIP_CHECKSUM=1 ;;
        --dry-run)       DRY_RUN=1 ;;
        --help|-h)
            sed -n '2,32p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            printf 'unknown arg: %s (use --help)\n' "$arg" >&2
            exit 2 ;;
    esac
done

REPO_SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$REPO_SRC/dist/airgap}"

# Stamp every artifact with the source commit SHA so operators can match the
# bundle on the target host to a specific revision. Falls back to "nogit"
# when the build host has no .git (e.g. building from another tarball).
GIT_SHA="$(cd "$REPO_SRC" && git rev-parse --short HEAD 2>/dev/null || echo nogit)"
DATE_STAMP="$(date -u +%Y%m%d)"

# Platform stamp matters because the bundle ships native binaries (sqlite3,
# onnxruntime .so/.dylib, FBX2glTF) compiled for the BUILD host's OS+arch.
# A darwin/arm64 bundle will silently break on linux/amd64 — node_sqlite3
# fails to load, onnxruntime errors, etc. We embed the platform in the
# tarball name so operators can't accidentally grab the wrong one.
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"   # darwin | linux
HOST_ARCH="$(uname -m)"                              # arm64 | x86_64 | aarch64
PLATFORM="${HOST_OS}-${HOST_ARCH}"
STAMP="${GIT_SHA}-${PLATFORM}-${DATE_STAMP}"

# Cross-platform sha256 — GNU has sha256sum, BSD/macOS has shasum.
#
# Emits the standard `<hash>  <basename>` format (two spaces, GNU style)
# instead of just the hash. That's what `sha256sum -c file.sha256`
# expects, so the sidecars we write here can be verified with the
# vanilla command on the target host (and in CI):
#
#     cd dist/airgap && sha256sum -c rohy-airgap-source-*.sha256
#
# Using the basename (not the full path) keeps the sidecar
# self-contained — operators can move both files together without
# rewriting the checksum line.
sha256() {
    local file="$1"
    local dir basename
    dir="$(dirname "$file")"
    basename="$(basename "$file")"
    if command -v sha256sum >/dev/null 2>&1; then
        ( cd "$dir" && sha256sum "$basename" )
    else
        ( cd "$dir" && shasum -a 256 "$basename" )
    fi
}

# Pretty-print a size that handles both BSD du (uses -h) and reports MB.
sizeof() { du -sh "$1" 2>/dev/null | awk '{print $1}'; }

# -- preflight -----------------------------------------------------------
echo "=== rohy air-gap bundler ==="
printf 'repo            : %s\n' "$REPO_SRC"
printf 'output dir      : %s\n' "$OUTPUT_DIR"
printf 'mode            : %s\n' "$MODE"
printf 'commit          : %s\n' "$GIT_SHA"
printf 'platform        : %s\n' "$PLATFORM"
printf 'with hf cache   : %s\n' "$([[ $WITH_HF_CACHE -eq 1 ]] && echo yes || echo no)"
printf 'with dynajs     : %s\n' "$([[ $WITH_DYNAJS -eq 1 ]] && echo yes || echo no)"
printf 'with piper      : %s\n' "$WITH_PIPER"
printf 'dry-run         : %s\n' "$([[ $DRY_RUN -eq 1 ]] && echo yes || echo no)"
echo ""

# Platform warning — the bundle is platform-specific because of native
# modules (node-sqlite3, onnxruntime, FBX2glTF). Operators wanting to
# install on a different OS/arch must build on a matching host.
case "$PLATFORM" in
    linux-x86_64|linux-aarch64) ;;  # typical production targets, no warning
    *)
        cat <<EOF
NOTE: build host platform is $PLATFORM. Native modules in node_modules and
      server/data/piper/venv are compiled for this exact OS+arch. To deploy
      on a different platform (e.g. linux-x86_64 production server), you
      must rebuild the bundle on a matching host. The platform is stamped
      into the tarball name (rohy-airgap-source-<sha>-${PLATFORM}-<date>.tar.gz)
      and the manifest, and airgap-install.sh checks it on extraction.
EOF
        echo ""
        ;;
esac

# Source-mode prerequisites: the bundler does NOT fetch anything itself, so
# fail loud if the artifacts that need to be in the tarball aren't present.
if [[ "$MODE" == "source" || "$MODE" == "both" ]]; then
    if [[ ! -d "$REPO_SRC/node_modules" ]]; then
        echo "FATAL: $REPO_SRC/node_modules missing. Run 'npm install' on this build host first." >&2
        exit 1
    fi
    # OyonR vendor bundles live under node_modules and a few specific paths;
    # the canonical "did download-models.sh succeed?" probe is the existence
    # of face_landmarker.task or one of the EmotiEffLib ONNX files.
    if ! find "$REPO_SRC/OyonR" -name 'face_landmarker.task' -o -name '*.onnx' 2>/dev/null | grep -q .; then
        echo "FATAL: OyonR vendor assets missing. Run 'bash OyonR/scripts/download-models.sh' first." >&2
        exit 1
    fi
    for asset in \
        ort.min.mjs \
        ort-wasm-simd-threaded.mjs \
        ort-wasm-simd-threaded.wasm \
        ort-wasm-simd-threaded.asyncify.mjs \
        ort-wasm-simd-threaded.asyncify.wasm; do
        if [[ ! -s "$REPO_SRC/OyonR/standalone/vendor/onnxruntime-web/$asset" ]]; then
            echo "FATAL: required Oyon ONNX Runtime asset missing: $asset" >&2
            echo "       Run 'bash OyonR/scripts/download-models.sh' first." >&2
            exit 1
        fi
    done
fi

if (( WITH_HF_CACHE )); then
    HF_CACHE="${TRANSFORMERS_CACHE:-$HOME/.cache/huggingface}"
    if [[ ! -d "$HF_CACHE" ]]; then
        echo "FATAL: --with-hf-cache requested but $HF_CACHE doesn't exist." >&2
        echo "       Run: TRANSFORMERS_CACHE=$HF_CACHE node -e \"import('./server/services/kokoroTts.js').then(m => m.loadKokoro())\"" >&2
        exit 1
    fi
fi

if (( WITH_DYNAJS )); then
    DYNAJS_DIR="$(cd "$REPO_SRC/.." && pwd)/dynajs"
    if [[ ! -d "$DYNAJS_DIR" ]]; then
        echo "FATAL: --with-dynajs requested but $DYNAJS_DIR not found." >&2
        exit 1
    fi
fi

if [[ "$MODE" == "docker" || "$MODE" == "both" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
        if [[ "$MODE" == "docker" ]]; then
            echo "FATAL: --mode=docker requires docker on the build host." >&2
            exit 1
        else
            echo "WARN: docker not available — skipping docker bundle (mode=both will produce source only)." >&2
            MODE="source"
        fi
    fi
fi

mkdir -p "$OUTPUT_DIR"

# -- source bundle -------------------------------------------------------
build_source_bundle() {
    local stage="$OUTPUT_DIR/.stage-source-$STAMP"
    local root="$stage/rohy-airgap-${STAMP}"
    # Dry-run must not touch the filesystem — print the plan, return.
    # Without this guard the stage dir leaks across repeated dry-runs.
    if (( DRY_RUN )); then
        echo "[source] (dry-run) would stage repo at $root/repo"
        echo "  exclude: .git/, tmp/, dist/airgap/, server/database.sqlite*, server/.env, .env, *.log, .DS_Store"
        echo "  include: node_modules/ (~$(sizeof "$REPO_SRC/node_modules" 2>/dev/null || echo unknown))"
        echo "  include: OyonR/ (~$(sizeof "$REPO_SRC/OyonR" 2>/dev/null || echo unknown))"
        if [[ "$WITH_PIPER" != "no" ]] && [[ -d "$REPO_SRC/server/data/piper" ]]; then
            echo "  include: server/data/piper/ (~$(sizeof "$REPO_SRC/server/data/piper"))"
        fi
        (( WITH_HF_CACHE )) && echo "  include: hf-cache from $HF_CACHE (~$(sizeof "$HF_CACHE"))"
        (( WITH_DYNAJS ))   && echo "  include: dynajs from $DYNAJS_DIR"
        echo "[source] (dry-run) would tar -> $OUTPUT_DIR/rohy-airgap-source-${STAMP}.tar.gz"
        return
    fi
    rm -rf "$stage"
    mkdir -p "$root/repo"

    # Piper handling. "auto" includes it if server/data/piper/ exists, "no"
    # always excludes it (smaller bundle, browser-side TTS only), "yes"
    # requires the dir and refuses if missing.
    local piper_excludes=()
    if [[ "$WITH_PIPER" == "no" ]]; then
        piper_excludes=(--exclude='server/data/piper/')
        echo "[source] excluding server/data/piper/ (--no-piper)"
    elif [[ "$WITH_PIPER" == "yes" ]] && [[ ! -d "$REPO_SRC/server/data/piper" ]]; then
        echo "FATAL: --with-piper but $REPO_SRC/server/data/piper not present. Run server/scripts/install-piper.sh first." >&2
        exit 1
    elif [[ -d "$REPO_SRC/server/data/piper" ]]; then
        echo "[source] including server/data/piper/ ($(sizeof "$REPO_SRC/server/data/piper"))"
    fi

    echo "[source] staging repo (excluding .git, tmp, dist, db, env files)"
    # rsync with --exclude rules. We deliberately INCLUDE node_modules and
    # OyonR vendor assets because the whole point of this bundle is carrying
    # them across the air gap. The "${arr[@]+...}" empty-safe expansion is
    # required because macOS ships bash 3.2 where set -u treats an empty
    # array's `[@]` as unbound.
    rsync -a \
        --exclude='.git/' \
        --exclude='tmp/' \
        --exclude='dist/airgap/' \
        --exclude='server/database.sqlite*' \
        --exclude='server/.env' \
        --exclude='.env' \
        --exclude='*.log' \
        --exclude='.DS_Store' \
        "${piper_excludes[@]+"${piper_excludes[@]}"}" \
        "$REPO_SRC/" "$root/repo/"

    if (( WITH_HF_CACHE )); then
        echo "[source] adding HF cache from $HF_CACHE ($(sizeof "$HF_CACHE"))"
        mkdir -p "$root/hf-cache"
        rsync -a "$HF_CACHE/" "$root/hf-cache/"
    fi

    if (( WITH_DYNAJS )); then
        echo "[source] adding dynajs from $DYNAJS_DIR"
        mkdir -p "$root/dynajs"
        rsync -a --exclude='.git/' "$DYNAJS_DIR/" "$root/dynajs/"
    fi

    # Embed the offline installer. Heredoc keeps it inline with this script
    # so future edits don't have to hop between two files.
    cat > "$root/airgap-install.sh" <<'INSTALLER_EOF'
#!/usr/bin/env bash
# airgap-install.sh — install rohy from a pre-built bundle, no network needed.
#
# Run from inside the extracted tarball. Requires root (or sudo) on a Linux
# host with: node >=22, npm, sqlite3, (nginx|caddy if you want a proxy).
#
# Usage:
#   sudo ./airgap-install.sh \
#        --user=rohy \
#        --repo-dir=/opt/rohy \
#        --data-dir=/opt/data/rohy \
#        --frontend-url=https://your-host/rohy \
#        --proxy=nginx                 # nginx | caddy | none
set -euo pipefail

ROHY_USER=""
REPO_DIR="/opt/rohy"
DATA_DIR="/opt/data/rohy"
HF_DIR="/var/cache/rohy-hf"
ENV_FILE="/etc/rohy/env"
PORT=4000
FRONTEND_URL=""
PROXY="none"

for arg in "$@"; do
    case "$arg" in
        --user=*)         ROHY_USER="${arg#--user=}" ;;
        --repo-dir=*)     REPO_DIR="${arg#--repo-dir=}" ;;
        --data-dir=*)     DATA_DIR="${arg#--data-dir=}" ;;
        --hf-dir=*)       HF_DIR="${arg#--hf-dir=}" ;;
        --env-file=*)     ENV_FILE="${arg#--env-file=}" ;;
        --port=*)         PORT="${arg#--port=}" ;;
        --frontend-url=*) FRONTEND_URL="${arg#--frontend-url=}" ;;
        --proxy=*)        PROXY="${arg#--proxy=}" ;;
        --help|-h) sed -n '2,15p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
[[ -d "$BUNDLE/repo" ]] || { echo "no repo/ dir at $BUNDLE — run from extracted tarball root"; exit 2; }

# Platform check FIRST — it's read-only and platform mismatch is more
# fundamental than missing args/root. The bundle ships native binaries
# (node-sqlite3, onnxruntime .so/.dylib, FBX2glTF) compiled for the BUILD
# host's OS+arch. A mismatched bundle silently breaks at runtime — this
# catches it before we copy 1.8 GB into place. Override with
# SKIP_PLATFORM_CHECK=1 (e.g. for cross-compiled or browser-only deploys).
if [[ -f "$BUNDLE/manifest.json" ]] && [[ "${SKIP_PLATFORM_CHECK:-0}" != "1" ]]; then
    # `|| true` because grep returns 1 on no-match, which combines with
    # pipefail+set-e to abort the script. Old bundles without a platform
    # field should fall through gracefully, not crash here.
    bundle_plat=$(grep -oE '"platform"[[:space:]]*:[[:space:]]*"[^"]+"' "$BUNDLE/manifest.json" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    host_plat="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
    if [[ -n "$bundle_plat" && "$bundle_plat" != "$host_plat" ]]; then
        cat >&2 <<EOF
ERROR: platform mismatch.
       bundle was built for : $bundle_plat
       this host is         : $host_plat

Native modules (node-sqlite3, onnxruntime, FBX2glTF) will fail to load.
Rebuild the bundle on a host matching $host_plat, or override with:
       SKIP_PLATFORM_CHECK=1 sudo ./airgap-install.sh ...
EOF
        exit 1
    fi
fi

[[ $EUID -eq 0 ]] || { echo "must run as root (use sudo)"; exit 2; }
[[ -n "$ROHY_USER" ]] || { echo "missing --user=NAME"; exit 2; }
id -u "$ROHY_USER" >/dev/null 2>&1 || { echo "user $ROHY_USER does not exist; create with adduser first"; exit 2; }
[[ -n "$FRONTEND_URL" ]] || { echo "missing --frontend-url=URL"; exit 2; }

command -v node >/dev/null 2>&1 || { echo "node not on PATH — install it first (no network needed if you have a local mirror or a pre-staged .deb/.rpm)"; exit 2; }
command -v sqlite3 >/dev/null 2>&1 || echo "WARN: sqlite3 not on PATH — DB introspection during incidents will be harder"

echo "[airgap] copying repo to $REPO_DIR"
mkdir -p "$REPO_DIR"
rsync -a --delete --exclude='/server/database.sqlite*' "$BUNDLE/repo/" "$REPO_DIR/"
chown -R "$ROHY_USER:$ROHY_USER" "$REPO_DIR"

mkdir -p "$DATA_DIR" "$HF_DIR" "$(dirname "$ENV_FILE")"
chown -R "$ROHY_USER:$ROHY_USER" "$DATA_DIR" "$HF_DIR"

if [[ -d "$BUNDLE/hf-cache" ]]; then
    echo "[airgap] copying HF cache to $HF_DIR (Kokoro will run offline)"
    rsync -a "$BUNDLE/hf-cache/" "$HF_DIR/"
    chown -R "$ROHY_USER:$ROHY_USER" "$HF_DIR"
fi

if [[ -d "$BUNDLE/dynajs" ]]; then
    DYNAJS_DST="$(cd "$REPO_DIR/.." && pwd)/dynajs"
    echo "[airgap] placing dynajs sibling at $DYNAJS_DST"
    rsync -a "$BUNDLE/dynajs/" "$DYNAJS_DST/"
    chown -R "$ROHY_USER:$ROHY_USER" "$DYNAJS_DST"
fi

# Env file — generate fresh JWT, never reuse across deploys.
if [[ ! -f "$ENV_FILE" ]]; then
    echo "[airgap] writing $ENV_FILE (mode 0600 root:root)"
    JWT="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
    sed \
        -e "s|REPLACE_ME_WITH_A_LONG_RANDOM_STRING|${JWT}|" \
        -e "s|^FRONTEND_URL=.*|FRONTEND_URL=${FRONTEND_URL}|" \
        -e "s|^ROHY_DB=.*|ROHY_DB=${DATA_DIR}/database.sqlite|" \
        -e "s|^TRANSFORMERS_CACHE=.*|TRANSFORMERS_CACHE=${HF_DIR}|" \
        -e "s|^PORT=.*|PORT=${PORT}|" \
        "$REPO_DIR/deploy/env.example" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"
else
    echo "[airgap] $ENV_FILE exists — leaving alone"
fi

# Systemd unit
UNIT_DST=/etc/systemd/system/rohy.service
if [[ ! -f "$UNIT_DST" ]]; then
    echo "[airgap] installing systemd unit at $UNIT_DST"
    sed \
        -e "s|^User=.*|User=${ROHY_USER}|" \
        -e "s|^Group=.*|Group=${ROHY_USER}|" \
        -e "s|^WorkingDirectory=.*|WorkingDirectory=${REPO_DIR}|" \
        -e "s|^EnvironmentFile=.*|EnvironmentFile=${ENV_FILE}|" \
        -e "s|/opt/data/rohy|${DATA_DIR}|g" \
        -e "s|/var/cache/rohy-hf|${HF_DIR}|g" \
        -e "s|/opt/repos/rohy|${REPO_DIR}|g" \
        "$REPO_DIR/deploy/systemd/rohy.service.example" > "$UNIT_DST"
    chmod 644 "$UNIT_DST"
fi

# Reverse proxy (optional)
case "$PROXY" in
    nginx)
        if [[ ! -f /etc/nginx/conf.d/rohy.conf ]]; then
            sed "s|127.0.0.1:4000|127.0.0.1:${PORT}|g" \
                "$REPO_DIR/deploy/nginx/rohy.conf.example" > /etc/nginx/conf.d/rohy.conf
            echo "[airgap] /etc/nginx/conf.d/rohy.conf installed — EDIT server_name + cert paths, then nginx -t && systemctl reload nginx"
        fi ;;
    caddy)
        if [[ ! -f /etc/caddy/Caddyfile ]]; then
            sed "s|rohy:4000|127.0.0.1:${PORT}|g" \
                "$REPO_DIR/deploy/docker/Caddyfile" > /etc/caddy/Caddyfile
            echo "[airgap] /etc/caddy/Caddyfile installed — EDIT hostname, then systemctl reload caddy"
        fi ;;
    none) echo "[airgap] no reverse proxy configured (--proxy=none)" ;;
    *) echo "unknown proxy: $PROXY" >&2; exit 2 ;;
esac

systemctl daemon-reload
systemctl enable rohy.service
echo ""
echo "=== airgap install done ==="
echo "  Edit ${ENV_FILE} if you need to tweak more env vars."
echo "  Start:    sudo systemctl start rohy"
echo "  Verify:   sudo ${REPO_DIR}/deploy/preflight.sh"
echo "  Smoke:    ${REPO_DIR}/scripts/smoke.sh ${FRONTEND_URL}"
echo ""
INSTALLER_EOF
    chmod +x "$root/airgap-install.sh"

    # Manifest. Operators verify against this on the target host.
    local piper_in_bundle="false"
    [[ -d "$root/repo/server/data/piper" ]] && piper_in_bundle="true"
    cat > "$root/manifest.json" <<JSON_EOF
{
  "schema": 1,
  "kind": "rohy-airgap-source",
  "git_sha": "${GIT_SHA}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_host": "$(uname -srm)",
  "platform": "${PLATFORM}",
  "with_hf_cache": $([[ $WITH_HF_CACHE -eq 1 ]] && echo true || echo false),
  "with_dynajs": $([[ $WITH_DYNAJS -eq 1 ]] && echo true || echo false),
  "with_piper": ${piper_in_bundle},
  "node_modules_size": "$(sizeof "$root/repo/node_modules" 2>/dev/null || echo unknown)",
  "oyon_size": "$(sizeof "$root/repo/OyonR" 2>/dev/null || echo unknown)"
}
JSON_EOF

    local out="$OUTPUT_DIR/rohy-airgap-source-${STAMP}.tar.gz"
    echo "[source] tar -> $out"
    # -C to make the tarball extract to a clean parent dir.
    tar -C "$stage" -czf "$out" "rohy-airgap-${STAMP}"
    if ! (( SKIP_CHECKSUM )); then
        sha256 "$out" > "$out.sha256"
    fi
    rm -rf "$stage"
    echo "  size: $(sizeof "$out")"
}

# -- docker bundle -------------------------------------------------------
build_docker_bundle() {
    local stage="$OUTPUT_DIR/.stage-docker-$STAMP"
    local root="$stage/rohy-airgap-docker-${STAMP}"
    if (( DRY_RUN )); then
        echo "[docker] (dry-run) would: docker compose build && docker save rohy:latest"
        echo "[docker] (dry-run) would tar -> $OUTPUT_DIR/rohy-airgap-docker-${STAMP}.tar.gz"
        return
    fi
    rm -rf "$stage"
    mkdir -p "$root"

    echo "[docker] docker compose build (this is the slow step)"
    ( cd "$REPO_SRC" && docker compose -f deploy/docker/compose.yml build )
    echo "[docker] docker save rohy:latest"
    docker save rohy:latest -o "$root/rohy-image.tar"

    cp "$REPO_SRC/deploy/docker/compose.yml"   "$root/"
    cp "$REPO_SRC/deploy/docker/Caddyfile"     "$root/"
    cp "$REPO_SRC/deploy/docker/.env.example"  "$root/.env.example" 2>/dev/null || true

    cat > "$root/install.sh" <<'DOCKER_INSTALLER_EOF'
#!/usr/bin/env bash
# Offline Docker install. Run from extracted tarball root.
set -euo pipefail
[[ -f rohy-image.tar && -f compose.yml ]] || { echo "missing rohy-image.tar or compose.yml — run from extracted bundle root"; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker not installed on this host"; exit 2; }

if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "[airgap-docker] .env created from .env.example — EDIT it before continuing:"
    echo "                ROHY_HOSTNAME, ALLOW_DEFAULT_USERS=1 (first boot only), API keys."
    echo "                Then re-run this installer."
    exit 0
fi

echo "[airgap-docker] docker load < rohy-image.tar"
docker load -i rohy-image.tar
echo "[airgap-docker] docker compose up -d"
docker compose --env-file .env -f compose.yml up -d
echo ""
echo "=== done ==="
echo "  docker compose ps              # check status"
echo "  docker compose logs -f rohy    # tail logs"
echo "  https://<ROHY_HOSTNAME>/rohy   # try in browser (TLS warning expected for internal CA)"
DOCKER_INSTALLER_EOF
    chmod +x "$root/install.sh"

    cat > "$root/manifest.json" <<JSON_EOF
{
  "schema": 1,
  "kind": "rohy-airgap-docker",
  "git_sha": "${GIT_SHA}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_host": "$(uname -srm)",
  "image_size": "$(sizeof "$root/rohy-image.tar" 2>/dev/null || echo unknown)"
}
JSON_EOF

    local out="$OUTPUT_DIR/rohy-airgap-docker-${STAMP}.tar.gz"
    echo "[docker] tar -> $out"
    tar -C "$stage" -czf "$out" "rohy-airgap-docker-${STAMP}"
    if ! (( SKIP_CHECKSUM )); then
        sha256 "$out" > "$out.sha256"
    fi
    rm -rf "$stage"
    echo "  size: $(sizeof "$out")"
}

# -- run ------------------------------------------------------------------
case "$MODE" in
    source) build_source_bundle ;;
    docker) build_docker_bundle ;;
    both)   build_source_bundle; build_docker_bundle ;;
esac

echo ""
echo "=== bundles ready ==="
# Filenames are stamp-controlled (no spaces); ls is fine here.
# shellcheck disable=SC2012
ls -lh "$OUTPUT_DIR"/*.tar.gz "$OUTPUT_DIR"/*.sha256 2>/dev/null | awk '{printf "  %s  %s\n", $5, $NF}' || true
echo ""
echo "Hosting suggestions:"
echo ""
echo "  GitHub Releases (free, 2 GB/file, versioned):"
echo "    gh release create v${GIT_SHA} \\"
echo "       ${OUTPUT_DIR}/rohy-airgap-*.tar.gz \\"
echo "       ${OUTPUT_DIR}/rohy-airgap-*.sha256 \\"
echo "       --notes 'Air-gap bundles for offline rohy install'"
echo ""
echo "  Hugging Face Hub (50 GB/repo free; idiomatic since Kokoro already lives on HF):"
echo "    huggingface-cli upload <user>/rohy-airgap ${OUTPUT_DIR}/ ."
echo ""
echo "  Cloudflare R2 (\$0.015/GB-month, free egress; best for large/many bundles):"
echo "    rclone copy ${OUTPUT_DIR}/ r2:rohy-airgap/"
echo ""
echo "On the target host:"
echo "  curl -L -o rohy-airgap.tar.gz <hosted-url>"
echo "  curl -L -o rohy-airgap.tar.gz.sha256 <hosted-url>.sha256"
echo "  sha256sum -c rohy-airgap.tar.gz.sha256        # verify integrity"
echo "  tar xzf rohy-airgap.tar.gz && cd rohy-airgap-* && sudo ./airgap-install.sh ..."
