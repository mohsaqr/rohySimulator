#!/usr/bin/env bash
#
# Download Oyon's bundled model weights AND runtime asset bundles from their
# upstream sources. Idempotent: skips files that already exist with a
# non-zero size. Use --force to re-download.
#
# Run from anywhere; paths resolve relative to this script's location.
#
#   bash scripts/download-models.sh
#   bash scripts/download-models.sh --force
#
# What this populates:
#   standalone/models/    — MediaPipe face landmarker + 3 emotion classifiers
#   standalone/vendor/    — ONNX Runtime Web wasm/mjs + MediaPipe tasks-vision
#                           wasm/mjs. These are required by the in-browser
#                           runtime; without them the Oyon pill widget loads
#                           the page but fails to start emotion inference.
#
# Sources:
#   models           — MediaPipe official storage + sb-ai-lab/EmotiEffLib raw
#   vendor onnxruntime-web — jsDelivr (npm:onnxruntime-web@<ORT_VERSION>)
#   vendor tasks-vision    — jsDelivr (npm:@mediapipe/tasks-vision@<MP_VERSION>)
#
# Override versions via env vars (defaults pin to the OyonR peerDependencies):
#   ORT_VERSION=1.20.1 MP_VERSION=0.10.22 bash scripts/download-models.sh
#
# Why the vendor downloads live here (not as npm deps): the in-browser runtime
# loads these files from same-origin URLs (`/standalone/vendor/...`), not via
# bundler imports. Adding them as dependencies of OyonR or its parents would
# pull them into node_modules but NOT publish them under standalone/vendor/.
# Historically vendor/ was populated by hand; that broke every fresh server
# clone. This script makes the install path self-sufficient.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/standalone/models"
VENDOR="$ROOT/standalone/vendor"
ORT_DIR="$VENDOR/onnxruntime-web"
MP_DIR="$VENDOR/mediapipe"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# Resolve a package's installed version by reading its package.json from
# whichever node_modules tree contains it. Order:
#   1. The host repo's node_modules (e.g. rohy's, when OyonR is consumed via
#      `file:./OyonR`) — this is what the Docker build produces.
#   2. OyonR's own node_modules (when the package is being used standalone).
#   3. The provided fallback.
# Without this, the script would download the hardcoded default version while
# the SPA bundle uses whatever npm actually pinned — leading to a wasm/JS
# Emscripten ABI mismatch ("t.getValue is not a function" inside ORT). Pinning
# from the live install makes the mismatch impossible by construction.
resolve_pkg_version() {
  local pkg="$1" fallback="$2"
  local found=""
  for candidate in \
    "$ROOT/../node_modules/$pkg/package.json" \
    "$ROOT/node_modules/$pkg/package.json" \
  ; do
    if [[ -f "$candidate" ]]; then
      # Prefer node if available (handles every JSON edge case correctly);
      # fall back to a grep for `"version": "..."` if node isn't on PATH.
      if command -v node >/dev/null 2>&1; then
        found=$(node -p "require('$candidate').version" 2>/dev/null || true)
      else
        found=$(grep -m1 '"version"' "$candidate" 2>/dev/null \
          | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
          || true)
      fi
      if [[ -n "$found" ]]; then
        printf '%s' "$found"
        return 0
      fi
    fi
  done
  printf '%s' "$fallback"
}

# Hardcoded fallbacks used only if node_modules can't be inspected (e.g. the
# script is run before `npm install` in a fresh clone). Keep them in sync
# with the OyonR peerDependencies so the standalone path still works.
ORT_FALLBACK="1.20.1"
# MediaPipe tasks-vision: peerDep declares ^0.10.22 but npm doesn't actually
# publish 0.10.10–0.10.34 — the closest published version that satisfies the
# range is 0.10.35. Pin to that as the standalone fallback.
MP_FALLBACK="0.10.35"

ORT_VERSION="${ORT_VERSION:-$(resolve_pkg_version onnxruntime-web "$ORT_FALLBACK")}"
MP_VERSION="${MP_VERSION:-$(resolve_pkg_version @mediapipe/tasks-vision "$MP_FALLBACK")}"
ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist"
MP_BASE="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}"

# Verify the resolved version is actually published before we start
# downloading. A bogus version (typo, removed snapshot, ahead-of-CDN dev
# build) would otherwise produce a sea of 404s that look like a network
# blip; this surfaces the mismatch with one clear message instead.
verify_jsdelivr_version() {
  local label="$1" base="$2" canary="$3"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$base/$canary" 2>/dev/null || echo 000)
  if [[ "$code" == "200" ]]; then
    return 0
  fi
  printf '\n[oyon-vendor] WARNING: %s probe returned HTTP %s for %s/%s\n' "$label" "$code" "$base" "$canary" >&2
  printf '[oyon-vendor]   The resolved version may not be published on jsDelivr.\n' >&2
  printf '[oyon-vendor]   If this is a dev/snapshot build, the JS bundle in node_modules\n' >&2
  printf '[oyon-vendor]   will not be served from the CDN. Pin a real published version\n' >&2
  printf '[oyon-vendor]   in package.json or override with %s_VERSION=… env.\n' "$label" >&2
  return 1
}
verify_jsdelivr_version ORT "$ORT_BASE" "ort.min.mjs" || true
verify_jsdelivr_version MP "$MP_BASE" "vision_bundle.mjs" || true

printf '[oyon-vendor] resolved versions: ORT=%s · MP=%s\n' "$ORT_VERSION" "$MP_VERSION"

SKIPPED_OPTIONAL=()

# download URL DEST LABEL [optional]
# When the 4th arg is "optional", a 404 from the upstream is reported as a
# warning and recorded in SKIPPED_OPTIONAL but does NOT fail the script. Use
# this for ORT wasm flavors that some published versions omit (asyncify, jspi)
# — ORT loads them dynamically based on browser/EP capability and falls back
# to the always-present `ort-wasm-simd-threaded.{mjs,wasm}` when missing.
#
# Atomic write: download to "<dest>.part", verify success + non-zero size,
# then mv to "$dest". This makes idempotent re-runs reliable: a failed/aborted
# run leaves NO partial file at "$dest" so the next attempt re-downloads
# instead of treating a truncated file as "already present".
download() {
  local url="$1" dest="$2" label="$3" mode="${4:-required}"
  printf '→ %s\n' "$label"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" && "$FORCE" -eq 0 ]]; then
    local bytes
    bytes=$(wc -c < "$dest" | tr -d ' ')
    printf '  ✓ already present (%s bytes), skipping\n' "$bytes"
    return 0
  fi
  printf '  ↓ %s\n' "$url"
  local tmp="${dest}.part"
  rm -f "$tmp"
  # Capture the HTTP code on stdout via -w '%{http_code}' while the response
  # body goes to $tmp (-o) and the progress bar (curl writes it to stderr by
  # default) passes through to the terminal unchanged. The `if` gate masks
  # set -e so we can read $? on a curl failure without aborting the script.
  local http=000 rc=0
  if http=$(curl -fL --progress-bar -w '%{http_code}' -o "$tmp" "$url"); then
    rc=0
  else
    rc=$?
  fi
  if (( rc != 0 )) || [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    if [[ "$mode" == "optional" ]]; then
      printf '  ! optional file not published for this version (HTTP %s); skipping\n' "$http"
      SKIPPED_OPTIONAL+=("$label")
      return 0
    fi
    printf '  ✗ download failed (curl exit %s, HTTP %s)\n' "$rc" "$http" >&2
    return 1
  fi
  mv "$tmp" "$dest"
  printf '  ✓ saved to %s\n' "$dest"
}

# ── Models (face landmarker + emotion classifiers) ────────────────────────────

download \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  "$MODELS/mediapipe/face_landmarker.task" \
  "MediaPipe Face Landmarker (float16)"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx" \
  "$MODELS/emotion/mobilevit_va_mtl.onnx" \
  "EmotiEffLib MobileViT MTL"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mbf_va_mtl.onnx" \
  "$MODELS/emotion/mbf_va_mtl.onnx" \
  "EmotiEffLib MobileFaceNet MTL"

download \
  "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx" \
  "$MODELS/emotion/enet_b0_8_va_mtl.onnx" \
  "HSEmotion EfficientNet-B0 MTL"

# ── Vendor: ONNX Runtime Web (browser-side wasm/mjs) ──────────────────────────
# Files match what the OyonR runtime loads from /standalone/vendor/onnxruntime-web/.
# `ort.webgpu.min.mjs` is the entry the widget pulls; the wasm + accompanying
# .mjs glue files cover JSEP (WebGPU/WebNN), JSPI (JS Promise Integration),
# Asyncify, and the plain SIMD-threaded fallback.

# Required: always published.
declare -a ORT_REQUIRED=(
  "ort.min.mjs"
  "ort.webgpu.min.mjs"
  "ort-wasm-simd-threaded.mjs"
  "ort-wasm-simd-threaded.wasm"
  "ort-wasm-simd-threaded.jsep.mjs"
  "ort-wasm-simd-threaded.jsep.wasm"
)
# Optional: present in some ORT versions, absent in others. ORT requests these
# only when the browser/EP combo needs them and falls back gracefully if absent.
declare -a ORT_OPTIONAL=(
  "ort-wasm-simd-threaded.asyncify.mjs"
  "ort-wasm-simd-threaded.asyncify.wasm"
  "ort-wasm-simd-threaded.jspi.mjs"
  "ort-wasm-simd-threaded.jspi.wasm"
)
for f in "${ORT_REQUIRED[@]}"; do
  download "$ORT_BASE/$f" "$ORT_DIR/$f" "ONNX Runtime Web $ORT_VERSION — $f"
done
for f in "${ORT_OPTIONAL[@]}"; do
  download "$ORT_BASE/$f" "$ORT_DIR/$f" "ONNX Runtime Web $ORT_VERSION — $f" optional
done

# ── Vendor: MediaPipe tasks-vision (face landmarker WASM runtime) ─────────────
# `vision_bundle.mjs` is the entry; the four wasm/.js files in `wasm/` cover
# the SIMD-on and SIMD-off variants the FilesetResolver picks at load time.

download "$MP_BASE/vision_bundle.mjs" \
  "$MP_DIR/vision_bundle.mjs" \
  "MediaPipe tasks-vision $MP_VERSION — vision_bundle.mjs"

declare -a MP_WASM_REQUIRED=(
  "vision_wasm_internal.js"
  "vision_wasm_internal.wasm"
  "vision_wasm_nosimd_internal.js"
  "vision_wasm_nosimd_internal.wasm"
)
# Module variant — present in 0.10.35+ for the worker/offscreen path. Older
# 0.10.x versions don't ship it. MediaPipe falls back to the internal variants
# when absent.
declare -a MP_WASM_OPTIONAL=(
  "vision_wasm_module_internal.js"
  "vision_wasm_module_internal.wasm"
)
for f in "${MP_WASM_REQUIRED[@]}"; do
  download "$MP_BASE/wasm/$f" "$MP_DIR/wasm/$f" \
    "MediaPipe tasks-vision $MP_VERSION — wasm/$f"
done
for f in "${MP_WASM_OPTIONAL[@]}"; do
  download "$MP_BASE/wasm/$f" "$MP_DIR/wasm/$f" \
    "MediaPipe tasks-vision $MP_VERSION — wasm/$f" optional
done

echo
echo "Done."
echo "  Models live under $MODELS/"
echo "  Browser runtime assets live under $VENDOR/{onnxruntime-web,mediapipe}/"
echo
echo "Versions used:"
echo "  ONNX Runtime Web : $ORT_VERSION (override with ORT_VERSION=...)"
echo "  MediaPipe vision : $MP_VERSION (override with MP_VERSION=...)"
if [[ ${#SKIPPED_OPTIONAL[@]} -gt 0 ]]; then
  echo
  echo "Optional ORT flavors not published for this version (ORT will fall back at runtime):"
  for s in "${SKIPPED_OPTIONAL[@]}"; do echo "  - $s"; done
fi
