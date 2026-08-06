#!/usr/bin/env bash
set -euo pipefail

ELECTRON="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$("$ELECTRON/scripts/find-linux-release-bin.sh")"

SOURCE_ARCH="$(
  "$ELECTRON/scripts/detect-linux-binary-arch.sh" \
  "$SOURCE/CryLo-daemon"
)"

REQUESTED_ARCH="${1:-auto}"

if [[ "$REQUESTED_ARCH" == "auto" ]]; then
  TARGET_ARCH="$SOURCE_ARCH"
else
  TARGET_ARCH="$REQUESTED_ARCH"
fi

case "$TARGET_ARCH" in
  arm64|x64)
    ;;
  *)
    echo "ERROR: Architecture must be auto, arm64, or x64."
    exit 2
    ;;
esac

if [[ "$TARGET_ARCH" != "$SOURCE_ARCH" ]]; then
  echo "ERROR: Refusing to package incompatible binaries."
  echo
  echo "Compiled CryLo binaries: $SOURCE_ARCH"
  echo "Requested Electron target: $TARGET_ARCH"
  echo
  echo "Build the CryLo binaries on the matching architecture first."
  exit 1
fi

cd "$ELECTRON"

npm run sync-linux-binaries
npm run verify-linux-binaries

rm -rf \
  dist/linux-unpacked \
  dist/linux-arm64-unpacked \
  dist/linux-x64-unpacked

rm -f \
  dist/*.AppImage \
  dist/*.deb

echo
echo "Building CryLo Wallet for $TARGET_ARCH..."

npx electron-builder \
  --linux AppImage deb \
  "--$TARGET_ARCH"

echo
echo "Release artifacts:"
find dist -maxdepth 1 -type f \
  \( -name '*.AppImage' -o -name '*.deb' \) \
  -exec sha256sum {} \;

echo
echo "Completed $TARGET_ARCH Electron release."
