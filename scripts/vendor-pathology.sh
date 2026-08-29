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
SRC="${PATHOYON_SRC:-$HOME/Documents/Github/Pathoyon/pathoyon/src}"
DEST="$ROOT/src/components/pathology"

fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

[ -d "$SRC" ] || fail "upstream source not found: $SRC
    Clone Pathoyon beside rohy, or set PATHOYON_SRC to its pathoyon/src."
# The guard. A source that exists but holds no package would delete the copy.
[ -f "$SRC/index.js" ] || fail "$SRC has no index.js — that is not the package.
    Refusing to rsync --delete from it; this is exactly the state that would
    empty $DEST."
[ -d "$DEST" ] || fail "vendored copy not found: $DEST"

rsync -rc --delete --exclude README.md --exclude portability.test.js "$SRC/" "$DEST/"

# Only the two rohy-only files may differ. Anything else means the copy is not
# byte-identical and the boundary claim in the README is no longer true.
drift="$(diff -rq "$SRC" "$DEST" | grep -v 'README.md\|portability.test.js' || true)"
[ -z "$drift" ] || fail "vendored copy differs from upstream beyond the two rohy files:
$drift"

printf '  ✓ vendored %s → src/components/pathology (%s files)\n' \
  "$SRC" "$(find "$DEST" -type f -name '*.js*' | wc -l | tr -d ' ')"
