#!/usr/bin/env bash
#
# Download Oyon's bundled model weights and runtime assets from their
# upstream sources. Idempotent: skips files that already exist with a
# non-zero size. Use --force to re-download.
#
# Run from the repo root (or from anywhere; the script resolves paths
# relative to its own location).
#
#   bash scripts/download-models.sh
#   bash scripts/download-models.sh --force
#
# The standalone demo bundles the required runtime assets by default. This script
# matters once we move the heavier assets out of the repo (Git LFS or
# .gitignore) — see scripts/README.md for the migration recipe.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/standalone/models"
VENDOR="$ROOT/standalone/vendor"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

download() {
  local url="$1" dest="$2" label="$3"
  printf '→ %s\n' "$label"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" && "$FORCE" -eq 0 ]]; then
    local bytes
    bytes=$(wc -c < "$dest" | tr -d ' ')
    printf '  ✓ already present (%s bytes), skipping\n' "$bytes"
    return
  fi
  printf '  ↓ %s\n' "$url"
  curl -fL --progress-bar "$url" -o "$dest"
  printf '  ✓ saved to %s\n' "$dest"
}

# Verified upstream URLs.
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

# ---------------------------------------------------------------------------
# Vendor the browser WASM runtimes from the installed peer deps.
#
# onnxruntime-web and @mediapipe/tasks-vision ship their .wasm/.mjs under
# node_modules; the standalone dashboard hard-imports them from
# standalone/vendor/<pkg>/ (see standalone/app/src/lib/runtime.ts), and
# .gitignore keeps the heavy binaries (a single ORT .wasm is ~13 MB) out of
# the repo. So a fresh clone / Docker build must COPY them here from the
# installed packages, or the Oyon camera widget 404s at load — exactly the
# fresh-install gap install-from-scratch.yml exists to catch. Copying from
# node_modules (rather than a pinned CDN URL) guarantees the loader .mjs and
# its runtime .wasm are the SAME resolved version — ORT breaks silently on
# loader/runtime version skew.
#
# npm may hoist these to the repo-root node_modules or keep them under
# OyonR/node_modules, so probe both. Runs after `npm install` (the postinstall
# hook + the Dockerfile's explicit re-run), so the packages are present.

# Echo the first existing "<node_modules>/<rel>" among the candidate roots.
resolve_in_node_modules() {
  local rel="$1" nm
  for nm in "$ROOT/../node_modules" "$ROOT/node_modules" "$ROOT/../../node_modules"; do
    if [[ -e "$nm/$rel" ]]; then printf '%s\n' "$nm/$rel"; return 0; fi
  done
  return 1
}

copy_vendor() {
  local src="$1" dest="$2" label="$3"
  printf '→ %s\n' "$label"
  if [[ -f "$dest" && -s "$dest" && "$FORCE" -eq 0 ]]; then
    printf '  ✓ already present, skipping\n'
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$dest"
  printf '  ✓ %s\n' "$dest"
}

# ONNX Runtime Web — the SIMD+threaded wasm backend AND its asyncify variant.
# onnxruntime-web loads `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` at runtime
# for the classifier's inference path. Omitting either file produces a 404,
# prevents the emotion model from loading, and leaves the Oyon pill in Error.
# jsep/webgpu/jspi remain excluded because those execution providers are off.
if ort_dist="$(resolve_in_node_modules onnxruntime-web/dist)"; then
  for f in ort.min.mjs \
           ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm \
           ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm; do
    copy_vendor "$ort_dist/$f" "$VENDOR/onnxruntime-web/$f" "onnxruntime-web/$f"
  done
else
  echo "  ⚠ onnxruntime-web not found in node_modules — run 'npm install' first (skipping ORT vendor)" >&2
fi

# MediaPipe tasks-vision — the standalone hard-imports the ESM entry
# (vision_bundle.mjs, at the package root) AND loads the face-landmarker WASM
# from the wasm/ subdir. Vendor BOTH: the loader to mediapipe/vision_bundle.mjs
# and the runtime to mediapipe/wasm/ (see standalone/app/src/lib/runtime.ts and
# the install-from-scratch probe list).
if mp_root="$(resolve_in_node_modules @mediapipe/tasks-vision)"; then
  copy_vendor "$mp_root/vision_bundle.mjs" "$VENDOR/mediapipe/vision_bundle.mjs" "mediapipe/vision_bundle.mjs"
  printf '→ %s\n' "@mediapipe/tasks-vision wasm"
  if [[ -d "$VENDOR/mediapipe/wasm" && "$FORCE" -eq 0 && -n "$(ls -A "$VENDOR/mediapipe/wasm" 2>/dev/null)" ]]; then
    printf '  ✓ already present, skipping\n'
  else
    mkdir -p "$VENDOR/mediapipe/wasm"
    cp -f "$mp_root/wasm"/* "$VENDOR/mediapipe/wasm/"
    printf '  ✓ %s\n' "$VENDOR/mediapipe/wasm"
  fi
else
  echo "  ⚠ @mediapipe/tasks-vision not found in node_modules (skipping MediaPipe vendor)" >&2
fi

echo
echo "Done. Models live under standalone/models/ and standalone/vendor/."
