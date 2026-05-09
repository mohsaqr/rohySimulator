#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROHY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OYON_SOURCE="${OYON_SOURCE:-$(cd "$ROHY_ROOT/.." && pwd)/Oyon}"
OYON_TARGET="$ROHY_ROOT/OyonR"

if [[ ! -d "$OYON_SOURCE" ]]; then
  echo "Oyon source not found: $OYON_SOURCE" >&2
  echo "Set OYON_SOURCE=/path/to/Oyon and rerun." >&2
  exit 1
fi

mkdir -p "$OYON_TARGET"

# rsync notes:
#   --delete drops files that no longer exist upstream — keeps the vendored
#     tree honest.
#   --exclude /standalone/vendor protects the MediaPipe + ONNX bundles we
#     add ourselves. Upstream Oyon doesn't ship them; without this exclude,
#     --delete would erase them on every sync.
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .playwright-mcp \
  --exclude /standalone/vendor \
  "$OYON_SOURCE/" \
  "$OYON_TARGET/"

echo "Synced $OYON_TARGET from $OYON_SOURCE"

# Re-apply Rohy-specific patches that the sync just blew away. Idempotent —
# running twice is a no-op. See scripts/apply-oyon-patches.mjs for the
# overlay contract.
node "$SCRIPT_DIR/apply-oyon-patches.mjs"

echo "Oyon update complete."
