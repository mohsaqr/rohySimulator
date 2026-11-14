#!/usr/bin/env bash
# Install the repo's git hooks.
#
# .git/hooks is NOT version-controlled, so this has to be run once per clone.
# Re-run it after cloning or after `git worktree add`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$root/.git/hooks/pre-commit"

cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# Bump the patch version on every commit, and stage the bump with it.
#
# Skip with `git commit --no-verify` — useful for a commit that is itself a
# release, where the version was set deliberately rather than incremented.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
node "$root/scripts/bump-version.mjs" >/dev/null
git add "$root/package.json" "$root/src/version.js"
HOOK

chmod +x "$hook"
echo "installed: $hook"
