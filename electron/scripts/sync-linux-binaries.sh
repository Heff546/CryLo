#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON="$ROOT/electron"
DEST="$ELECTRON/bin/linux"
SOURCE="$("$ELECTRON/scripts/find-linux-release-bin.sh")"

FILES=(
  CryLo-daemon
  CryLo-wallet-rpc
)

DAEMON_ARCH="$(
  "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
  "$SOURCE/CryLo-daemon"
)"

WALLET_ARCH="$(
  "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
  "$SOURCE/CryLo-wallet-rpc"
)"

if [[ "$DAEMON_ARCH" != "$WALLET_ARCH" ]]; then
  echo "ERROR: CryLo Linux binaries have different architectures."
  echo "  CryLo-daemon:     $DAEMON_ARCH"
  echo "  CryLo-wallet-rpc: $WALLET_ARCH"
  exit 1
fi

COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
BRANCH="$(git -C "$ROOT" branch --show-current)"
GENERATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$DEST"

rm -f \
  "$DEST"/CryLo-daemon.old-* \
  "$DEST"/CryLo-wallet-rpc.old-* \
  "$DEST"/*.log \
  "$DEST"/c64chaind \
  "$DEST"/c64chain-wallet-rpc

echo "CryLo Linux binary synchronization"
echo "Source:       $SOURCE"
echo "Architecture: $DAEMON_ARCH"
echo

for name in "${FILES[@]}"; do
  install -m 0755 "$SOURCE/$name" "$DEST/$name"

  cmp -s "$SOURCE/$name" "$DEST/$name" || {
    echo "ERROR: Copy verification failed for $name"
    exit 1
  }

  echo "Synchronized: $name"
done

{
  echo "CryLo Electron Linux Binary Manifest"
  echo "Generated-UTC: $GENERATED"
  echo "Git-Branch: $BRANCH"
  echo "Git-Commit: $COMMIT"
  echo "Architecture: $DAEMON_ARCH"
  echo "Source-Directory: ${SOURCE#$ROOT/}"
  echo

  for name in "${FILES[@]}"; do
    echo "File: $name"
    echo "Size: $(stat -c '%s' "$DEST/$name")"
    echo "SHA256: $(sha256sum "$DEST/$name" | awk '{print $1}')"
    echo "Version: $(timeout 10 "$DEST/$name" --version 2>&1 |
      head -n 1 || true)"
    echo
  done
} > "$DEST/BINARY-MANIFEST.txt"

cat "$DEST/BINARY-MANIFEST.txt"
