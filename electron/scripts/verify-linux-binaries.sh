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

SOURCE_ARCH="$(
  "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
  "$SOURCE/CryLo-daemon"
)"

DEST_ARCH="$(
  "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
  "$DEST/CryLo-daemon"
)"

[[ "$SOURCE_ARCH" == "$DEST_ARCH" ]] || {
  echo "ERROR: Electron binary architecture mismatch."
  echo "  Build:    $SOURCE_ARCH"
  echo "  Electron: $DEST_ARCH"
  exit 1
}

for name in "${FILES[@]}"; do
  [[ -x "$SOURCE/$name" ]] || {
    echo "ERROR: Missing build binary: $SOURCE/$name"
    exit 1
  }

  [[ -x "$DEST/$name" ]] || {
    echo "ERROR: Missing Electron binary: $DEST/$name"
    exit 1
  }

  source_sha="$(sha256sum "$SOURCE/$name" | awk '{print $1}')"
  dest_sha="$(sha256sum "$DEST/$name" | awk '{print $1}')"

  [[ "$source_sha" == "$dest_sha" ]] || {
    echo "ERROR: Stale Electron binary: $name"
    echo "  Build:    $source_sha"
    echo "  Electron: $dest_sha"
    exit 1
  }

  binary_arch="$(
    "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
    "$DEST/$name"
  )"

  [[ "$binary_arch" == "$SOURCE_ARCH" ]] || {
    echo "ERROR: $name has architecture $binary_arch"
    echo "Expected: $SOURCE_ARCH"
    exit 1
  }

  echo "OK: $name [$binary_arch] $dest_sha"
done

grep -qx "Architecture: $SOURCE_ARCH" \
  "$DEST/BINARY-MANIFEST.txt" || {
    echo "ERROR: Manifest architecture is missing or incorrect."
    exit 1
  }

echo
echo "Linux binaries verified for $SOURCE_ARCH."
