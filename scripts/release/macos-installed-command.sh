#!/bin/sh
# Installed macOS CryLo command. No Git checkout or developer dependencies.
set -eu
if [ "$#" -eq 0 ]; then
  printf '%s\n' 'CryLo' 'Usage: crylo update'
  exit 0
fi
case "$1" in
  update) [ "$#" -eq 1 ] || { echo 'Usage: crylo update' >&2; exit 2; } ;;
  help|--help|-h) printf '%s\n' 'CryLo' 'Usage: crylo update'; exit 0 ;;
  *) echo 'ERROR: Unsupported installed Mac command. Usage: crylo update' >&2; exit 2 ;;
esac

RESOURCES='/Applications/CryLo Wallet.app/Contents/Resources/macos-update'
CLIENT="$RESOURCES/macos-installed-update.js"
for NAME in macos-installed-update.js macos-update-client.js macos-package-trust.js macos-unsigned-update-stage.js macos-installed-release-state.js crylo-testnet-release-ed25519-public.pem; do
  [ -f "$RESOURCES/$NAME" ] || { echo "ERROR: Installed CryLo Mac updater missing: $NAME" >&2; exit 1; }
done

VERSION='24.21.0'
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = '1' ]; then
  ARCH='arm64'
  DIGEST='bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'
else
  [ "$(/usr/bin/uname -m)" = 'x86_64' ] || { echo 'ERROR: Unsupported macOS architecture.' >&2; exit 1; }
  ARCH='x64'
  DIGEST='1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097'
fi
NAME="node-v$VERSION-darwin-$ARCH"
BASE="$HOME/Library/Application Support/CryLo/runtime"
RUNTIME="$BASE/$NAME"
NODE="$RUNTIME/bin/node"
valid_runtime() {
  [ -x "$NODE" ] &&
  [ "$("$NODE" --version 2>/dev/null || true)" = "v$VERSION" ] &&
  [ "$("$NODE" -p 'process.arch' 2>/dev/null || true)" = "$ARCH" ]
}
if ! valid_runtime; then
  /bin/mkdir -p "$BASE"
  LOCK="$BASE/.crylo-installed-update-bootstrap-lock"
  /bin/mkdir "$LOCK" 2>/dev/null || { echo 'ERROR: CryLo runtime provisioning already active.' >&2; exit 1; }
  TEMP=''
  cleanup() {
    if [ -n "$TEMP" ]; then /bin/rm -rf "$TEMP"; fi
    /bin/rmdir "$LOCK" 2>/dev/null || true
  }
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM
  if ! valid_runtime; then
    if [ -e "$RUNTIME" ] || [ -L "$RUNTIME" ]; then
      echo 'ERROR: Existing CryLo runtime is invalid. It was preserved for recovery.' >&2
      exit 1
    fi
    TEMP=$(/usr/bin/mktemp -d "$BASE/.node-setup.XXXXXXXX")
    ARCHIVE="$NAME.tar.gz"
    /usr/bin/curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v$VERSION/$ARCHIVE" --output "$TEMP/$ARCHIVE"
    (cd "$TEMP" && printf '%s  %s\n' "$DIGEST" "$ARCHIVE" | /usr/bin/shasum -a 256 -c -)
    /usr/bin/tar -xzf "$TEMP/$ARCHIVE" -C "$TEMP"
    [ -x "$TEMP/$NAME/bin/node" ] || { echo 'ERROR: Verified Node archive incomplete.' >&2; exit 1; }
    /bin/mv "$TEMP/$NAME" "$RUNTIME"
    valid_runtime || { echo 'ERROR: CryLo managed runtime failed verification.' >&2; exit 1; }
  fi
  cleanup
  trap - EXIT HUP INT TERM
fi
unset NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS
exec "$NODE" "$CLIENT"
