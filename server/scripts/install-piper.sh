#!/bin/bash
# Install Piper TTS (piper1-gpl, the maintained successor to the archived
# rhasspy/piper) into a project-local Python venv at server/data/piper/venv/,
# plus a starter set of English voices into server/data/piper/.
#
# We use the OHF-Voice/piper1-gpl Python package (`pip install piper-tts`)
# because the original rhasspy/piper repo was archived in 2024 and no longer
# ships standalone binaries. piper1-gpl is the active fork and bundles
# espeak-ng inside its wheel, so no system espeak-ng dependency.
#
# Voices and the venv are NOT checked into git. Re-run on a fresh clone.
#
# Usage:  bash server/scripts/install-piper.sh
# Override Python interpreter:  PIPER_PYTHON=python3.11 bash server/scripts/install-piper.sh
# Override piper-tts version:   PIPER_TTS_VERSION=1.4.2 bash server/scripts/install-piper.sh

set -euo pipefail

# Resolve paths relative to this script regardless of where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/data/piper"
VENV_DIR="$PIPER_DIR/venv"
PIPER_BIN="$VENV_DIR/bin/piper"
PYTHON_BIN="${PIPER_PYTHON:-python3}"
TTS_VERSION="${PIPER_TTS_VERSION:-1.4.2}"

mkdir -p "$PIPER_DIR"

require_python() {
    if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
        echo "✗ '$PYTHON_BIN' not found. Install Python 3.9+ and re-run."
        echo "  macOS:  brew install python@3.11"
        echo "  Ubuntu: sudo apt install python3 python3-venv"
        echo "  Or set PIPER_PYTHON=/path/to/python3 and re-run."
        exit 1
    fi
    # piper-tts 1.4.x requires Python 3.9+
    local pyver
    pyver="$("$PYTHON_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    local major minor
    major="${pyver%%.*}"
    minor="${pyver##*.}"
    if [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 9 ]; }; then
        echo "✗ Python $pyver is too old; piper-tts $TTS_VERSION needs 3.9+."
        echo "  Set PIPER_PYTHON=/path/to/python3.11 (or newer) and re-run."
        exit 1
    fi
    echo "✓ Using $PYTHON_BIN ($pyver)"
}

install_venv() {
    if [ -x "$PIPER_BIN" ]; then
        echo "✓ Piper already installed at $PIPER_BIN"
        # Print version so the user can compare against TTS_VERSION.
        "$PIPER_BIN" --help >/dev/null 2>&1 || true
        return
    fi

    echo "→ Creating Python venv at $VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"

    # Always upgrade pip first — old pip can fail to resolve the abi3 wheels.
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip

    echo "→ Installing piper-tts==$TTS_VERSION (this can take ~30 s on first install)"
    "$VENV_DIR/bin/pip" install --quiet "piper-tts==$TTS_VERSION"

    if [ ! -x "$PIPER_BIN" ]; then
        echo "✗ pip install completed but $PIPER_BIN is missing."
        echo "  Check $VENV_DIR/bin/ for the actual entry point."
        exit 1
    fi
    echo "✓ Piper installed: $PIPER_BIN"
}

install_voice() {
    local voice="$1"
    local locale="$2"
    local speaker="$3"
    local quality="$4"
    local base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${locale%_*}/${locale}/${speaker}/${quality}/${voice}"
    if [ -f "$PIPER_DIR/$voice" ] && [ -f "$PIPER_DIR/$voice.json" ]; then
        echo "✓ $voice already present"
        return
    fi
    echo "→ Downloading $voice"
    curl -fsSL -o "$PIPER_DIR/$voice"      "$base"
    curl -fsSL -o "$PIPER_DIR/$voice.json" "$base.json"
}

require_python
install_venv

# English voices — a spread of distinct speakers (male / female / US / GB),
# each at its highest published quality tier. Voice files live in $PIPER_DIR
# (NOT inside the venv) so they survive a venv rebuild.
install_voice en_US-amy-medium.onnx          en_US amy          medium
install_voice en_US-ryan-high.onnx           en_US ryan         high
install_voice en_US-lessac-high.onnx         en_US lessac       high
install_voice en_US-libritts-high.onnx       en_US libritts     high
install_voice en_US-hfc_female-medium.onnx   en_US hfc_female   medium
install_voice en_US-kristin-medium.onnx      en_US kristin      medium
install_voice en_GB-jenny_dioco-medium.onnx  en_GB jenny_dioco  medium
install_voice en_GB-cori-high.onnx           en_GB cori         high
install_voice en_GB-alan-medium.onnx         en_GB alan         medium
install_voice en_GB-alba-medium.onnx         en_GB alba         medium

# I18N voices (I18N_PLAN.md §5/Phase E) — Italian, Finnish, Swedish, and
# German, matching the app's shipped UI languages. Every distinct published
# speaker per language, each pinned to its HIGHEST available quality tier (no
# redundant lower-quality duplicates of the same speaker). The voice resolver
# derives language from the it_IT/fi_FI/sv_SE/de_DE filename prefix; a case's
# per-character voice must still be pointed at one of these in the case/persona
# editor (one-tier case_voice, no automatic substitution).
#
# Italian — both published speakers (no others exist); riccardo tops out at x_low.
install_voice it_IT-paola-medium.onnx        it_IT paola        medium
install_voice it_IT-riccardo-x_low.onnx      it_IT riccardo     x_low
# Finnish — only harri is published; medium is its top tier.
install_voice fi_FI-harri-medium.onnx        fi_FI harri        medium
# Swedish — all three published speakers (each tops out at medium).
install_voice sv_SE-nst-medium.onnx          sv_SE nst          medium
install_voice sv_SE-alma-medium.onnx         sv_SE alma         medium
install_voice sv_SE-lisa-medium.onnx         sv_SE lisa         medium
# German — every distinct speaker; thorsten at high, the rest at their published max.
install_voice de_DE-thorsten-high.onnx              de_DE thorsten           high
install_voice de_DE-thorsten_emotional-medium.onnx  de_DE thorsten_emotional medium
install_voice de_DE-mls-medium.onnx                 de_DE mls                medium
install_voice de_DE-kerstin-low.onnx                de_DE kerstin            low
install_voice de_DE-eva_k-x_low.onnx                de_DE eva_k              x_low
install_voice de_DE-karlsson-low.onnx               de_DE karlsson           low
install_voice de_DE-pavoque-low.onnx                de_DE pavoque            low
install_voice de_DE-ramona-low.onnx                 de_DE ramona             low

echo ""
echo "✓ Piper setup complete."
echo "  Binary: $PIPER_BIN"
echo "  Voices: $PIPER_DIR"
ls -1 "$PIPER_DIR"/*.onnx 2>/dev/null | xargs -n1 basename || echo "  (none)"
echo ""
echo "If your runtime sets PIPER_BIN explicitly (eg. server/.env), point it at:"
echo "  $PIPER_BIN"
echo "Otherwise the server resolves this default automatically."
