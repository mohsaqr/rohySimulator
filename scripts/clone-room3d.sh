#!/usr/bin/env bash
# Clone the exact 3D patient-room release Rohy is built and tested against.
#
# Authentication deliberately uses a one-shot HTTP header instead of putting
# the token in the remote URL. Git would persist a credential-bearing URL in
# .git/config, and Docker copies this source tree into the runtime image.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
contract="$script_dir/room3d-version.json"
destination="${1:-}"

if [[ -z "$destination" ]]; then
    echo "usage: $0 <destination>" >&2
    exit 2
fi
if [[ -e "$destination" ]]; then
    echo "clone-room3d: destination already exists: $destination" >&2
    exit 1
fi

ref="$(node -e "const c=require(process.argv[1]); process.stdout.write(c.ref)" "$contract")"
expected_version="$(node -e "const c=require(process.argv[1]); process.stdout.write(c.version)" "$contract")"
repo="https://github.com/mohsaqr/3D.git"

if [[ -n "${ROOM3D_GIT_TOKEN:-}" ]]; then
    basic_auth="$(printf 'x-access-token:%s' "$ROOM3D_GIT_TOKEN" | base64 | tr -d '\r\n')"
    git -c "http.extraHeader=Authorization: Basic $basic_auth" \
        clone --depth 1 --branch "$ref" "$repo" "$destination"
    unset basic_auth
else
    git clone --depth 1 --branch "$ref" "$repo" "$destination"
fi

actual_version="$(node -e "const p=require(process.argv[1]); process.stdout.write(p.version)" "$destination/package.json")"
if [[ "$actual_version" != "$expected_version" ]]; then
    echo "clone-room3d: $ref contains package version $actual_version; expected $expected_version" >&2
    exit 1
fi

# Rohy needs package sources, not repository metadata. Besides shrinking the
# image, this guarantees a future authentication change cannot ship a remote
# URL, credential helper, or other Git-local state to operators.
rm -rf "$destination/.git"
echo "clone-room3d: installed rohy-3d-patient-room $actual_version ($ref)"
