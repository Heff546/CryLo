#!/usr/bin/env bash
set -euo pipefail

MAIN="electron/main.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MAIN" "$MAIN.before-crylonexus-v2.$STAMP.bak"

python3 - <<'PY'
from pathlib import Path

p = Path("electron/main.js")
s = p.read_text()

repls = {
    "http://34.118.158.133/ext/bc/Vhsxxc8YGQ6rRWvrVVeCMr2VJ7nJwML8uh1gKubQEXLTy12c3/rpc":
    "http://34.118.158.133:9654/ext/bc/EPA2TKpkcmYRdaa4QKMYdFHkjzy5SWuGHEiBwznNspdTqexrQ/rpc",

    "0x1EA96575D2619F727E8492e9e79E01be46DAE0a9":
    "0x5f59a0f0010468E8bc6bbF551ac839a8Ddc964a2",

    "0x88B22dF76655B7e150AA1682ec956b087f564B92":
    "0xA51adce930306362528C5064Eb1E69f906CA830A",

    "chainId: 546":
    "chainId: 5546",
}

for old, new in repls.items():
    count = s.count(old)
    print(f"{old} -> {new} | replacements: {count}")
    s = s.replace(old, new)

p.write_text(s)
PY

echo
echo "Checking for old V1 values..."
grep -R \
"Vhsxxc8YGQ6rRWvrVVeCMr2VJ7nJwML8uh1gKubQEXLTy12c3\|2nca9iR66nrAP77azCFBUUDGrASTW3BtMZ3HJKTzk54KjcEs2h\|0x88B22dF76655B7e150AA1682ec956b087f564B92\|0x1EA96575D2619F727E8492e9e79E01be46DAE0a9\|chainId: 546" \
electron/main.js -n && {
  echo "FAILED: old values remain."
  exit 1
} || true

echo
echo "Checking V2 values..."
grep -n \
"EPA2TKpkcmYRdaa4QKMYdFHkjzy5SWuGHEiBwznNspdTqexrQ\|0x5f59a0f0010468E8bc6bbF551ac839a8Ddc964a2\|0xA51adce930306362528C5064Eb1E69f906CA830A\|chainId: 5546" \
electron/main.js

echo
echo "Patch complete."
