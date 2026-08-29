#!/bin/bash
# Re-vendor the Pathoyon package into src/components/pathology/.
#
# The vendored copy is byte-identical to upstream's `src/` plus two rohy-only
# files (README.md, portability.test.js). See that README for the boundary and
# `docs/design/plugin-standard.md` §3.2 for why the boundary is a test.
#
# WHY THIS IS A SCRIPT AND NOT A LINE IN THE README
#
# The README used to carry the rsync verbatim, pointing at a path that later
# moved. The stale path did not start erroring — it started resolving to a
# leftover cache directory with no source files in it, which turned a documented
# `rsync --delete` into "empty the vendored package". An empty source is a
# perfectly valid instruction to rsync. The guard below is the whole point of
# the file; everything else is the command that was already there.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${PATHOYON:-$HOME/Documents/Github/Pathoyon/pathoyon}"

fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# Two halves, vendored the same way and for the same reason. The CLIENT half is
# the room and the editor; the SERVER half (RPS-1 1.4 §11b) is the import job
# and its routes. Each has its own rohy-only files that must survive the copy.
#
#   <upstream subdir> | <rohy destination> | <sentinel> | <rohy-only files>
VENDOR=(
  "src|src/components/pathology|index.js|README.md portability.test.js"
  "server|server/plugins/pathology|index.js|README.md portability.test.js"
)

for spec in "${VENDOR[@]}"; do
  IFS='|' read -r sub dest sentinel keep <<< "$spec"
  SRC="$UPSTREAM/$sub"
  DEST="$ROOT/$dest"

  [ -d "$SRC" ] || fail "upstream not found: $SRC
    Clone Pathoyon beside rohy, or set PATHOYON to its pathoyon/ directory."
  # The guard. A source that EXISTS but holds no package would delete the copy:
  # rsync has no notion of "this source looks wrong", and an empty source is a
  # valid instruction to empty the destination.
  [ -f "$SRC/$sentinel" ] || fail "$SRC has no $sentinel — that is not the package.
    Refusing to rsync --delete from it; this is exactly the state that would
    empty $DEST."
  mkdir -p "$DEST"

  excludes=()
  for f in $keep; do excludes+=(--exclude "$f"); done
  rsync -rc --delete "${excludes[@]}" "$SRC/" "$DEST/"

  # Only the rohy-only files may differ. Anything else means the copy is not
  # byte-identical and the boundary claim in the README is no longer true.
  filter="$(printf '%s\\|' $keep)"
  drift="$(diff -rq "$SRC" "$DEST" | grep -v "${filter%\\|}" || true)"
  [ -z "$drift" ] || fail "vendored copy differs from upstream beyond its rohy-only files:
$drift"

  printf '  ✓ %s → %s (%s files)\n' \
    "$sub" "$dest" "$(find "$DEST" -type f -name '*.js*' | wc -l | tr -d ' ')"
done
