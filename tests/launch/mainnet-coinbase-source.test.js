'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const config = read('src/cryptonote_config.h');
const generator = read('src/cryptonote_core/cryptonote_tx_utils.cpp');
const validator = read('src/cryptonote_core/blockchain.cpp');
const hardforks = read('src/hardforks/hardforks.cpp');
const preflight = read('scripts/release/mainnet-launch-preflight.js');
const core = read('src/cryptonote_core/cryptonote_core.cpp');
const coreHeader = read('src/cryptonote_core/cryptonote_core.h');
const daemonMain = read('src/daemon/main.cpp');
const mainnetHarness = read('tests/core_tests/crylo_mainnet_consensus_tests.cpp');
const cmakeCore = read('tests/core_tests/CMakeLists.txt');

function macro(name) {
  const match = config.match(
    new RegExp('^#define\\s+' + name + '\\s+(\\d+)\\b', 'm')
  );
  assert.ok(match, 'Missing macro: ' + name);
  return BigInt(match[1]);
}

const devBps = macro('CryLo_DEV_FUND_FEE_BPS');
const liquidityBps = macro('CryLo_LIQUIDITY_FUND_FEE_BPS');
const gasBps = macro('CryLo_GAS_TREASURY_FEE_BPS');

function allocations(rewardAtomic) {
  const dev = rewardAtomic * devBps / 10000n;
  const liquidity = rewardAtomic * liquidityBps / 10000n;
  const gas = rewardAtomic * gasBps / 10000n;
  const miner = rewardAtomic - dev - liquidity - gas;
  const instant = miner / 2n;
  const vested = miner - instant;
  return [instant, vested, dev, liquidity, gas];
}

test('all networks use the owner-approved 75/25/50 bp treasury split', () => {
  assert.equal(devBps, 75n);
  assert.equal(liquidityBps, 25n);
  assert.equal(gasBps, 50n);
  assert.equal(devBps + liquidityBps + gasBps, 150n);
  assert.doesNotMatch(config, /CryLo_GAS_TREASURY_FEE_BPS_MAINNET/);
});

test('coinbase creator pays liquidity and Gas Treasury on every network', () => {
  assert.match(generator,
    /liquidity_fund_amount\s*=\s*block_reward\s*\*\s*CryLo_LIQUIDITY_FUND_FEE_BPS\s*\/\s*10000/);
  assert.match(generator,
    /gas_treasury_amount\s*=\s*block_reward\s*\*\s*CryLo_GAS_TREASURY_FEE_BPS\s*\/\s*10000/);
  assert.match(generator, /if \(liquidity_fund_amount > 0\)/);
  assert.match(generator, /if \(gas_treasury_amount > 0\)/);
  assert.match(generator,
    /gas_treasury_addr\.m_spend_public_key, 4\)/);
  assert.doesNotMatch(generator, /CryLo_GAS_TREASURY_FEE_BPS_MAINNET/);
});

test('validator requires five outputs and matches the approved amounts and indices', () => {
  assert.match(validator, /const size_t required_outs = 5;/);
  assert.match(validator, /b\.miner_tx\.vout\.size\(\) != required_outs/);
  assert.match(validator,
    /liquidity_fund_expected\s*=\s*total_reward\s*\*\s*CryLo_LIQUIDITY_FUND_FEE_BPS\s*\/\s*10000/);
  assert.match(validator,
    /gas_treasury_expected\s*=\s*total_reward\s*\*\s*CryLo_GAS_TREASURY_FEE_BPS\s*\/\s*10000/);
  assert.match(validator,
    /b\.miner_tx\.vout\[3\]\.amount != liquidity_fund_expected/);
  assert.match(validator,
    /b\.miner_tx\.vout\[4\]\.amount != gas_treasury_expected/);
  assert.match(validator, /size_t max_outs = hf_version >= HF_VERSION_VESTING \?\s*5\s*:/);
  assert.match(validator, /gas_treasury_view_pkey, gas_treasury_spend_pkey, 4\)/);
  assert.doesNotMatch(validator, /CryLo_GAS_TREASURY_FEE_BPS_MAINNET/);
});

test('mainnet v21 and testnet hardfork schedules are preserved', () => {
  assert.match(hardforks, /const hardfork_t mainnet_hard_forks\[\] = \{\s*\{ 17, 0, 1, 1700000000 \},\s*\{ 21, 2, 1, 1700000001 \}/);
  assert.match(hardforks, /const hardfork_t testnet_hard_forks\[\]/);
});

test('integer rounding and conservation at a range of coinbase rewards', () => {
  const atomicSamples = [
    250000000000n, 20000000000n, 100000000001n,
    20000000001n, 99999999999n, 123456789987n, 250000000001n
  ];
  for (const reward of atomicSamples) {
    for (const network of ['mainnet', 'testnet']) {
      const outputs = allocations(reward);
      assert.equal(outputs.length, 5, network);
      assert.equal(outputs.reduce((sum, amount) => sum + amount, 0n), reward);
      assert.ok(outputs.every(amount => amount >= 0n));
      assert.ok(outputs[1] >= outputs[0] && outputs[1] - outputs[0] <= 1n);
      assert.equal(outputs[2], reward * 75n / 10000n);
      assert.equal(outputs[3], reward * 25n / 10000n);
      assert.equal(outputs[4], reward * 50n / 10000n);
    }
  }
});

test('mainnet Liquidity and Gas public recipient proofs are connected to miner and validator', () => {
  // These assertions check source wiring ONLY. They do not cryptographically
  // validate a DLEQ proof or authorize a native mainnet release.
  const proof = read('src/cryptonote_core/crylo_gas_treasury_proof.h');
  const liquidity = read('src/cryptonote_core/crylo_liquidity_proof.h');
  const verifier = proof.slice(proof.indexOf('inline bool verify_crylo_mainnet_treasury_proof('));
  assert.match(generator, /!add_crylo_mainnet_liquidity_proof\(/);
  assert.match(generator, /!add_crylo_mainnet_treasury_proof\(/);
  assert.match(validator, /!verify_crylo_mainnet_liquidity_proof\(/);
  assert.match(validator, /!verify_crylo_mainnet_treasury_proof\(/);
  assert.match(validator, /b\.miner_tx, generation->height/);
  assert.match(validator, /Gas Treasury output key MISMATCH or invalid proof/);
  assert.match(verifier, /crypto::check_tx_proof\(/);
  assert.match(verifier, /crylo_treasury_proof_message\(without_proof, height\)/);
  assert.match(verifier, /tx\.extra\[proof_start\] != TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF/);
  assert.match(verifier, /if \(count != 1\)/);
  assert.match(verifier, /crypto::derive_public_key\(/);
  assert.match(verifier, /expected_output != actual_output/);
  assert.match(verifier, /get_output_view_tag\(tx\.vout\[treasury_index\]\)/);
  assert.doesNotMatch(validator, /CryLo_GAS_TREASURY_VIEWKEY_SECRET/);
  assert.doesNotMatch(proof, /CryLo_GAS_TREASURY_VIEWKEY_SECRET/);
  assert.match(liquidity, /LiquidityCoinbase:DLEQ:v1/);
  assert.match(liquidity, /liquidity_count != 1 \|\| gas_count != 1/);
  assert.match(liquidity, /TX_EXTRA_TAG_CRYLO_LIQUIDITY_PROOF/);
  assert.match(liquidity, /crypto::check_tx_proof\(/);
  assert.match(liquidity, /expected_output != actual_output/);
  assert.doesNotMatch(liquidity, /CryLo_LIQUIDITY_FUND_VIEWKEY_SECRET/);
});

test('launch preflight checks the public proof rather than a public wallet view secret', () => {
  assert.match(preflight, /treasuryProof\.includes\('inline bool verify_crylo_mainnet_treasury_proof\('\)/);
  assert.match(preflight, /liquidityProof\.includes\('inline bool verify_crylo_mainnet_liquidity_proof\('\)/);
  assert.match(preflight, /verifyProof\.includes\('crypto::check_tx_proof\('\)/);
  assert.match(preflight, /verifyProof\.includes\('expected_output != actual_output'\)/);
  assert.doesNotMatch(preflight, /blockchain\.includes\('gas_treasury_view_skey'\)/);
});

test('source-only proof checks never authorize official mainnet release signing', () => {
  // Approval and source wiring must not bypass native dual-recipient
  // consensus, historical chain replay, independent review, or updater gates.
  assert.match(preflight, /'Mainnet dual-recipient native consensus and replay evidence',\s*false,/);
  assert.match(preflight, /APPROVED mainnet allocation: Dev=75, Liquidity=25, Gas=50/);
});


test('mainnet template weight-convergence padding is inserted before both proof signatures', () => {
  assert.match(validator, /blobdata consensus_extra_nonce = ex_nonce;/);
  assert.match(validator, /consensus_extra_nonce\.append\(added_nonce_bytes, '\\0'\)/);
  assert.match(validator, /m_nettype == MAINNET && height > 0 &&\s*hf_version >= HF_VERSION_VESTING/);
  assert.match(validator, /Never append padding AFTER the canonical Liquidity\/Gas proof/);
  assert.match(validator, /added_nonce_bytes >\s*TX_EXTRA_NONCE_MAX_COUNT - consensus_extra_nonce\.size\(\)/);
  assert.equal((validator.match(/construct_miner_tx\(this, m_nettype, height, median_weight, already_generated_coins,[^;]+consensus_extra_nonce, max_outs, hf_version\)/g) || []).length, 2);
  assert.match(mainnetHarness, /Six nonce-length mainnet block templates preserve both proofs/);
});

test('mainnet block tests use real explicitly selected consensus, isolated offline data', () => {
  assert.match(coreHeader, /arg_mainnet_on/);
  assert.match(core, /"mainnet"/);
  assert.match(core, /m_nettype = MAINNET;/);
  assert.match(core, /m_nettype = explicit_stagenet \? STAGENET : TESTNET;/);
  assert.match(core, /--mainnet requires an explicit separate --data-dir/);
  assert.match(core, /--fixed-difficulty on --mainnet requires --offline/);
  assert.match(daemonMain, /arg_mainnet_on/);
  assert.match(daemonMain, /Only one of --mainnet, --testnet, --stagenet or --regtest/);
  assert.match(mainnetHarness, /"--mainnet"/);
  assert.match(mainnetHarness, /"--offline"/);
  assert.match(mainnetHarness, /"--fixed-difficulty=1"/);
  assert.match(mainnetHarness, /fs::unique_path\(/);
  assert.match(mainnetHarness, /handle_single_incoming_block\(/);
  assert.match(mainnetHarness, /MAINNET ACCEPTED redirected payout index/);
  assert.match(cmakeCore, /monero_add_minimal_executable\(crylo_mainnet_consensus_tests/);
  assert.doesNotMatch(cmakeCore, /add_test\(\s*NAME\s+crylo_mainnet_consensus_tests/);
});

test('official mainnet release builder fails closed on source preflight', () => {
  const builder = read('scripts/release/crylo-release.js');
  assert.match(builder, /if \(releaseNetwork === 'mainnet' && officialReleaseTag\)/);
  assert.match(builder, /UNSIGNED MAINNET VALIDATION BUILD ONLY/);
  assert.match(builder, /mainnet-launch-preflight\.js/);
  assert.match(builder, /gate\.status !== 0/);
  assert.match(builder, /Mainnet release blocked by consensus, recipient or updater preflight/);
});
