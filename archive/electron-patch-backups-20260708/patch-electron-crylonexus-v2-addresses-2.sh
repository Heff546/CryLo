#!/usr/bin/env bash
set -euo pipefail

MAIN="electron/main.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MAIN" "$MAIN.before-crylonexus-v2-addresses-2.$STAMP.bak"

python3 - <<'PY'
from pathlib import Path

p = Path("electron/main.js")
s = p.read_text()

repls = {
    # NodeStaking V1/old test address -> V2
    "0xe52dCAe33Ad01e1E242A3187cA0CF282B7e87D8e":
    "0x8Ec32977c1Ba0d537fD565c3047A5b7750E83B3a",

    # wCRYLO old address -> V2
    "0x32a4d52d12Ac6c8af9Ad5749Fe5344dC68ea8Bb8":
    "0x53E57880dD0865b484AfD0f467BBe8844c9d9727",

    # GasManager old address -> V2 GasManager
    "0x458f2f8b21957a7456807feE8e05c184Fe918AE2":
    "0xCB26FebCD655De1946e21db1A17fF9B70Cf536Cf",
}

for old, new in repls.items():
    count = s.count(old)
    print(f"{old} -> {new} | replacements: {count}")
    s = s.replace(old, new)

p.write_text(s)
PY

echo
echo "Checking remaining old values..."
grep -n \
"0xe52dCAe33Ad01e1E242A3187cA0CF282B7e87D8e\|0x32a4d52d12Ac6c8af9Ad5749Fe5344dC68ea8Bb8\|0x458f2f8b21957a7456807feE8e05c184Fe918AE2" \
"$MAIN" && {
  echo "FAILED: old values remain."
  exit 1
} || true

echo
echo "Checking V2 values..."
grep -n \
"0x8Ec32977c1Ba0d537fD565c3047A5b7750E83B3a\|0x53E57880dD0865b484AfD0f467BBe8844c9d9727\|0xCB26FebCD655De1946e21db1A17fF9B70Cf536Cf" \
"$MAIN"

echo
echo "Patch 2 complete."
