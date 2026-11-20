#!/usr/bin/env bash
# CryLo testnet v4: isolated, VERIFY-ENABLED block history replay.
# This script NEVER writes to the provided source LMDB, Pi2, or testnet
# wallet. It copies the LMDB with mdb_copy, exports historical blocks,
# verifies them into a fresh isolated database and compares full exports.
set -Eeuo pipefail

STOP_HEIGHT=2959
# Use the already configured native Pi1 review build by default.
BUILD_DIR="${CRYLO_REPLAY_BUILD_DIR:-/tmp/crylo-native-dleq-20261118/build}"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing $1; install the system LMDB utilities (mdb_copy) before running this test"; }

[ "$#" -eq 1 ] || die "Usage: $0 /path/to/your/Pi1/CryLo-testnet-v4 [source data directory]"
need mdb_copy
need cmp
need sha256sum
need mktemp
need realpath

SOURCE_DIR="$(realpath -e "$1")" || die "Testnet source data directory not found"
if [ -f "$SOURCE_DIR/lmdb/data.mdb" ]; then
  SOURCE_LMDB="$SOURCE_DIR/lmdb"
elif [ -f "$SOURCE_DIR/testnet/lmdb/data.mdb" ]; then
  SOURCE_LMDB="$SOURCE_DIR/testnet/lmdb"
else
  die "No testnet LMDB found under $SOURCE_DIR/lmdb or $SOURCE_DIR/testnet/lmdb; STOPPED without changes"
fi
[ -f "$SOURCE_LMDB/data.mdb" ] || die "No blockchain LMDB data file"

IMPORTER="$(find "$BUILD_DIR" -type f -name CryLo-blockchain-import -perm /111 -print -quit)"
EXPORTER="$(find "$BUILD_DIR" -type f -name CryLo-blockchain-export -perm /111 -print -quit)"
[ -n "$IMPORTER" ] || die "Build the blockchain_import target under $BUILD_DIR first"
[ -n "$EXPORTER" ] || die "Build the blockchain_export target under $BUILD_DIR first"

# Unique test workspace. Do not delete even on failure: retain exact logs.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crylo-v4-history-XXXXXX")"
SNAPSHOT_ROOT="$WORK/snapshot"
REPLAY_ROOT="$WORK/replay"
mkdir -p "$SNAPSHOT_ROOT/testnet/lmdb" "$REPLAY_ROOT"
ORIGINAL="$WORK/history-original.raw"
REPLAYED="$WORK/history-replayed.raw"

echo "===== CRYLO V4 HISTORICAL CHAIN REPLAY ====="
echo "SOURCE LMDB: $SOURCE_LMDB (READ ONLY)"
echo "WORKSPACE: $WORK"
echo "LAST BLOCK TO VERIFY: $STOP_HEIGHT"
echo "TESTNET ONLY: no peer/network connection"

# Refuse a snapshot likely to exhaust the Pi1 filesystem; full replay
# also needs room for two bootstrap files and a new verified LMDB.
SOURCE_KB="$(du -sk "$SOURCE_LMDB" | awk '{print $1}')"
FREE_KB="$(df -Pk "$WORK" | awk 'END {print $4}')"
if (( FREE_KB < SOURCE_KB * 2 + 524288 )); then
  die "Insufficient free disk space for isolated snapshot + history replay"
fi

# A compact, consistent LMDB snapshot while the Pi1 source might be open.
# mdb_copy reads the source environment; the destination is a new directory.
if ! mdb_copy -c "$SOURCE_LMDB" "$SNAPSHOT_ROOT/testnet/lmdb" > "$WORK/snapshot.log" 2>&1; then
  tail -20 "$WORK/snapshot.log"
  die "Consistent source LMDB snapshot failed; no original database modified"
fi
[ -s "$SNAPSHOT_ROOT/testnet/lmdb/data.mdb" ] || die "LMDB snapshot missing"
echo "PASS Consistent source database snapshot created"

# --testnet makes core::arg_data_dir append /testnet, by design.
# The source LMDB is installed at snapshot/testnet/lmdb (never under live).
echo "===== EXPORT CANONICAL TESTNET HISTORY ====="
if ! "$EXPORTER" --testnet --data-dir="$SNAPSHOT_ROOT" \
      --output-file="$ORIGINAL" --block-start=0 --block-stop="$STOP_HEIGHT" \
      > "$WORK/export-source.log" 2>&1; then
  tail -30 "$WORK/export-source.log"
  die "Testnet source export failed"
fi
[ -s "$ORIGINAL" ] || die "Original bootstrap export is empty"

# Do not silently downgrade to a partial history that omits block 2958.
if ! grep -Fq "Using requested block height: $STOP_HEIGHT" "$WORK/export-source.log"; then
  grep -E 'source blockchain height:|Using block height' "$WORK/export-source.log" || true
  die "Source chain does not prove replay coverage through $STOP_HEIGHT"
fi
echo "PASS Original testnet history exported through height $STOP_HEIGHT"

echo "===== VERIFIED IMPORT INTO FRESH TESTNET DATABASE ====="
# Verification is ON by default. Explicitly do NOT use the dangerous
# unverified import switch. Offline mode prevents peer connectivity.
if ! "$IMPORTER" --testnet --offline --disable-dns-checkpoints \
      --data-dir="$REPLAY_ROOT" --input-file="$ORIGINAL" \
      --block-stop="$STOP_HEIGHT" \
      > "$WORK/import-verified.log" 2>&1; then
  tail -30 "$WORK/import-verified.log"
  die "History importer returned failure"
fi
# The importer has a known bug: its main() ignores import_from_file's return
# code. Require verification log evidence AND a full independent export match.
if ! grep -Eq 'verify:[[:space:]]+true' "$WORK/import-verified.log"; then
  tail -25 "$WORK/import-verified.log"
  die "Importer did not explicitly report consensus verification enabled"
fi

echo "===== EXPORT REBUILT HISTORY ====="
if ! "$EXPORTER" --testnet --data-dir="$REPLAY_ROOT" \
      --output-file="$REPLAYED" --block-start=0 --block-stop="$STOP_HEIGHT" \
      > "$WORK/export-replay.log" 2>&1; then
  tail -30 "$WORK/export-replay.log"
  die "Replayed database export failed"
fi
[ -s "$REPLAYED" ] || die "Replayed history export is empty"
if ! grep -Fq "Using requested block height: $STOP_HEIGHT" "$WORK/export-replay.log"; then
  tail -25 "$WORK/export-replay.log"
  die "Replayed chain does not reach the expected historical height"
fi

echo "===== VERIFY HISTORICAL BYTES ====="
sha256sum "$ORIGINAL" "$REPLAYED"
if ! cmp -s "$ORIGINAL" "$REPLAYED"; then
  echo "Replay log summary:"
  grep -E 'Block verification failed|Failed to|Number of blocks imported|Finished at block' "$WORK/import-verified.log" | tail -15 || true
  die "Testnet history differs from original snapshot: DO NOT mark replay passed"
fi

echo "PASS Original and verified-replay exports match byte-for-byte"
echo "PASS Testnet v4 historical consensus through height $STOP_HEIGHT"
echo "PASS Historical fork boundary 2957 / 2958 / 2959 included"
echo "RESULT: VERIFIED TESTNET HISTORY REPLAY PASSED"
echo "MAINNET RELEASE: STILL BLOCKED"
echo "LOGS AND SNAPSHOTS: $WORK"
