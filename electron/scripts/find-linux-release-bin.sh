#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -n "${CRYLO_RELEASE_BIN:-}" ]]; then
  CANDIDATES=("$CRYLO_RELEASE_BIN")
else
  CANDIDATES=(
    "$ROOT/build/Linux/release_crylo-mainnet/release/bin"
    "$ROOT/build/bin"
  )
fi

for candidate in "${CANDIDATES[@]}"; do
  if [[ -x "$candidate/CryLo-daemon" &&
        -x "$candidate/CryLo-wallet-rpc" ]]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

echo "ERROR: Current CryLo release binaries were not found." >&2
echo "Checked:" >&2
printf '  %s\n' "${CANDIDATES[@]}" >&2
echo >&2
echo "Required:" >&2
echo "  CryLo-daemon" >&2
echo "  CryLo-wallet-rpc" >&2
exit 1
