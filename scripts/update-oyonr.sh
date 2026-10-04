#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROHY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OYON_SOURCE="${OYON_SOURCE:-$(cd "$ROHY_ROOT/.." && pwd)/Oyon}"
OYON_TARGET="$ROHY_ROOT/OyonR"
OYON_EXPECTED_VERSION="${OYON_EXPECTED_VERSION:-3.3.3}"

if [[ ! -d "$OYON_SOURCE" ]]; then
  echo "Oyon source not found: $OYON_SOURCE" >&2
  echo "Set OYON_SOURCE=/path/to/Oyon and rerun." >&2
  exit 1
fi

if [[ ! -f "$OYON_SOURCE/package.json" ]]; then
  echo "Oyon package metadata not found: $OYON_SOURCE/package.json" >&2
  exit 1
fi

OYON_SOURCE_VERSION="$(node -p "require(process.argv[1]).version" "$OYON_SOURCE/package.json")"
if [[ "$OYON_SOURCE_VERSION" != "$OYON_EXPECTED_VERSION" ]]; then
  echo "Refusing to sync Oyon $OYON_SOURCE_VERSION; release/2.9 expects $OYON_EXPECTED_VERSION." >&2
  echo "Check out/tag the intended source, or explicitly set OYON_EXPECTED_VERSION." >&2
  exit 1
fi

mkdir -p "$OYON_TARGET"

# rsync notes:
#   - .claude, .DS_Store and the two build outputs (dist/, standalone/app/dist/)
#     are untracked, git-ignored here, and unused (the package exports src/;
#     the element is standalone/app/dist-element/) — 3.3.3's worktree carried
#     a 53 MB standalone/app/dist that would otherwise land in OyonR/.
#   --delete drops files that no longer exist upstream — keeps the vendored
#     tree honest.
#   Preserve only the large, re-downloadable runtime assets. Other vendored
#   source is versioned by Oyon and must be refreshed during a major sync.
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .playwright-mcp \
  --exclude /standalone/models \
  --exclude /standalone/vendor/mediapipe \
  --exclude /standalone/vendor/onnxruntime-web \
  --exclude .claude \
  --exclude .DS_Store \
  --exclude /dist/ \
  --exclude /standalone/app/dist/ \
  "$OYON_SOURCE/" \
  "$OYON_TARGET/"

echo "Synced $OYON_TARGET from $OYON_SOURCE"

# Re-apply Rohy-specific patches that the sync just blew away. Idempotent —
# running twice is a no-op. See scripts/apply-oyon-patches.mjs for the
# overlay contract.
node "$SCRIPT_DIR/apply-oyon-patches.mjs"

echo "Oyon update complete."
