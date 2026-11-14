#!/usr/bin/env bash
# Assemble a COMPLETE, self-contained static site for the Oyon standalone app.
#
# WHY THIS EXISTS. `npm run app:build` emits only the SPA bundle into
# standalone/app/dist/. That bundle is NOT deployable on its own: the runtime
# loads its models and vendored engines from ABSOLUTE paths that live outside
# dist entirely (standalone/app/src/lib/runtime.ts:335-337):
#
#     /standalone/vendor/mediapipe/wasm
#     /standalone/models/mediapipe/face_landmarker.task
#     /standalone/vendor/webgazer/face_mesh
#
# Rsync just dist/ and you get a site that loads, shows its chrome, and then
# fails the moment anyone presses Start — 404s on the wasm and the model, with
# the camera never producing a frame. So the deployable artifact is dist/ PLUS a
# /standalone/ tree beside it, which is what this script stages.
#
# Absolute paths also mean the site must be served at a DOMAIN ROOT, not a
# subpath. vite.config.ts sets no `base`, so the bundle agrees.
#
#   bash scripts/build-site.sh              # build + assemble
#   SKIP_BUILD=1 bash scripts/build-site.sh # assemble an existing dist/
#
# Output: standalone/app/dist-site/  (~180 MB — the ONNX runtime and the
# emotion model are the bulk; that is the cost of running inference in the
# browser with nothing sent to a server.)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIST="standalone/app/dist"
OUT="standalone/app/dist-site"

die() { echo "build-site: $*" >&2; exit 1; }

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "▶ [1/3] Building the standalone app…"
  npm run app:build --silent
else
  echo "▶ [1/3] SKIP_BUILD=1 — reusing ${DIST}"
fi

[ -f "$DIST/index.html" ] || die "$DIST/index.html missing — did app:build run?"

echo "▶ [2/3] Staging dist + models + vendor into ${OUT}…"
rm -rf "$OUT"
mkdir -p "$OUT/standalone"
cp -R "$DIST/." "$OUT/"
# Mirrored under /standalone/ because that is the literal prefix the runtime
# requests. Keep the directory names byte-identical to the source tree.
cp -R standalone/models "$OUT/standalone/models"
cp -R standalone/vendor "$OUT/standalone/vendor"

echo "▶ [3/3] Verifying the site is complete…"
# Each of these is a path the app actually requests at runtime. Checking them
# here turns "the deploy silently shipped a broken site" into a build failure.
required=(
  "index.html"
  "assets"
  "standalone/models/mediapipe/face_landmarker.task"
  "standalone/vendor/mediapipe/wasm"
  "standalone/vendor/webgazer/face_mesh"
  "standalone/vendor/onnxruntime-web"
  "standalone/models/emotion"
)
for p in "${required[@]}"; do
  [ -e "$OUT/$p" ] || die "missing $p — the deployed site would 404 on it"
  echo "    ✓ $p"
done

# The SPA must load from the root, so a stray `base` would break every asset.
grep -q 'src="/assets/' "$OUT/index.html" \
  || die "index.html does not reference /assets/ at the root — was a vite \`base\` set? This site must be served at a domain root."
echo "    ✓ root-absolute asset paths"

echo "✓ Oyon site ready at $OUT/ ($(du -sh "$OUT" | cut -f1))"
