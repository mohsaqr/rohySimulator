#!/usr/bin/env bash
# Generate a self-signed TLS cert for the deploy host so Chrome treats
# the origin as secure and the mic-using features (SpeechRecognition,
# voice-mode press-to-talk) actually work. Private LAN IPs like
# 192.168.x.y are otherwise blocked by Chrome's secure-context policy.
#
# Usage:
#   ./scripts/gen-self-signed-tls.sh 192.168.50.39
#   ./scripts/gen-self-signed-tls.sh rohy.lan
#
# Then set in the systemd unit / .env that runs server/server.js:
#   TLS_CERT_PATH=/etc/rohy-tls/cert.pem
#   TLS_KEY_PATH=/etc/rohy-tls/key.pem
#   HTTPS_PORT=5001     # optional, defaults to PORT+1000
#
# The first time you visit the HTTPS URL, Chrome will show "Your
# connection is not private" — click Advanced → Proceed. Voice will
# work from then on. To skip the warning, use mkcert instead (install
# mkcert + run mkcert -install once on each client machine).

set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <host-or-ip>" >&2
  exit 1
fi

OUT_DIR="${TLS_OUT_DIR:-/etc/rohy-tls}"

# Decide whether HOST looks like an IP (subjectAltName needs IP: prefix
# for IPs, DNS: for hostnames — without this Chrome rejects the cert).
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:${HOST}"
else
  SAN="DNS:${HOST}"
fi

echo "== Generating self-signed cert for ${HOST} (SAN: ${SAN}) =="
echo "Output dir: ${OUT_DIR}"

sudo mkdir -p "$OUT_DIR"
sudo openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "$OUT_DIR/key.pem" \
  -out    "$OUT_DIR/cert.pem" \
  -subj "/CN=${HOST}" \
  -addext "subjectAltName=${SAN}"

sudo chmod 600 "$OUT_DIR/key.pem"
sudo chmod 644 "$OUT_DIR/cert.pem"

echo
echo "Done."
echo "  cert: $OUT_DIR/cert.pem"
echo "  key:  $OUT_DIR/key.pem"
echo
echo "Next: add these to the env that runs the Node server, then restart it:"
echo "  TLS_CERT_PATH=$OUT_DIR/cert.pem"
echo "  TLS_KEY_PATH=$OUT_DIR/key.pem"
echo
echo "Open: https://${HOST}:\${HTTPS_PORT:-5001}/rohy/"
