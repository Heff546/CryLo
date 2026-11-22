#!/usr/bin/env bash
# Testnet V21 treasury proof CANDIDATE: offline Pi1 verification only.
# DOES NOT merge, schedule a fork, start daemons, use wallets, or mutate
# canonical LMDB. Operates exclusively on prior isolated review/audit copies.
set -euo pipefail

REVIEW="${HOME}/CryLo-Testing/Testnet-V21-Treasury-Review"
BUILD="${HOME}/CryLo-Testing/Testnet-V21-Treasury-Build"
AUDIT="${HOME}/CryLo-Testing/Testnet-V4-History-Audit-20261121"
LOGDIR="/tmp/crylo-testnet-v21-gate"
mkdir -p "$LOGDIR"

echo "===== CRYLO TESTNET TREASURY SECURITY GATE ====="
echo "This run is OFFLINE and does not activate a hardfork."

if [[ ! -f "$REVIEW/tests/launch/testnet-v21-treasury-source.test.js" ]]; then
  echo "FAIL: review worktree missing: $REVIEW"
  exit 1
fi
if [[ ! -d "$BUILD" ]]; then
  echo "FAIL: isolated native build missing: $BUILD"
  exit 1
fi
if [[ -n "$(git -C "$REVIEW" status --porcelain)" ]]; then
  echo "FAIL: review worktree is dirty; refusing to run ambiguous source."
  exit 1
fi
REV="$(git -C "$REVIEW" rev-parse HEAD)"
echo "Candidate SHA: $REV"

echo "===== SOURCE SECURITY TESTS ====="
if ! node --test "$REVIEW/tests/launch/testnet-v21-treasury-source.test.js" \
  > "$LOGDIR/source.log" 2>&1; then
  tail -70 "$LOGDIR/source.log"
  exit 1
fi
tail -12 "$LOGDIR/source.log"

echo "===== INCREMENTAL NATIVE BUILD ====="
if ! cmake --build "$BUILD" --target unit_tests --parallel 1 \
  > "$LOGDIR/build.log" 2>&1; then
  tail -90 "$LOGDIR/build.log"
  exit 1
fi
tail -8 "$LOGDIR/build.log"

mapfile -t TEST_BINS < <(find "$BUILD" -type f -name unit_tests -perm /111)
if [[ "${#TEST_BINS[@]}" -ne 1 ]]; then
  echo "FAIL: expected precisely one unit_tests binary."
  exit 1
fi

echo "===== TREASURY COINBASE CRYPTOGRAPHY + PRODUCTION VALIDATOR ====="
FILTER='CryLoTestnetV21TreasuryProof.*:CryLoLegacyV4TreasuryProof.*:CryLoTestnetV21BlockValidator.*'
if ! "${TEST_BINS[0]}" --gtest_filter="$FILTER" \
  > "$LOGDIR/treasury.log" 2>&1; then
  tail -90 "$LOGDIR/treasury.log"
  exit 1
fi
tail -13 "$LOGDIR/treasury.log"

echo "===== EXISTING CONSENSUS REGRESSION SUITES ====="
REG='parse_tx_extra.*:parse_and_validate_tx_extra.*:sort_tx_extra.*:remove_field_from_tx_extra.*:block_reward_and_*.*:major.*:empty_hardforks.*:ordering.*:check_for_height.*:get.*:states.*:steps_*.*:reorganize.*:voting.*:new_blocks.*:new_version.*'
if ! "${TEST_BINS[0]}" --gtest_filter="$REG" \
  > "$LOGDIR/regressions.log" 2>&1; then
  tail -90 "$LOGDIR/regressions.log"
  exit 1
fi
tail -11 "$LOGDIR/regressions.log"

echo "===== SAVED V4 HISTORY PREFIX COMPARISON ====="
SHORT="$AUDIT/original-v4/testnet/lmdb"
LONG="$AUDIT/prior-abi/testnet/lmdb"
if [[ ! -f "$SHORT/data.mdb" || ! -f "$LONG/data.mdb" ]]; then
  echo "FAIL: audited LMDB copies are absent. Originals WILL NOT be touched."
  exit 1
fi
if ! python3 "$REVIEW/tests/launch/compare_testnet_lmdb_blocks.py" \
  "$SHORT" "$LONG" > "$LOGDIR/history.log" 2>&1; then
  tail -70 "$LOGDIR/history.log"
  exit 1
fi
cat "$LOGDIR/history.log"

echo "===== FINAL SOURCE STATUS ====="
git -C "$REVIEW" status --short
echo "===== COMPLETE ====="
echo "SUCCESS: candidate tests and local V4 prefix audit passed."
echo "Candidate SHA: $REV"
echo "Evidence logs: $LOGDIR"
echo "HOLD: 2958+ canonical Google VM history and full add_new_block tests."
echo "HOLD: v21 Bulletproof Plus interaction and five-platform release checks."
echo "NO HARD FORK ACTIVATION; PR #30 REMAINS DRAFT."
