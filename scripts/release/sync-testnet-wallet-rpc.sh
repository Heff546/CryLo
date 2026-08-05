#!/usr/bin/env bash
set -euo pipefail

SOURCE="build/bin/CryLo-wallet-rpc"
DEST="electron/bin/linux/CryLo-wallet-rpc"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -x "$SOURCE" ] || {
  echo "Missing executable: $SOURCE"
  exit 1
}

mkdir -p electron/bin/linux

if [ -f "$DEST" ]; then
  cp -a "$DEST" "${DEST}.before-sync.${STAMP}.bak"
fi

install -m 0755 "$SOURCE" "$DEST"

echo
echo "===== SOURCE ====="
"$SOURCE" --version 2>&1 | head -5
sha256sum "$SOURCE"

echo
echo "===== ELECTRON COPY ====="
"$DEST" --version 2>&1 | head -5
sha256sum "$DEST"

SOURCE_HASH="$(sha256sum "$SOURCE" | awk '{print $1}')"
DEST_HASH="$(sha256sum "$DEST" | awk '{print $1}')"

[ "$SOURCE_HASH" = "$DEST_HASH" ] || {
  echo "ERROR: Wallet-RPC hashes do not match."
  exit 1
}

echo
echo "Electron wallet-RPC synchronized successfully."
