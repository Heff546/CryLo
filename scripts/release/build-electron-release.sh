#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NETWORK="${CRYLO_NETWORK:-testnet}"
ARCH="${CRYLO_ARCH:-arm64}"

SOURCE_WALLET_RPC="build/bin/CryLo-wallet-rpc"
SOURCE_DAEMON="build/bin/CryLo-daemon"

ELECTRON_BIN_DIR="electron/bin/linux"
DEST_WALLET_RPC="$ELECTRON_BIN_DIR/CryLo-wallet-rpc"
DEST_DAEMON="$ELECTRON_BIN_DIR/CryLo-daemon"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

echo "===== RELEASE CONTEXT ====="
echo "Branch:  $(git branch --show-current)"
echo "Commit:  $(git rev-parse HEAD)"
echo "Network: $NETWORK"
echo "Arch:    $ARCH"
echo

[ -x "$SOURCE_WALLET_RPC" ] ||
  fail "Missing built wallet-RPC: $SOURCE_WALLET_RPC"

[ -x "$SOURCE_DAEMON" ] ||
  fail "Missing built daemon: $SOURCE_DAEMON"

mkdir -p "$ELECTRON_BIN_DIR"

echo "===== SOURCE BINARIES ====="
file "$SOURCE_WALLET_RPC"
file "$SOURCE_DAEMON"

case "$ARCH" in
  arm64)
    file "$SOURCE_WALLET_RPC" | grep -Eq 'ARM aarch64|ARM64' ||
      fail "Wallet-RPC is not ARM64"
    file "$SOURCE_DAEMON" | grep -Eq 'ARM aarch64|ARM64' ||
      fail "Daemon is not ARM64"
    ;;
  x64)
    file "$SOURCE_WALLET_RPC" | grep -Eq 'x86-64|x86_64' ||
      fail "Wallet-RPC is not x64"
    file "$SOURCE_DAEMON" | grep -Eq 'x86-64|x86_64' ||
      fail "Daemon is not x64"
    ;;
  *)
    fail "Unsupported architecture: $ARCH"
    ;;
esac

WALLET_VERSION="$("$SOURCE_WALLET_RPC" --version 2>&1 | head -1)"
DAEMON_VERSION="$("$SOURCE_DAEMON" --version 2>&1 | head -1)"

echo "$WALLET_VERSION"
echo "$DAEMON_VERSION"

case "$NETWORK" in
  testnet)
    grep -q -- "'--testnet'" electron/main.js ||
      fail "Electron main.js is not configured to launch wallet-RPC with --testnet"
    printf '%s\n' "$WALLET_VERSION" | grep -qi 'Testnet' ||
      fail "Wallet-RPC does not identify as Testnet"
    printf '%s\n' "$DAEMON_VERSION" | grep -qi 'Testnet' ||
      fail "Daemon does not identify as Testnet"
    ;;
  mainnet)
    if grep -q -- "'--testnet'" electron/main.js; then
      fail "Mainnet packaging refused: Electron still launches wallet-RPC with --testnet"
    fi
    printf '%s\n' "$WALLET_VERSION" | grep -qi 'Testnet' &&
      fail "Mainnet packaging refused: wallet-RPC identifies as Testnet"
    printf '%s\n' "$DAEMON_VERSION" | grep -qi 'Testnet' &&
      fail "Mainnet packaging refused: daemon identifies as Testnet"
    ;;
  *)
    fail "Unsupported network: $NETWORK"
    ;;
esac

echo
echo "===== SYNCHRONIZING ELECTRON BINARIES ====="

install -m 0755 "$SOURCE_WALLET_RPC" "$DEST_WALLET_RPC"
install -m 0755 "$SOURCE_DAEMON" "$DEST_DAEMON"

SOURCE_WALLET_HASH="$(sha256sum "$SOURCE_WALLET_RPC" | awk '{print $1}')"
DEST_WALLET_HASH="$(sha256sum "$DEST_WALLET_RPC" | awk '{print $1}')"

SOURCE_DAEMON_HASH="$(sha256sum "$SOURCE_DAEMON" | awk '{print $1}')"
DEST_DAEMON_HASH="$(sha256sum "$DEST_DAEMON" | awk '{print $1}')"

[ "$SOURCE_WALLET_HASH" = "$DEST_WALLET_HASH" ] ||
  fail "Wallet-RPC copy verification failed"

[ "$SOURCE_DAEMON_HASH" = "$DEST_DAEMON_HASH" ] ||
  fail "Daemon copy verification failed"

echo "Wallet-RPC hash: $DEST_WALLET_HASH"
echo "Daemon hash:     $DEST_DAEMON_HASH"

echo
echo "===== BUILDING ELECTRON ====="

cd electron

rm -rf dist

case "$ARCH" in
  arm64)
    npx electron-builder --linux AppImage deb --arm64
    ;;
  x64)
    npx electron-builder --linux AppImage deb --x64
    ;;
esac

cd "$ROOT"

echo
echo "===== RELEASE MANIFEST ====="

MANIFEST="electron/dist/crylo-release-manifest.txt"

{
  echo "branch=$(git branch --show-current)"
  echo "commit=$(git rev-parse HEAD)"
  echo "network=$NETWORK"
  echo "architecture=$ARCH"
  echo "wallet_rpc_sha256=$DEST_WALLET_HASH"
  echo "daemon_sha256=$DEST_DAEMON_HASH"
  echo "wallet_rpc_version=$WALLET_VERSION"
  echo "daemon_version=$DAEMON_VERSION"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$MANIFEST"

cat "$MANIFEST"

echo
echo "Electron package completed with synchronized CryLo binaries."
