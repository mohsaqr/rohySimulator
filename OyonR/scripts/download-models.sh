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

echo
echo "Done. Models live under standalone/models/ and standalone/vendor/."
