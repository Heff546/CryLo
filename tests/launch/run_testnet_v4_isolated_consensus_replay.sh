#!/usr/bin/env bash
# CRYLO security PR #30: OFFLINE, TESTNET-only, full-history admission gate.
# This reads an existing, inactive, audited Pi1 snapshot via the *candidate*
# blockchain exporter and imports it, with default verification enabled,
# into a brand-new disposable Pi1 data directory. Never pass a live data dir.
# No daemons are started, no hardfork is scheduled, and no wallet is opened.
set -euo pipefail
umask 077

REVIEW="${HOME}/CryLo-Testing/Testnet-V21-Treasury-Review"
BUILD="${HOME}/CryLo-Testing/Testnet-V21-Treasury-Build"
AUDIT="${HOME}/CryLo-Testing/Testnet-V4-History-Audit-20261121"
SOURCE_ROOT="$AUDIT/prior-abi"
SOURCE_DB="$SOURCE_ROOT/testnet/lmdb"
CHECK="$REVIEW/tests/launch/verify_testnet_anchor_checkpoints.py"
COMPARE="$REVIEW/tests/launch/compare_testnet_lmdb_blocks.py"

echo "===== ISOLATED CANONICAL V4 CONSENSUS REPLAY ====="
echo "Source: a SAVED Pi1 snapshot, NOT the live anchor."
echo "History: block heights 0..2957; no v21 hardfork activation."

test -f "$REVIEW/CMakeLists.txt" || { echo "FAIL: missing review worktree."; exit 1; }
test -f "$SOURCE_DB/data.mdb" || { echo "FAIL: missing saved audit snapshot."; exit 1; }
test -d "$BUILD" || { echo "FAIL: missing existing candidate build directory."; exit 1; }
test -f "$CHECK" && test -f "$COMPARE" || { echo "FAIL: audit scripts missing."; exit 1; }
if [[ -n "$(git -C "$REVIEW" status --porcelain)" ]]; then
  echo "FAIL: review worktree is dirty."
  exit 1
fi
REV="$(git -C "$REVIEW" rev-parse HEAD)"
echo "Candidate SHA: $REV"

echo "===== RECONFIRM ANCHOR CHECKPOINTS BEFORE REPLAY ====="
python3 "$CHECK" "$SOURCE_DB"

ROOT="$(mktemp -d "$HOME/CryLo-Testing/Testnet-V4-Verified-Replay-XXXXXXXX")"
RAW="$ROOT/blockchain.raw"
DEST="$ROOT/replay"
mkdir -p "$DEST"
echo "New disposable output directory: $ROOT"
echo "===== BUILD EXPORT/IMPORT FROM CANDIDATE SOURCE ====="
if ! cmake --build "$BUILD" --target blockchain_export blockchain_import --parallel 1 \
    > "$ROOT/build.log" 2>&1; then
  tail -80 "$ROOT/build.log"
  echo "FAIL: candidate blockchain tools did not compile."
  exit 1
fi
tail -12 "$ROOT/build.log"

mapfile -t EXPORTS < <(find "$BUILD" -type f -name 'CryLo-blockchain-export' -perm /111)
mapfile -t IMPORTS < <(find "$BUILD" -type f -name 'CryLo-blockchain-import' -perm /111)
if [[ "${#EXPORTS[@]}" -ne 1 || "${#IMPORTS[@]}" -ne 1 ]]; then
  echo "FAIL: need exactly one candidate exporter and one candidate importer."
  printf 'Exporters: %s\nImporters: %s\n' "${#EXPORTS[@]}" "${#IMPORTS[@]}"
  exit 1
fi

echo "===== EXPORT EXISTING 0..2957 BLOCKS READ-ONLY ====="
if ! "${EXPORTS[0]}" --testnet --data-dir "$SOURCE_ROOT" \
    --output-file "$RAW" --block-stop 2957 \
    > "$ROOT/export.log" 2>&1; then
  tail -80 "$ROOT/export.log"
  echo "FAIL: read-only source export."
  exit 1
fi
if [[ ! -s "$RAW" ]]; then
  echo "FAIL: exported blockchain.raw missing or empty."
  exit 1
fi
tail -10 "$ROOT/export.log"

echo "===== VERIFIED IMPORT INTO BRAND-NEW ISOLATED DATABASE ====="
echo "Import verification is ON (do not use --dangerous-unverified-import)."
# Default `opt_verify = true` in blockchain_import.cpp. The imported chain
# MUST match every serialized block in the audited source, and all 3 anchor
# checkpoints. Import utility's exit code alone is not sufficient evidence.
if ! "${IMPORTS[0]}" --testnet --data-dir "$DEST" \
    --input-file "$RAW" --block-stop 2957 \
    > "$ROOT/import.log" 2>&1; then
  tail -90 "$ROOT/import.log"
  echo "FAIL: candidate verified import process."
  exit 1
fi
tail -18 "$ROOT/import.log"

NEW_DB="$DEST/testnet/lmdb"
if [[ ! -f "$NEW_DB/data.mdb" ]]; then
  echo "FAIL: isolated imported database not found: $NEW_DB"
  exit 1
fi

echo "===== VERIFY REPLAYED BLOCKS MATCH THE ANCHOR ====="
python3 "$CHECK" "$NEW_DB"

echo "===== VERIFY EVERY REPLAYED SERIALIZED BLOCK ====="
python3 "$COMPARE" "$SOURCE_DB" "$NEW_DB"

echo "===== ISOLATED REPLAY COMPLETE ====="
echo "PASS: imported 2958 matching historical block records using verified admission."
echo "PASS: original and imported block tables match byte-for-byte at every height."
echo "NO ORIGINAL DATABASE, DAEMON, LIVE ANCHOR OR WALLET WAS MODIFIED."
echo "LIMIT: this is historical v20 consensus replay, NOT v21 fork acceptance."
echo "LIMIT: live anchor contains no canonical block 2958+."
echo "Review SHA: $REV"
echo "Evidence logs and disposable database: $ROOT"
