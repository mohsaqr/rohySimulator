#!/bin/bash
# Install Piper TTS binary + a starter set of English voices into server/data/piper/.
# Voices and binary are NOT checked into git. Re-run this on a fresh clone.
#
# Usage:  bash server/scripts/install-piper.sh
# Override binary URL:  PIPER_RELEASE_URL=... bash server/scripts/install-piper.sh

set -euo pipefail

# Resolve paths relative to this script regardless of where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/data/piper"
mkdir -p "$PIPER_DIR"
cd "$PIPER_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"

resolve_release_url() {
    if [ -n "${PIPER_RELEASE_URL:-}" ]; then
        echo "$PIPER_RELEASE_URL"; return
    fi
    case "$OS-$ARCH" in
        Linux-x86_64)  echo "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" ;;
        Linux-aarch64) echo "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz" ;;
        Darwin-x86_64) echo "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz" ;;
        Darwin-arm64)  echo "" ;; # No official arm64 build; user must `brew install piper-tts` or build from source.
        *) echo "" ;;
    esac
}

install_binary() {
    if [ -x "$PIPER_DIR/piper/piper" ]; then
        echo "✓ Piper binary already present at $PIPER_DIR/piper/piper"
        return
    fi

    URL="$(resolve_release_url)"
    if [ -z "$URL" ]; then
        echo "⚠ No prebuilt Piper binary for $OS-$ARCH."
        if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
            echo "  On Apple Silicon: brew install piper-tts"
            echo "  Then set PIPER_BIN=/opt/homebrew/bin/piper in server/.env"
        else
            echo "  Build from source: https://github.com/rhasspy/piper#building"
        fi
        return
    fi

    echo "→ Downloading Piper binary from $URL"
    curl -fsSL -o piper.tgz "$URL"
    tar -xzf piper.tgz
    rm piper.tgz
    chmod +x piper/piper 2>/dev/null || true
    echo "✓ Piper binary installed to $PIPER_DIR/piper/piper"
}

install_voice() {
    local voice="$1"
    local locale="$2"
    local speaker="$3"
    local quality="$4"
    local base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${locale%_*}/${locale}/${speaker}/${quality}/${voice}"
    if [ -f "$voice" ] && [ -f "$voice.json" ]; then
        echo "✓ $voice already present"
        return
    fi
    echo "→ Downloading $voice"
    curl -fsSL -o "$voice"      "$base"
    curl -fsSL -o "$voice.json" "$base.json"
}

install_binary

# Starter voices — three English speakers covering male / female / British accent.
install_voice en_US-amy-medium.onnx          en_US amy          medium
install_voice en_US-ryan-medium.onnx         en_US ryan         medium
install_voice en_GB-jenny_dioco-medium.onnx  en_GB jenny_dioco  medium

echo ""
echo "✓ Piper setup complete. Voices in $PIPER_DIR:"
ls -1 "$PIPER_DIR"/*.onnx 2>/dev/null | xargs -n1 basename || echo "  (none)"
