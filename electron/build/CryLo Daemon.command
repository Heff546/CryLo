#!/bin/sh
# CryLo macOS user launcher. Runs the exact daemon bundled beside CryLo Wallet.app.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP="$HERE/CryLo Wallet.app"
DAEMON="$APP/Contents/Resources/bin/mac/CryLo-daemon"

if [ ! -x "$DAEMON" ]; then
  printf '%s\n' "CryLo daemon is unavailable: $DAEMON" >&2
  printf '%s\n' "Install CryLo Wallet.app beside this launcher." >&2
  exit 1
fi

USER_DATA="$HOME/Library/Application Support/CryLo"
mkdir -p "$USER_DATA"

# Never overwrite an existing user or network configuration.
CONFIG="$USER_DATA/CryLo.conf"
if [ ! -e "$CONFIG" ]; then
  (umask 077; printf 'testnet=1\nadd-priority-node=relay-us-1.crylo.network:22640\n' > "$CONFIG")
fi

exec "$DAEMON" --config-file "$CONFIG" --data-dir "$USER_DATA"
