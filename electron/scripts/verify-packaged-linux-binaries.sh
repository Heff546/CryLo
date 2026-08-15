#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON="$ROOT/electron"
SOURCE="$ELECTRON/bin/linux"
PACKAGED="$ELECTRON/dist/linux-unpacked/resources/bin/linux"

FILES=(
  CryLo-daemon
  CryLo-wallet-rpc
  BINARY-MANIFEST.txt
)

[[ -d "$PACKAGED" ]] || {
  echo "ERROR: Packaged resource directory not found:"
  echo "  $PACKAGED"
  exit 1
}

echo "Verifying packaged Electron resources"
echo

for name in "${FILES[@]}"; do
  expected="$SOURCE/$name"
  actual="$PACKAGED/$name"

  [[ -f "$actual" ]] || {
    echo "ERROR: Packaged file missing: $actual"
    exit 1
  }

  expected_sha="$(sha256sum "$expected" | awk '{print $1}')"
  actual_sha="$(sha256sum "$actual" | awk '{print $1}')"

  if [[ "$expected_sha" != "$actual_sha" ]]; then
    echo "ERROR: Packaged $name does not match staging"
    echo "  staging:  $expected_sha"
    echo "  packaged: $actual_sha"
    exit 1
  fi

  echo "OK: $name"
  echo "    SHA256: $actual_sha"
done

unexpected="$(
  find "$PACKAGED" -maxdepth 1 -type f \
    \( -name '*.log' -o -name '*.old-*' \) \
    -printf '%f\n'
)"

if [[ -n "$unexpected" ]]; then
  echo "ERROR: Unapproved files entered the package:"
  printf '  %s\n' $unexpected
  exit 1
fi

echo
echo "Packaged Linux binaries verified successfully."
